// E2E del recorrido completo con beneficios de pago (P10-02) en Edge real contra web + API
// corriendo (`npm.cmd run dev`, o `E2E_BASE_URL`). Usa el dataset DEMO (`npm.cmd run db:seed`) y
// crea cuentas ficticias e2e-recorrido-*@example.com y una alerta propia.
// Recorrido: registro → medios de pago → rutina → zona → despensa → comparación → historial
// → alerta → topes informados → plan con pagar hoy, reintegro y condiciones.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p10-02');
const PASSWORD = 'frase-de-prueba-e2e';
const stamp = Date.now();
const email = `e2e-recorrido-${stamp}@example.com`;
// Coto Caballito (DEMO): con 5 km alcanza Carrefour Almagro, Coto Caballito y Vea Flores.
const CABALLITO = { latitude: -34.6187, longitude: -58.4407 };
mkdirSync(SHOTS, { recursive: true });

let browser;
let page;

async function newPage(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', ...options });
  return { ctx, page: await ctx.newPage() };
}

async function pickCanonical(target, label, term, name) {
  await target.getByLabel(label).fill(term);
  await target.locator('.picker-option', { hasText: name }).first().click();
}

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  ({ page } = await newPage({ permissions: ['geolocation'], geolocation: CABALLITO }));
});
after(async () => {
  await browser?.close();
});

test('registro y onboarding: los medios de pago son opcionales y explican para qué se usan', async () => {
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL(/\/onboarding$/);

  await page.getByRole('button', { name: 'Omitir este paso' }).click();
  await page.waitForURL(/paso=2/);
  await page.getByText('Medios de pago (opcional)').click();
  await page.getByText('No pedimos números de tarjeta.').waitFor();
  await page.getByRole('checkbox', { name: 'Tarjeta de crédito' }).check();
  await page.getByLabel('Bancos y billeteras', { exact: true }).fill('Banco Demo');
  await page.getByRole('button', { name: 'Agregar banco' }).click();
  await page.getByRole('list', { name: 'Bancos y billeteras cargados' }).getByRole('listitem').filter({ hasText: 'Banco Demo' }).waitFor();
  // Enter agrega, no envía el paso; un repetido sin importar mayúsculas se rechaza.
  await page.getByLabel('Bancos y billeteras', { exact: true }).fill('banco demo');
  await page.getByLabel('Bancos y billeteras', { exact: true }).press('Enter');
  await page.getByText('Ya está en la lista.').waitFor();
  assert.match(page.url(), /paso=2/);
  await page.getByLabel('Bancos y billeteras', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.waitForURL(/paso=3/);

  await pickCanonical(page, 'Buscá un producto habitual', 'pollo', 'Pollo entero fresco');
  await page.getByLabel(/Cuánto pollo entero fresco comprás/).fill('3');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Agregaste Pollo entero fresco.').waitFor();
  await pickCanonical(page, 'Buscá un producto habitual', 'arroz', 'Arroz largo fino');
  await page.getByLabel(/Cuánto arroz largo fino comprás/).fill('2');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Agregaste Arroz largo fino.').waitFor();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.waitForURL(/paso=4/);
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.waitForURL(`${BASE}/mis-compras`);
});

test('preferencias: zona y medios de pago guardados; despensa', async () => {
  await page.goto(`${BASE}/preferencias`);
  assert.equal(await page.getByRole('checkbox', { name: 'Tarjeta de crédito' }).isChecked(), true, 'lo del onboarding quedó guardado');
  assert.equal(await page.getByRole('checkbox', { name: 'Tarjeta de débito' }).isChecked(), false);
  await page.getByRole('list', { name: 'Bancos y billeteras cargados' }).getByRole('listitem').filter({ hasText: 'Banco Demo' }).waitFor();
  await page.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await page.getByText('Ubicación guardada para calcular distancias.').waitFor();
  await page.getByRole('checkbox', { name: 'Tarjeta de débito' }).check();
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await page.getByText('Guardamos tus preferencias.').waitFor();
  await page.reload();
  assert.equal(await page.getByRole('checkbox', { name: 'Tarjeta de débito' }).isChecked(), true, 'persiste tras recargar');

  await page.goto(`${BASE}/mi-despensa`);
  await pickCanonical(page, 'Buscá un producto', 'pollo', 'Pollo entero fresco');
  await page.getByLabel(/Cuánto pollo entero fresco tenés/).fill('1');
  await page.getByRole('button', { name: 'Agregar a la despensa' }).click();
  await page.getByText('Agregaste Pollo entero fresco a tu despensa.').waitFor();
});

test('comparación: los beneficios de banco se ven con sus condiciones y no cambian el precio; historial y alerta', async () => {
  await page.goto(`${BASE}/buscar?q=arroz`);
  const card = page.locator('.product-card', { hasText: 'Pampa 1 kg' }).first();
  await card.waitFor();
  await card.locator('.product-card-link').click();
  await page.waitForURL(/\/producto\//);
  await page.locator('.offer-row').first().waitFor();

  await page.getByText(/Los beneficios de banco, billetera o socios no están incluidos en el precio/).first().waitFor();
  const carrefour = page.locator('.offer-row', { has: page.locator('.offer-benefits li', { hasText: '25% con crédito' }) }).first();
  await carrefour.waitFor();
  const chip = await carrefour.locator('.offer-benefits li', { hasText: '25% con crédito' }).innerText();
  assert.match(chip, /Banco Demo/);
  assert.match(chip, /tope de \$\s?5\.000,00 por compra/);
  assert.match(chip, /descuento en la caja/);
  // La promoción automática sigue siendo la del producto: el chip de pago no la reemplaza.
  assert.match(await carrefour.locator('.promotion-chip').innerText(), /Descuento/);
  await page.screenshot({ path: resolve(SHOTS, 'comparador-beneficios.png'), fullPage: true });

  await page.getByRole('heading', { name: 'Historial de precios' }).waitFor();
  await page.locator('.history-chart svg[role="img"]').waitFor();

  await page.locator('#crear-alerta').waitFor();
  await page.getByText(/sin promociones ni descuentos de bancos/).waitFor();
  await page.getByLabel('Precio objetivo por kilo').fill('1500');
  await page.getByRole('button', { name: 'Crear alerta' }).click();
  await page.getByText('Alerta creada.').waitFor();
  await page.goto(`${BASE}/alertas`);
  await page.getByText(/no incluye descuentos de bancos/).waitFor();
  await page.locator('.alert-rule-card', { hasText: '1.500,00' }).first().waitFor();
});

test('topes ya usados: informar, recargar y volver a "no sé"', async () => {
  await page.goto(`${BASE}/preferencias#topes-usados`);
  await page.getByRole('heading', { name: 'Topes de beneficios ya usados' }).waitFor();
  // El tope mensual de $ 8.000 del Banco Demo lo comparten Vea y el reintegro de Coto.
  const row = page.locator('.cap-usage-row', { hasText: '20% con débito del Banco Demo' });
  await row.waitFor();
  await row.getByText('tope compartido entre estas promociones').waitFor();
  await row.locator('.cap-usage-status', { hasText: 'no informado' }).waitFor();
  await row.getByLabel(/Ya usé en/).fill('mucho');
  await row.getByRole('button', { name: 'Guardar' }).click();
  await row.getByText(/Escribí un importe/).waitFor();
  await row.getByLabel(/Ya usé en/).fill('2000');
  await row.getByRole('button', { name: 'Guardar' }).click();
  await row.getByText(/te quedan \$\s?6\.000,00 de este tope/).waitFor();
  await page.reload();
  const reloaded = page.locator('.cap-usage-row', { hasText: '20% con débito del Banco Demo' });
  await reloaded.locator('.cap-usage-status', { hasText: /informaste \$\s?2\.000,00 usados de \$\s?8\.000,00/ }).waitFor();
  await reloaded.getByRole('button', { name: 'No sé cuánto usé' }).click();
  await reloaded.locator('.cap-usage-status', { hasText: 'no informado' }).waitFor();
  // Se vuelve a informar para el plan.
  await reloaded.getByLabel(/Ya usé en/).fill('0');
  await reloaded.getByRole('button', { name: 'Guardar' }).click();
  await reloaded.getByText(/te quedan \$\s?8\.000,00 de este tope/).waitFor();
});

test('plan: cada compra muestra lo que se paga en la caja, el beneficio con sus condiciones y los criterios usados', async () => {
  await page.goto(`${BASE}/plan-semanal`);
  await page.getByRole('button', { name: 'Generar mi plan' }).click();
  await page.waitForURL(/plan-semanal\?plan=/);
  await page.locator('#plan-title').waitFor();

  const visits = page.locator('.plan-visit');
  assert.ok(await visits.count() >= 1);
  for (const visit of await visits.all()) {
    // El importe de la visita es lo que se paga en la caja.
    assert.match(await visit.locator('.plan-visit-subtotal').innerText(), /\$/);
  }
  const paid = page.locator('.plan-visit', { has: page.locator('.payment-applied') });
  assert.ok(await paid.count() >= 1, 'con crédito y débito del Banco Demo declarados, alguna compra usa un beneficio');
  const first = paid.first();
  await first.getByText('Pagás en la caja').waitFor();
  const applied = await first.locator('.payment-applied').innerText();
  assert.match(applied, /Banco Demo/);
  assert.match(applied, /(descuento en la caja|reintegro)/);

  const figures = page.locator('.plan-figures');
  await figures.getByText('Pagás en las cajas').waitFor();
  const criteria = page.locator('details.plan-benefit-criteria');
  await criteria.locator('summary').click();
  await criteria.getByText(/Usamos lo que declaraste en Preferencias/).waitFor();
  await criteria.getByText(/El ahorro estimado no incluye reintegros/).waitFor();
  await page.screenshot({ path: resolve(SHOTS, 'plan-beneficios.png'), fullPage: true });

  // Recargar muestra el mismo plan guardado.
  const before = await page.locator('.plan-figures').innerText();
  await page.reload();
  await page.locator('#plan-title').waitFor();
  assert.equal(await page.locator('.plan-figures').innerText(), before);
});

test('móvil: preferencias con medios de pago y plan sin desbordes horizontales', async () => {
  const { ctx, page: phone } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/login?next=${encodeURIComponent('/preferencias')}`);
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await phone.getByRole('button', { name: 'Ingresar' }).click();
  await phone.waitForURL(`${BASE}/preferencias`);
  await phone.locator('.cap-usage-row').first().waitFor();
  for (const path of ['/preferencias', '/plan-semanal']) {
    await phone.goto(`${BASE}${path}`);
    await phone.locator(path === '/plan-semanal' ? '#plan-title' : '.cap-usage-row').first().waitFor();
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${path} no desborda (${overflow}px)`);
  }
  await phone.screenshot({ path: resolve(SHOTS, 'plan-movil.png'), fullPage: true });
  await ctx.close();
});
