// E2E de alertas de precio (P9-02) en Edge real contra web + API corriendo (`npm.cmd run dev`,
// o `E2E_BASE_URL`), Redis de Compose y el dataset DEMO. Recorrido: crear regla → precio que
// cruza el umbral → job CHECK_PRICE_ALERTS (worker `--until-idle`) → aviso → leído → recarga.
// Para no tocar los precios DEMO usa una presentación propia por corrida ("Arroz E2E … (TEST)")
// que se desactiva al terminar, y un prefijo de Redis propio que se borra.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { Queue } = require('bullmq');
const { config } = require('dotenv');
const { Client } = require('pg');
const { chromium } = require('playwright-core');

const ROOT = resolve(__dirname, '../../..');
const API = resolve(ROOT, 'apps/api');
config({ path: resolve(ROOT, '.env'), quiet: true });
config({ path: resolve(API, '.env'), quiet: true });
const { demoCanonicalProductId, demoStoreId } = require(resolve(API, 'dist/seed/seed-demo-catalog'));

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(ROOT, '.cache/verification/p9-02');
const PASSWORD = 'frase-de-prueba-e2e';
const PREFIX = `tusofertas-e2e-${process.pid}`;
const stamp = Date.now();
const ana = `e2e-alertas-ana-${stamp}@example.com`;
const bea = `e2e-alertas-bea-${stamp}@example.com`;
// Coto Caballito (DEMO): la ubicación de la persona y la sucursal del precio nuevo.
const CABALLITO = { latitude: -34.6187, longitude: -58.4407 };
const PRODUCT_NAME = `Arroz E2E ${stamp} 1 kg (TEST)`;
mkdirSync(SHOTS, { recursive: true });

let browser;
let page;
let pg;
let productId;
let jobs = 0;

async function registerAs(target, email) {
  await target.goto(`${BASE}/register`);
  await target.getByLabel('Email').fill(email);
  await target.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Crear cuenta' }).click();
  await target.waitForURL(/\/onboarding$/);
}

async function saveLocation(target) {
  await target.goto(`${BASE}/preferencias`);
  await target.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await target.getByText('Ubicación guardada para calcular distancias.').waitFor();
  await target.getByRole('button', { name: 'Guardar preferencias' }).click();
  await target.getByText('Guardamos tus preferencias.').waitFor();
}

/** El job real: encolar con el comando y procesar con el worker hasta vaciar la cola. */
async function runAlertsJob(email) {
  const { rows: [user] } = await pg.query('SELECT "id"::text AS id FROM "User" WHERE lower("email") = lower($1)', [email]);
  const env = { ...process.env, JOBS_PREFIX: PREFIX };
  const node = (args) => spawnSync('node', ['--env-file-if-exists=../../.env', '--env-file-if-exists=.env', ...args], { cwd: API, env, encoding: 'utf8', timeout: 90_000 });
  jobs += 1;
  const enqueue = node(['dist/modules/jobs/cli.js', 'enqueue', 'CHECK_PRICE_ALERTS', `--user=${user.id}`, `--key=e2e-${stamp}-${jobs}`]);
  assert.equal(enqueue.status, 0, enqueue.stderr);
  const worker = node(['dist/worker.js', '--until-idle']);
  assert.equal(worker.status, 0, worker.stdout.slice(-500));
  assert.match(worker.stdout, /"event":"job_completed"[^\n]*CHECK_PRICE_ALERTS/);
}

before(async () => {
  pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const canonical = demoCanonicalProductId('arroz-largo-fino');
  const { rows: [created] } = await pg.query(
    `INSERT INTO "Product" ("id", "name", "normalizedName", "brand", "categoryId", "canonicalProductId", "quantity", "unit", "updatedAt")
     SELECT $1::uuid, $2::varchar, lower($2::varchar), 'E2E', "categoryId", "id", 1, 'KG', now() FROM "CanonicalProduct" WHERE "id" = $3::uuid
     RETURNING "id"::text AS id`,
    [randomUUID(), PRODUCT_NAME, canonical],
  );
  productId = created.id;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', permissions: ['geolocation'], geolocation: CABALLITO });
  page = await context.newPage();
});

after(async () => {
  await browser?.close();
  // La presentación de prueba deja de verse en el catálogo; sus precios quedan (historia append-only).
  if (productId) await pg.query('UPDATE "Product" SET "isActive" = false WHERE "id" = $1', [productId]);
  await pg?.end();
  for (const name of ['imports', 'plans', 'alerts']) {
    const queue = new Queue(name, { connection: { url: process.env.REDIS_URL }, prefix: PREFIX });
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

test('desde el buscador se llega al formulario de alerta, que dice cómo avisa', async () => {
  await registerAs(page, ana);
  await saveLocation(page);
  await page.goto(`${BASE}/buscar?q=arroz`);
  const link = page.locator('.product-card-alert').first();
  await link.waitFor();
  assert.match(await link.innerText(), /Avisame si baja/);
  await link.click();
  await page.locator('#crear-alerta').waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'crear-alerta');
  await page.getByRole('radio', { name: 'Cuando llegue a un precio' }).waitFor();
  await page.getByText('no enviamos emails ni mensajes al celular').waitFor();
});

test('regla → precio que cruza el umbral → job → aviso → leído, y la recarga lo conserva', async () => {
  await page.goto(`${BASE}/producto/${productId}`);
  await page.locator('#crear-alerta').waitFor();
  await page.getByLabel('Precio objetivo por kilo').fill('abc');
  await page.getByRole('button', { name: 'Crear alerta' }).click();
  await page.getByText(/Escribí el precio por kilo/).waitFor();
  await page.getByLabel('Precio objetivo por kilo').fill('1500');
  await page.getByLabel(/Solo esta presentación/).check();
  await page.getByRole('button', { name: 'Crear alerta' }).click();
  await page.getByText('Alerta creada.').waitFor();

  // Sin precios de esta presentación todavía: la revisión lo dice y no avisa.
  await runAlertsJob(ana);
  await page.goto(`${BASE}/alertas`);
  await page.getByText('Arroz E2E', { exact: false }).first().waitFor();
  await page.getByText(/Sin precios recientes en tu zona/).waitFor();
  await page.getByText('Todavía no hay avisos').waitFor();

  // Llega un precio que cruza el umbral y el job avisa.
  await pg.query(
    `INSERT INTO "ProductPrice" ("id", "productId", "storeId", "price", "unitPrice", "unitPriceUnit", "currency", "source", "idempotencyKey", "observedAt")
     VALUES ($1, $2, $3, 1200, 1200, 'KG', 'ARS', 'e2e-alertas', $4, now() - interval '1 minute')`,
    [randomUUID(), productId, demoStoreId('coto-caballito'), `e2e-${stamp}`],
  );
  await runAlertsJob(ana);
  await page.reload();
  const item = page.locator('.notification-item').first();
  await item.waitFor();
  await item.getByText('Arroz largo fino llegó a tu precio objetivo').waitFor();
  await item.getByText('Nuevo').waitFor();
  assert.match(await item.innerText(), /\$\s?1\.200,00/);
  assert.match(await item.innerText(), /Coto Caballito/);
  assert.equal(await page.locator('.nav-count').innerText().then((text) => text.trim().split('\n')[0]), '1');
  await page.getByText('Te avisamos', { exact: false }).first().waitFor();
  await page.screenshot({ path: resolve(SHOTS, 'bandeja-con-aviso.png'), fullPage: true });

  await page.goto(`${BASE}/dashboard`);
  await page.locator('.dashboard-alerts').getByText('1 aviso sin leer').waitFor();

  await page.goto(`${BASE}/alertas`);
  await page.getByRole('button', { name: 'Marcar como leído' }).click();
  await page.locator('.notification-item .new-badge').waitFor({ state: 'detached' });
  await page.reload();
  await page.locator('.notification-item').first().waitFor();
  assert.equal(await page.locator('.new-badge').count(), 0, 'la lectura quedó guardada');
  assert.equal(await page.locator('.nav-count').count(), 0);
  await page.screenshot({ path: resolve(SHOTS, 'bandeja-leida.png'), fullPage: true });
});

test('una alerta borrada antes de la revisión no avisa', async () => {
  await page.goto(`${BASE}/producto/${productId}`);
  await page.locator('#crear-alerta').waitFor();
  await page.getByLabel('Precio objetivo por kilo').fill('2000');
  await page.getByRole('button', { name: 'Crear alerta' }).click();
  await page.getByText('Alerta creada.').waitFor();
  await page.goto(`${BASE}/alertas`);
  const rule = page.locator('.alert-rule', { hasText: '2.000,00' });
  await rule.getByRole('button', { name: 'Borrar' }).click();
  await rule.getByRole('button', { name: 'Sí, borrar' }).click();
  await rule.waitFor({ state: 'detached' });
  await runAlertsJob(ana);
  await page.reload();
  await page.locator('.notification-item').first().waitFor();
  assert.equal(await page.locator('.notification-item').count(), 1, 'solo el aviso de la primera alerta');
});

test('otra cuenta no ve alertas ni avisos ajenos', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR' });
  const other = await context.newPage();
  await registerAs(other, bea);
  await other.goto(`${BASE}/alertas`);
  await other.getByText('Todavía no hay avisos').waitFor();
  await other.getByText('Todavía no creaste alertas').waitFor();
  await other.screenshot({ path: resolve(SHOTS, 'alertas-vacia-movil.png'), fullPage: true });
  await context.close();
});
