// E2E del historial de precios en la ficha y del resumen privado (P6-02) en Edge real contra
// web + API corriendo (`npm.cmd run dev`, o `E2E_BASE_URL`). Usa el dataset DEMO
// (`npm.cmd run db:seed`) y crea cuentas ficticias e2e-resumen-*@example.com.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p6-02');
const PASSWORD = 'frase-de-prueba-e2e';
const stamp = Date.now();
const CABALLITO = { latitude: -34.6187, longitude: -58.4407 };
mkdirSync(SHOTS, { recursive: true });

let browser;
let page;
let productUrl;

async function newPage(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', ...options });
  return { ctx, page: await ctx.newPage() };
}

async function registerAs(target, email) {
  await target.goto(`${BASE}/register`);
  await target.getByLabel('Email').fill(email);
  await target.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Crear cuenta' }).click();
  await target.waitForURL(/\/onboarding$/);
}

async function pickCanonical(target, label, term, name) {
  await target.getByLabel(label).fill(term);
  await target.locator('.picker-option', { hasText: name }).first().click();
}

const overflow = (target) => target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const storeSelect = (target) => target.getByLabel('Sucursal', { exact: true });
const periodSelect = (target) => target.getByLabel('Período');

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  ({ page } = await newPage({ permissions: ['geolocation'], geolocation: CABALLITO }));
});
after(async () => {
  await browser?.close();
});

test('la ficha muestra el historial con su análisis, un gráfico accesible y la tabla equivalente', async () => {
  await page.goto(`${BASE}/buscar?q=pollo`);
  await page.locator('.product-card', { hasText: 'Pollo entero fresco por kg' }).first().getByRole('link').click();
  await page.waitForURL(/\/producto\//);
  productUrl = page.url().split('?')[0];
  await page.getByRole('heading', { name: 'Historial de precios' }).waitFor();
  const chart = page.locator('.history-chart svg[role="img"]');
  await chart.waitFor();
  assert.match(await chart.locator('title').textContent(), /^Precio por kg en /);
  assert.match(await chart.locator('desc').textContent(), /días con precio entre el/);
  await page.locator('.history-badge').first().waitFor();
  assert.ok((await page.locator('.history-explanation').innerText()).length > 20);
  await page.getByText(/de 30 días con precio/).waitFor();

  await page.getByText('Ver los datos del gráfico').click();
  const rows = page.locator('.history-table tbody tr');
  assert.ok(await rows.count() >= 20, 'una fila por día con precio');
  await page.screenshot({ path: resolve(SHOTS, 'historial-escritorio.png'), fullPage: true });
});

test('sucursal y período quedan en la URL, "atrás" los deshace y una sucursal sin precios recientes no se etiqueta como oferta', async () => {
  const options = await storeSelect(page).locator('option').allInnerTexts();
  const disco = options.find((text) => text.includes('Disco') && text.includes('Belgrano'));
  assert.ok(disco, `opciones: ${options.join(' | ')}`);
  assert.match(disco, /Precio desactualizado/);
  await storeSelect(page).selectOption({ label: disco });
  await page.waitForURL(/sucursal=/);
  await page.locator('.history-badge', { hasText: 'Precio desactualizado' }).waitFor();
  await page.getByText(/El último precio es de hace \d+ días/).waitFor();

  await periodSelect(page).selectOption('90');
  await page.waitForURL(/periodo=90/);
  await page.getByText(/de 90 días con precio/).waitFor();
  assert.match(page.url(), /sucursal=/, 'la sucursal se conserva al cambiar el período');

  await page.goBack();
  await page.waitForURL((url) => !url.searchParams.has('periodo'));
  await page.getByText(/de 30 días con precio/).waitFor();
});

test('el teclado alcanza para cambiar el período', async () => {
  await page.goto(productUrl);
  await periodSelect(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForURL(/periodo=90/);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT');
});

test('móvil 390 px: la ficha con el historial no desborda', async () => {
  const { ctx, page: mobile } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(productUrl);
  await mobile.locator('.history-chart svg').waitFor();
  assert.ok(await overflow(mobile) <= 0, 'sin desborde horizontal');
  await mobile.screenshot({ path: resolve(SHOTS, 'historial-movil.png'), fullPage: true });
  await ctx.close();
});

test('resumen de una cuenta nueva: sin plan, ahorro estimado en cero y sin ahorro registrado', async () => {
  await registerAs(page, `e2e-resumen-${stamp}@example.com`);
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole('heading', { name: 'Tu semana de compras' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Resumen' }).getAttribute('aria-current'), 'page');
  await page.getByText('No tenés un plan para estos días.').waitFor();
  assert.equal(await page.locator('.dashboard-amount').count(), 3);
  for (const amount of await page.locator('.dashboard-amount').allInnerTexts()) assert.match(amount, /0,00/);
  await page.getByText(/Ahorro registrado:/).waitFor();
  await page.getByText(/Todavía no registramos compras/).waitFor();
  await page.getByText('Cargá tus productos habituales para ver cuándo están más baratos.').waitFor();
});

test('con productos, zona y un plan en uso: próxima compra y ahorro estimado de ese plan una sola vez', async () => {
  await page.goto(`${BASE}/onboarding`);
  await page.getByRole('button', { name: 'Omitir este paso' }).click();
  await page.waitForURL(/paso=2/);
  await page.getByRole('button', { name: 'Omitir este paso' }).click();
  await page.waitForURL(/paso=3/);
  await pickCanonical(page, 'Buscá un producto habitual', 'pollo', 'Pollo entero fresco');
  await page.getByLabel(/Cuánto pollo entero fresco comprás/).fill('3');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Agregaste Pollo entero fresco.').waitFor();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.waitForURL(/paso=4/);
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.waitForURL(`${BASE}/mis-compras`);
  await page.goto(`${BASE}/preferencias`);
  await page.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await page.getByText('Ubicación guardada para calcular distancias.').waitFor();
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await page.getByText('Guardamos tus preferencias.').waitFor();

  await page.goto(`${BASE}/dashboard`);
  await page.getByRole('heading', { name: 'Oportunidades en tus productos' }).waitFor();
  assert.equal(await page.getByText('Cargá tus productos habituales para ver cuándo están más baratos.').count(), 0);

  await page.goto(`${BASE}/plan-semanal`);
  await page.getByRole('button', { name: 'Generar mi plan' }).click();
  await page.waitForURL(/plan-semanal\?plan=/);
  await page.getByRole('button', { name: 'Usar este plan' }).click();
  await page.locator('.plan-status', { hasText: 'En uso' }).waitFor();
  // Con base comparable el plan cuenta aunque el ahorro sea $0; sin base no suma.
  const hasBaseline = (await page.getByText('No mostramos ahorro').count()) === 0;

  await page.getByRole('link', { name: 'Resumen' }).click();
  await page.waitForURL(`${BASE}/dashboard`);
  await page.getByText('De tu plan en uso', { exact: false }).waitFor();
  assert.ok(await page.locator('.dashboard-visits li').count() >= 1);
  const plans = await page.locator('.dashboard-savings .muted').first().innerText();
  assert.match(plans, hasBaseline ? /1 plan/ : /sin planes/);
  await page.screenshot({ path: resolve(SHOTS, 'resumen-escritorio.png'), fullPage: true });

  await page.getByRole('link', { name: 'Ver el plan completo' }).click();
  await page.getByRole('button', { name: 'Ya hice esta compra' }).click();
  await page.locator('.plan-status', { hasText: 'Hecho' }).waitFor();
  await page.goto(`${BASE}/dashboard`);
  await page.getByText('No tenés un plan para estos días.').waitFor();
  assert.match(await page.locator('.dashboard-savings .muted').first().innerText(), hasBaseline ? /1 plan/ : /sin planes/, 'completar no duplica');
  await page.getByText(/Todavía no registramos compras/).waitFor();
});

test('móvil 390 px: el resumen no desborda', async () => {
  const width = 390;
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole('heading', { name: 'Ahorro estimado' }).waitFor();
  assert.ok(await overflow(page) <= 0, 'sin desborde horizontal');
  await page.screenshot({ path: resolve(SHOTS, 'resumen-movil.png'), fullPage: true });
});
