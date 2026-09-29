// E2E del plan semanal (P5-03) en Edge real contra web + API corriendo (`npm.cmd run dev`,
// o `E2E_BASE_URL`). Usa el dataset DEMO (`npm.cmd run db:seed`) y crea cuentas ficticias
// e2e-plan-*@example.com. Recorrido: rutina → despensa → generar → cronograma → recarga.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p5-03');
const PASSWORD = 'frase-de-prueba-e2e';
const stamp = Date.now();
const ana = `e2e-plan-ana-${stamp}@example.com`;
// Coto Caballito (DEMO): con 5 km alcanza varias sucursales con coordenadas.
const CABALLITO = { latitude: -34.6187, longitude: -58.4407 };
mkdirSync(SHOTS, { recursive: true });

let browser;
let context;
let page;
let firstPlanId;

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

async function loginAs(target, email, next) {
  await target.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel('Email').fill(email);
  await target.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Ingresar' }).click();
  await target.waitForURL(`${BASE}${next}`);
}

async function pickCanonical(target, label, term, name) {
  await target.getByLabel(label).fill(term);
  await target.locator('.picker-option', { hasText: name }).first().click();
}

/** Onboarding con dos productos habituales y sin zona; la ubicación exacta se carga después. */
async function onboardWithProducts(target) {
  await target.getByRole('button', { name: 'Omitir este paso' }).click();
  await target.waitForURL(/paso=2/);
  await target.getByRole('button', { name: 'Omitir este paso' }).click();
  await target.waitForURL(/paso=3/);
  await pickCanonical(target, 'Buscá un producto habitual', 'pollo', 'Pollo entero fresco');
  await target.getByLabel(/Cuánto pollo entero fresco comprás/).fill('3');
  await target.getByRole('button', { name: 'Agregar', exact: true }).click();
  await target.getByText('Agregaste Pollo entero fresco.').waitFor();
  await pickCanonical(target, 'Buscá un producto habitual', 'arroz', 'Arroz largo fino');
  await target.getByLabel(/Cuánto arroz largo fino comprás/).fill('2');
  await target.getByRole('button', { name: 'Agregar', exact: true }).click();
  await target.getByText('Agregaste Arroz largo fino.').waitFor();
  await target.getByRole('button', { name: 'Continuar', exact: true }).click();
  await target.waitForURL(/paso=4/);
  await target.getByRole('button', { name: 'Terminar' }).click();
  await target.waitForURL(`${BASE}/mis-compras`);
}

const lineFor = (target, name) => target.locator('.plan-line', { has: target.locator('.plan-line-name', { hasText: name }) });
const planId = (target) => new URL(target.url()).searchParams.get('plan');

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  ({ ctx: context, page } = await newPage({ permissions: ['geolocation'], geolocation: CABALLITO }));
});
after(async () => {
  await browser?.close();
});

test('sin plan todavía, la pantalla dice qué falta para armarlo', async () => {
  await registerAs(page, ana);
  await onboardWithProducts(page);
  await page.goto(`${BASE}/plan-semanal`);
  await page.getByRole('heading', { name: 'Tu plan de compras' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Plan semanal' }).getAttribute('aria-current'), 'page');
  await page.getByText('Todavía no generaste un plan').waitFor();
  await page.getByText('✓ Tus productos habituales').waitFor();
  await page.getByRole('link', { name: 'Cargarla' }).waitFor();
});

test('rutina → despensa → generar: cronograma por día y sucursal con cantidades, precios y motivos', async () => {
  await page.goto(`${BASE}/preferencias`);
  await page.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await page.getByText('Ubicación guardada para calcular distancias.').waitFor();
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await page.getByText('Guardamos tus preferencias.').waitFor();

  await page.goto(`${BASE}/mi-despensa`);
  await pickCanonical(page, 'Buscá un producto', 'pollo', 'Pollo entero fresco');
  await page.getByLabel(/Cuánto pollo entero fresco tenés/).fill('1');
  await page.getByRole('button', { name: 'Agregar a la despensa' }).click();
  await page.getByText('Agregaste Pollo entero fresco a tu despensa.').waitFor();

  await page.goto(`${BASE}/plan-semanal`);
  await page.getByRole('button', { name: 'Generar mi plan' }).click();
  await page.waitForURL(/plan-semanal\?plan=/);
  firstPlanId = planId(page);
  const title = page.locator('#plan-title');
  await title.waitFor();
  assert.match(await title.innerText(), /^Plan del /);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'plan-title', 'el foco va al plan nuevo');
  await page.getByText('Borrador', { exact: true }).waitFor();
  await page.locator('.demo-notice').waitFor();

  // 3 kg por semana − 1 kg en la despensa: 2 kg a comprar, por peso.
  const pollo = lineFor(page, 'Pollo entero fresco');
  await pollo.getByText('Unos 2 kg (se pesa en la caja)').waitFor();
  const arroz = lineFor(page, 'Arroz largo fino');
  await arroz.getByText(/envases? · 2 kg en total/).waitFor();
  for (const line of [pollo, arroz]) {
    assert.ok((await line.locator('.plan-line-reason').innerText()).length > 10, 'cada línea explica su elección');
    await line.getByText(/^Precio del /).waitFor();
  }
  assert.ok(await page.locator('.plan-visit').count() >= 1);
  assert.ok(await page.locator('.plan-visit').count() <= 2, 'máximo de 2 sucursales por defecto');
  await page.locator('.plan-figures').getByText('Productos').waitFor();
  await page.getByText(/km ida y vuelta/).first().waitFor();
  await page.getByText('Tené en cuenta').waitFor();
  await page.getByText(/último precio observado/).waitFor();
  await page.locator('details.plan-how summary').click();
  await page.locator('.plan-how').getByText(/de tu despensa/).waitFor();
  await page.screenshot({ path: resolve(SHOTS, 'plan-escritorio.png'), fullPage: true });
});

test('recargar muestra el mismo plan, con o sin el id en la URL', async () => {
  const id = planId(page);
  const total = await page.locator('.plan-figure-main').first().innerText();
  const lines = await page.locator('.plan-line').allInnerTexts();
  await page.reload();
  await page.locator('#plan-title').waitFor();
  assert.equal(planId(page), id);
  assert.equal(await page.locator('.plan-figure-main').first().innerText(), total);
  assert.deepEqual(await page.locator('.plan-line').allInnerTexts(), lines);

  await page.goto(`${BASE}/plan-semanal`);
  await page.locator('#plan-title').waitFor();
  assert.deepEqual(await page.locator('.plan-line').allInnerTexts(), lines, 'sin id muestra el último plan');
});

test('usar el plan y marcarlo como hecho, sin prometer ahorro confirmado', async () => {
  await page.getByRole('button', { name: 'Usar este plan' }).click();
  await page.locator('.plan-status', { hasText: 'En uso' }).waitFor();
  await page.getByText('Este es tu plan en uso para estos días.').waitFor();
  await page.getByRole('button', { name: 'Ya hice esta compra' }).click();
  await page.locator('.plan-status', { hasText: 'Hecho' }).waitFor();
  await page.getByText(/^Marcado como hecho el /).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Usar este plan' }).count(), 0);
  await page.reload();
  await page.locator('.plan-status', { hasText: 'Hecho' }).waitFor();
});

test('una respuesta perdida al generar se reintenta sin duplicar el plan', async () => {
  const before = firstPlanId;
  await page.goto(`${BASE}/plan-semanal?plan=${before}`);
  await page.locator('.plan-status', { hasText: 'Hecho' }).waitFor();
  let lost = false;
  await page.route('**/api/shopping-plans/generate', async (route) => {
    if (lost) return route.continue();
    lost = true;
    // La API guarda el plan, pero la respuesta nunca llega al navegador.
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Generar de nuevo con precios actuales' }).click();
  await page.getByText('Podés reintentar: no se va a duplicar.').waitFor();
  await page.getByRole('button', { name: 'Generar de nuevo con precios actuales' }).click();
  await page.waitForURL((url) => url.searchParams.get('plan') !== before);
  await page.locator('#plan-title').waitFor();
  await page.unroute('**/api/shopping-plans/generate');

  const history = page.locator('.plan-history-link');
  await history.first().waitFor();
  assert.equal(await history.count(), 2, 'el reintento devolvió el plan guardado en vez de crear otro');
  assert.equal(await page.locator('.plan-history-link[aria-current="page"]').count(), 1);

  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get('plan') === before);
  await page.locator('.plan-status', { hasText: 'Hecho' }).waitFor();
});

test('móvil 390 px: sin desbordes en el plan', async () => {
  const { ctx, page: mobile } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await loginAs(mobile, ana, '/plan-semanal');
  await mobile.locator('#plan-title').waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `desborde horizontal de ${overflow}px`);
  await mobile.screenshot({ path: resolve(SHOTS, 'plan-movil.png'), fullPage: true });
  await ctx.close();
});

test('sin ubicación el plan se genera parcial y explica qué falta, sin ahorro', async () => {
  const { ctx, page: other } = await newPage();
  await registerAs(other, `e2e-plan-beto-${stamp}@example.com`);
  await onboardWithProducts(other);
  await other.goto(`${BASE}/plan-semanal`);
  await other.getByRole('button', { name: 'Generar mi plan' }).click();
  await other.waitForURL(/plan-semanal\?plan=/);
  await other.getByRole('heading', { name: 'No pudimos incluir' }).waitFor();
  assert.equal(await other.getByText('Falta tu zona: cargala en Preferencias para elegir sucursales.').count(), 2);
  assert.equal(await other.getByText('Ahorro estimado').count(), 0);
  assert.equal(await other.locator('.plan-visit').count(), 0);
  await other.getByRole('link', { name: 'Ir a Preferencias' }).first().waitFor();
  await ctx.close();
});
