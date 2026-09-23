// E2E de búsqueda y comparación en Edge real contra web + API corriendo
// (`npm.cmd run dev`, o `E2E_BASE_URL` si usás otro puerto). Usa el dataset DEMO:
// correr `npm.cmd run db:seed` antes. No escribe datos.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p3-02');
mkdirSync(SHOTS, { recursive: true });

let browser;
let context;
let page;

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
  page = await context.newPage();
});
after(async () => {
  await browser?.close();
});

/** Primer importe en pesos de un texto, como número comparable. */
function amountOf(text) {
  const match = /\d[\d.]*,\d{2}/.exec(text);
  return match ? Number(match[0].replace(/\./g, '').replace(',', '.')) : Number.NaN;
}

test('la portada busca sin pedir cuenta y lleva el término en la URL', async () => {
  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByLabel('Buscá un producto').fill('arroz');
  await page.getByRole('button', { name: 'Comparar precios' }).click();
  await page.waitForURL(`${BASE}/buscar?q=arroz`);
  // Comparar es público: no hubo redirección a login.
  await page.getByRole('heading', { name: 'Comparar precios' }).waitFor();
  await page.getByText(/Precios de demostración/).waitFor();
});

test('los resultados muestran precio, precio por unidad y sucursal', async () => {
  await page.goto(`${BASE}/buscar?q=arroz`);
  const cards = page.locator('.product-card');
  await cards.first().waitFor();
  assert.ok((await cards.count()) >= 3, 'el dataset demo tiene varias presentaciones de arroz');

  const first = cards.first();
  const price = amountOf(await first.locator('.product-price').innerText());
  assert.ok(price > 0, 'la tarjeta muestra un precio');
  const unitPrice = await first.locator('.product-unit-price').innerText();
  assert.match(unitPrice, /por (kg|litro|unidad)/);
  assert.match(await first.locator('.product-store').innerText(), /\w+/);
  assert.match(await first.locator('.product-freshness').innerText(), /precio de/);

  await page.screenshot({ path: resolve(SHOTS, 'buscar-escritorio.png'), fullPage: true });
});

test('un término sin resultados lo dice, y la búsqueda vacía pide escribir', async () => {
  await page.goto(`${BASE}/buscar?q=producto-que-no-existe`);
  await page.getByText(/No encontramos productos/).waitFor();
  await page.goto(`${BASE}/buscar`);
  await page.getByText('Escribí qué estás buscando').waitFor();
});

test('filtrar por cadena y por localidad queda en la URL y sobrevive al "atrás"', async () => {
  await page.goto(`${BASE}/buscar?q=arroz`);
  await page.locator('.product-card').first().waitFor();

  await page.getByLabel('Cadena').selectOption({ label: 'Coto' });
  await page.waitForURL(/cadena=/);
  await page.getByLabel('Localidad').selectOption({ label: 'Lanús' });
  await page.waitForURL(/ciudad=/);
  await page.locator('.product-card').first().waitFor();
  const shared = page.url();
  // El alcance se informa: cuántas sucursales se miraron.
  assert.match(await page.locator('.results-count').innerText(), /sucursal/);

  await page.goBack();
  await page.waitForURL((url) => !url.searchParams.has('ciudad'));
  assert.equal(new URL(page.url()).searchParams.get('cadena') !== null, true, 'el filtro anterior sigue aplicado');

  // Un enlace compartido reproduce la misma búsqueda.
  const fresh = await context.newPage();
  await fresh.goto(shared);
  await fresh.locator('.product-card').first().waitFor();
  assert.equal(await fresh.getByLabel('Cadena').inputValue() !== '', true);
  assert.equal(await fresh.getByLabel('Localidad').inputValue() !== '', true);
  await fresh.close();
});

test('la comparación se puede ordenar por envase y no por distancia sin ubicación', async () => {
  await page.goto(`${BASE}/buscar?q=arroz`);
  await page.locator('.product-card-link').first().click();
  await page.waitForURL(/\/producto\//);
  await page.locator('.offer-row').first().waitFor();

  // Sin ubicación, ordenar por distancia no está disponible.
  assert.equal(await page.locator('option[value="DISTANCE"]').first().isDisabled(), true);

  await page.getByLabel('Ordenar por').selectOption('PRICE');
  await page.waitForURL(/orden=envase/);
  await page.locator('.offer-row').first().waitFor();
  await page.getByText(/Ordenado por precio del envase/).waitFor();
  // Las ofertas se muestran en dos grupos (exacto y alternativas); cada uno respeta el orden.
  for (const group of [0, 1]) {
    const prices = (await page.locator('.offer-group').nth(group).locator('.offer-price').allInnerTexts()).map(amountOf);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), `grupo ${group} ordenado por precio de envase`);
  }
});

test('la ficha compara el producto exacto y sus alternativas, con el precio por kilo', async () => {
  await page.goto(`${BASE}/buscar?q=arroz`);
  await page.locator('.product-card').first().waitFor();
  const chosen = await page.locator('.product-card h3').first().innerText();
  await page.locator('.product-card-link').first().click();
  await page.waitForURL(/\/producto\//);

  await page.getByRole('heading', { name: chosen }).waitFor();
  await page.getByRole('heading', { name: 'Este producto, por sucursal' }).waitFor();
  await page.getByRole('heading', { name: 'Alternativas equivalentes' }).waitFor();

  const exact = page.locator('.offer-group').first().locator('.offer-row');
  await exact.first().waitFor();
  const exactBadges = await exact.locator('.match-badge').allInnerTexts();
  assert.equal(exactBadges.every((badge) => badge === 'Producto exacto'), true);

  const alternatives = page.locator('.offer-group').nth(1).locator('.offer-row .match-badge');
  const alternativeBadges = await alternatives.allInnerTexts();
  assert.ok(alternativeBadges.length > 0, 'hay alternativas del mismo canónico');
  assert.equal(alternativeBadges.every((badge) => badge === 'Alternativa'), true);

  // El orden predeterminado es por precio por unidad base, de menor a mayor.
  const unitPrices = (await page.locator('.offer-unit-price').allInnerTexts()).map(amountOf);
  const exactCount = await exact.count();
  const exactPrices = unitPrices.slice(0, exactCount);
  assert.deepEqual(exactPrices, [...exactPrices].sort((a, b) => a - b));

  await page.screenshot({ path: resolve(SHOTS, 'producto-escritorio.png'), fullPage: true });
});

test('una promoción muestra su condición sin tapar el precio regular', async () => {
  // El seed deja un 20% en Carrefour Almagro para el arroz Pampa de 1 kg.
  await page.goto(`${BASE}/buscar?q=arroz`);
  const pampa = page.locator('.product-card', { hasText: 'Pampa 1 kg' }).first();
  await pampa.waitFor();
  await pampa.locator('.product-card-link').click();
  await page.waitForURL(/\/producto\//);
  await page.locator('.offer-row').first().waitFor();

  const promoted = page.locator('.offer-row', { has: page.locator('.promotion-chip') }).first();
  await promoted.waitFor();
  const regular = amountOf(await promoted.locator('.offer-price').innerText());
  const promotion = await promoted.locator('.promotion-chip').innerText();
  assert.match(promotion, /(Descuento|2x1|Segunda unidad|Precio fijo)/);
  assert.match(promotion, /(en una unidad|llevando \d+ unidades)/);
  // El primer importe del chip es el total con la promoción.
  const promotionalAmount = amountOf(promotion.slice(promotion.indexOf(':') + 1));
  assert.ok(promotionalAmount < regular, 'el precio con promoción es menor que el regular');
  assert.ok(regular > 0, 'el precio regular sigue visible para comparar');
});

test('sin ubicación no se inventan distancias y la vista móvil no desborda', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR' });
  const small = await mobile.newPage();
  await small.goto(`${BASE}/buscar?q=leche`);
  await small.locator('.product-card').first().waitFor();
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `sin desborde horizontal (sobra ${overflow}px)`);
  await small.screenshot({ path: resolve(SHOTS, 'buscar-movil.png'), fullPage: true });

  await small.locator('.product-card-link').first().click();
  await small.waitForURL(/\/producto\//);
  await small.locator('.offer-row').first().waitFor();
  // Sin coordenadas, ninguna fila afirma una distancia.
  const meta = await small.locator('.offer-meta').allInnerTexts();
  assert.equal(meta.some((text) => /\bkm\b|\bm\b/.test(text.replace(/[^\w\s]/g, ''))), false, 'no se informan distancias');
  await small.getByText(/Sin tu ubicación no podemos calcular distancias/).waitFor();
  await small.screenshot({ path: resolve(SHOTS, 'producto-movil.png') });
  await small.close();
  await mobile.close();
});

test('el teclado alcanza para buscar y abrir un producto', async () => {
  await page.goto(`${BASE}/buscar`);
  await page.getByLabel('Buscá un producto').focus();
  await page.keyboard.type('yerba');
  await page.waitForURL(/q=yerba/);
  await page.locator('.product-card').first().waitFor();

  // Tabular desde el campo llega a los filtros y a la primera tarjeta.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.className ?? '');
  assert.match(focused, /product-card-link/, 'la primera tarjeta recibe el foco');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/producto\//);
});

test('un backend caído se informa con opción de reintentar', async () => {
  const offline = await browser.newContext({ locale: 'es-AR' });
  const offlinePage = await offline.newPage();
  await offlinePage.route('**/api/products**', (route) => route.abort());
  await offlinePage.goto(`${BASE}/buscar?q=arroz`);
  await offlinePage.getByText('No pudimos traer los datos').waitFor();
  await offlinePage.getByRole('button', { name: 'Reintentar' }).waitFor();
  // Los filtros no se pierden al fallar la consulta.
  assert.equal(new URL(offlinePage.url()).searchParams.get('q'), 'arroz');
  await offline.close();
});
