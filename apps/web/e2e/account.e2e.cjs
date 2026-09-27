// E2E de onboarding, compras habituales, despensa y preferencias (P4-02) en Edge real
// contra web + API corriendo (`npm.cmd run dev`, o `E2E_BASE_URL`). Usa el dataset DEMO
// (`npm.cmd run db:seed`) y crea cuentas ficticias e2e-cuenta-*@example.com.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p4-02');
const PASSWORD = 'frase-de-prueba-e2e';
const stamp = Date.now();
const ana = `e2e-cuenta-ana-${stamp}@example.com`;
const beto = `e2e-cuenta-beto-${stamp}@example.com`;
mkdirSync(SHOTS, { recursive: true });

let browser;
let context;
let page;

/** Cuenta los pedidos de geolocalización: no debe haber ninguno sin una acción de la persona. */
const GEO_SPY = () => {
  window.__geoCalls = 0;
  const geo = navigator.geolocation;
  if (!geo) return;
  const original = geo.getCurrentPosition.bind(geo);
  geo.getCurrentPosition = (...args) => {
    window.__geoCalls += 1;
    return original(...args);
  };
};

async function newPage(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', ...options });
  await ctx.addInitScript(GEO_SPY);
  return { ctx, page: await ctx.newPage() };
}

async function registerAs(target, email) {
  await target.goto(`${BASE}/register`);
  await target.getByLabel('Email').fill(email);
  await target.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Crear cuenta' }).click();
  await target.waitForURL(/\/onboarding$/);
  await target.getByRole('heading', { name: 'Armemos tu compra habitual' }).waitFor();
}

async function loginAs(target, email, next = '/inicio') {
  await target.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel('Email').fill(email);
  await target.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await target.getByRole('button', { name: 'Ingresar' }).click();
  await target.waitForURL(`${BASE}${next}`);
}

const geoCalls = (target) => target.evaluate(() => window.__geoCalls);
const stepTitle = (target) => target.locator('.onboarding-step-title');
const needRow = (target, name) => target.locator('.need-row', { has: target.getByRole('heading', { name, exact: true }) });

async function pickCanonical(target, label, term, name) {
  await target.getByLabel(label).fill(term);
  await target.locator('.picker-option', { hasText: name }).first().click();
}

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  ({ ctx: context, page } = await newPage());
});
after(async () => {
  await browser?.close();
});

test('el registro lleva al onboarding, que guarda la zona sin pedir ubicación', async () => {
  await registerAs(page, ana);
  assert.match(await stepTitle(page).innerText(), /Tu zona$/, 'arranca en el paso 1');
  await page.getByLabel('Localidad o barrio').fill('Lanús');
  await page.getByLabel('Provincia').selectOption('Buenos Aires');
  assert.equal(await geoCalls(page), 0, 'no se pidió la ubicación al cargar');
  await page.screenshot({ path: resolve(SHOTS, 'onboarding-zona.png'), fullPage: true });

  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.waitForURL(/paso=2/);
  await page.getByRole('radio', { name: '10 km' }).check();
  await page.getByRole('radio', { name: 'Sin límite' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.waitForURL(/paso=3/);
  assert.equal(await geoCalls(page), 0);
});

test('el onboarding se retoma después de recargar, con lo guardado', async () => {
  await page.goto(`${BASE}/onboarding`);
  await stepTitle(page).getByText('Productos habituales').waitFor();
  // Sin rutina todavía: se puede seguir sin productos.
  await page.getByRole('button', { name: 'Continuar sin productos' }).waitFor();

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.waitForURL(/paso=2/);
  assert.equal(await page.getByRole('radio', { name: '10 km' }).isChecked(), true);
  assert.equal(await page.getByRole('radio', { name: 'Sin límite' }).isChecked(), true);
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.waitForURL(/paso=1/);
  assert.equal(await page.getByLabel('Localidad o barrio').inputValue(), 'Lanús');
  assert.equal(await page.getByLabel('Provincia').inputValue(), 'Buenos Aires');
  await page.goto(`${BASE}/onboarding?paso=3`);
});

test('productos habituales: 5 kg de pollo semanal y un reintento que no duplica', async () => {
  await stepTitle(page).getByText('Productos habituales').waitFor();
  await pickCanonical(page, 'Buscá un producto habitual', 'pollo', 'Pollo entero fresco');
  const quantity = page.getByLabel(/Cuánto pollo entero fresco comprás/);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'quantity', 'el foco pasa a la cantidad');
  await quantity.fill('abc');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Escribí una cantidad mayor que cero').waitFor();
  assert.equal(await quantity.getAttribute('aria-invalid'), 'true');
  await quantity.fill('5');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Agregaste Pollo entero fresco.').waitFor();
  await needRow(page, 'Pollo entero fresco').getByText('5 kg por compra · cada semana').waitFor();

  // La respuesta del alta se pierde aunque la API la guardó; el reintento da 409 y se toma como "ya estaba".
  let dropped = false;
  await page.route('**/api/shopping-routines/*/items', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      return route.abort('failed');
    }
    return route.continue();
  });
  await pickCanonical(page, 'Buscá un producto habitual', 'arroz', 'Arroz largo fino');
  await page.getByLabel(/Cuánto arroz largo fino comprás/).fill('500');
  await page.getByLabel('Unidad').selectOption('G');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByRole('alert').getByText(/No pudimos conectar/).waitFor();
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByText('Arroz largo fino ya estaba en tu lista.').waitFor();
  await page.unroute('**/api/shopping-routines/*/items');
  // 500 g se guardan en la unidad del canónico.
  await needRow(page, 'Arroz largo fino').getByText('0,5 kg por compra').waitFor();
  assert.equal(await page.locator('.onboarding-needs .need-row').count(), 2, 'sin duplicados');

  await page.reload();
  await needRow(page, 'Pollo entero fresco').waitFor();
  assert.equal(await page.locator('.onboarding-needs .need-row').count(), 2, 'persiste tras recargar');
  await page.screenshot({ path: resolve(SHOTS, 'onboarding-productos.png'), fullPage: true });
});

test('terminar el onboarding lo marca y deja de aparecer el aviso', async () => {
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.waitForURL(/paso=4/);
  const summary = page.locator('.onboarding-summary');
  await summary.getByText('Lanús, Buenos Aires').waitFor();
  await summary.getByText('No compartida').waitFor();
  await summary.getByText('10 km').waitFor();
  await summary.getByText('Sin límite').waitFor();
  assert.equal(await summary.locator('div', { hasText: 'Productos habituales' }).locator('dd').innerText(), '2');
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.waitForURL(`${BASE}/mis-compras`);
  // Una sola rutina: el alta perdida y su reintento no crearon otra.
  assert.equal(await page.locator('.routine-card').count(), 1);

  await page.goto(`${BASE}/inicio`);
  await page.getByText('2 productos habituales').waitFor();
  assert.equal(await page.getByText('Terminá de configurar tu cuenta').count(), 0);
});

test('despensa: 2 kg de pollo aparecen junto a la necesidad', async () => {
  await page.goto(`${BASE}/mi-despensa`);
  await page.getByText('Tu despensa está vacía').waitFor();
  await pickCanonical(page, 'Buscá un producto', 'pollo', 'Pollo entero fresco');
  await page.getByLabel(/Cuánto pollo entero fresco tenés/).fill('2');
  await page.getByRole('button', { name: 'Agregar a la despensa' }).click();
  await page.getByText('Agregaste Pollo entero fresco a tu despensa.').waitFor();
  await needRow(page, 'Pollo entero fresco').getByText('2 kg', { exact: true }).waitFor();

  // Lo que ya está no se puede volver a elegir.
  await page.getByLabel('Buscá un producto').fill('pollo');
  const taken = page.locator('.picker-option', { hasText: 'Pollo entero fresco' });
  await taken.waitFor();
  assert.equal(await taken.isDisabled(), true);
  await page.getByLabel('Buscá un producto').fill('');

  await page.goto(`${BASE}/mis-compras`);
  await needRow(page, 'Pollo entero fresco').getByText('En tu despensa: 2 kg').waitFor();
  await needRow(page, 'Arroz largo fino').getByText('Sin cargar en la despensa').waitFor();
  await page.screenshot({ path: resolve(SHOTS, 'mis-compras-escritorio.png'), fullPage: true });
});

test('editar una necesidad: frecuencia propia, marcas y error junto al campo', async () => {
  const pollo = needRow(page, 'Pollo entero fresco');
  await pollo.getByRole('button', { name: 'Editar Pollo entero fresco' }).click();
  await pollo.getByLabel(/Cuánto pollo entero fresco comprás/).fill('4,5');
  await pollo.getByLabel('Cada cuánto').selectOption({ label: 'Cada 15 días' });
  await pollo.getByText('Más opciones: presentación, marcas y reemplazos').click();
  await pollo.getByLabel('Marcas que preferís').fill('Granja');
  await pollo.getByLabel('Marcas que no querés').fill('granja');
  await pollo.getByRole('button', { name: 'Guardar cambios' }).click();
  // La API rechaza la marca en las dos listas y el mensaje queda junto a los campos.
  const brandError = pollo.locator('.field-error').first();
  await brandError.waitFor();
  assert.equal(await pollo.getByLabel('Marcas que preferís').getAttribute('aria-invalid'), 'true');

  await pollo.getByLabel('Marcas que no querés').fill('');
  await pollo.getByRole('button', { name: 'Guardar cambios' }).click();
  await pollo.getByText('4,5 kg por compra').waitFor();
  await pollo.getByText(/Cada 15 días, desde el/).waitFor();
  await pollo.getByText(/Marcas: Granja/).waitFor();

  await page.reload();
  await needRow(page, 'Pollo entero fresco').getByText('4,5 kg por compra').waitFor();
});

test('eliminar pide confirmación y se puede cancelar', async () => {
  const arroz = needRow(page, 'Arroz largo fino');
  await arroz.getByRole('button', { name: 'Eliminar' }).click();
  await arroz.getByText(/¿Sacar Arroz largo fino de/).waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    'Sí, eliminar',
    'el foco va a la confirmación',
  );
  await arroz.getByRole('button', { name: 'Cancelar' }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Eliminar', 'cancelar devuelve el foco');
  await arroz.getByRole('button', { name: 'Eliminar' }).click();
  await arroz.getByRole('button', { name: 'Sí, eliminar' }).click();
  await arroz.waitFor({ state: 'detached' });
  await page.reload();
  await needRow(page, 'Pollo entero fresco').waitFor();
  assert.equal(await needRow(page, 'Arroz largo fino').count(), 0, 'el borrado persiste');

  await page.goto(`${BASE}/mi-despensa`);
  const pollo = needRow(page, 'Pollo entero fresco');
  await pollo.getByRole('button', { name: 'Editar Pollo entero fresco' }).click();
  await pollo.getByLabel(/Cuánto pollo entero fresco tenés/).fill('1,5');
  await pollo.getByRole('button', { name: 'Guardar' }).click();
  await pollo.getByText('1,5 kg', { exact: true }).waitFor();
  await pollo.getByRole('button', { name: 'Eliminar' }).click();
  await pollo.getByRole('button', { name: 'Sí, eliminar' }).click();
  await page.getByText('Tu despensa está vacía').waitFor();
});

test('el teclado alcanza para cargar la despensa', async () => {
  await page.goto(`${BASE}/mi-despensa`);
  await page.getByLabel('Buscá un producto').focus();
  await page.keyboard.type('leche');
  await page.getByRole('button', { name: /^Leche entera/ }).waitFor();
  await page.keyboard.press('Tab');
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /^Leche entera/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await needRow(page, 'Leche entera').getByText('2 L', { exact: true }).waitFor();
});

test('cuenta sin rutina y sin ubicación: todo se puede omitir y el sitio sigue abierto', async () => {
  const { ctx, page: other } = await newPage();
  await registerAs(other, beto);
  // Onboarding sin completar no bloquea el comparador público ni la cuenta.
  await other.goto(`${BASE}/buscar?q=arroz`);
  await other.locator('.product-card').first().waitFor();
  await other.goto(`${BASE}/inicio`);
  await other.getByText('Terminá de configurar tu cuenta').waitFor();
  await other.getByRole('link', { name: 'Continuar configuración' }).click();
  await other.waitForURL(/\/onboarding/);

  await other.getByRole('button', { name: 'Omitir este paso' }).click();
  await other.waitForURL(/paso=2/);
  await other.getByRole('button', { name: 'Omitir este paso' }).click();
  await other.waitForURL(/paso=3/);
  await other.getByRole('button', { name: 'Continuar sin productos' }).click();
  await other.waitForURL(/paso=4/);
  await other.locator('.onboarding-summary').getByText('Sin cargar').waitFor();
  await other.getByRole('button', { name: 'Terminar' }).click();
  await other.waitForURL(`${BASE}/mis-compras`);
  await other.getByText('Todavía no cargaste tu compra habitual').waitFor();
  assert.equal(await geoCalls(other), 0, 'nunca se pidió la ubicación');
  await other.goto(`${BASE}/preferencias`);
  assert.equal(await other.getByLabel('Localidad o barrio').inputValue(), '');
  await other.getByRole('button', { name: 'Usar mi ubicación actual' }).waitFor();
  await ctx.close();
});

test('la ubicación exacta se pide solo al tocar el botón y se puede quitar', async () => {
  const { ctx, page: located } = await newPage({
    permissions: ['geolocation'],
    geolocation: { latitude: -34.70612, longitude: -58.39281 },
  });
  await loginAs(located, ana, '/preferencias');
  await located.getByRole('button', { name: 'Usar mi ubicación actual' }).waitFor();
  assert.equal(await geoCalls(located), 0);
  await located.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await located.getByText('Ubicación guardada para calcular distancias.').waitFor();
  assert.equal(await geoCalls(located), 1);
  await located.getByRole('button', { name: 'Guardar preferencias' }).click();
  await located.getByText('Guardamos tus preferencias.').waitFor();
  await located.reload();
  await located.getByText('Ubicación guardada para calcular distancias.').waitFor();

  await located.getByRole('button', { name: 'Quitar ubicación' }).click();
  await located.getByRole('button', { name: 'Guardar preferencias' }).click();
  await located.getByText('Guardamos tus preferencias.').waitFor();
  await located.reload();
  await located.getByRole('button', { name: 'Usar mi ubicación actual' }).waitFor();
  await ctx.close();

  // Sin permiso: se avisa y se sigue con la localidad.
  const { ctx: deniedCtx, page: denied } = await newPage();
  await loginAs(denied, ana, '/preferencias');
  await denied.getByRole('button', { name: 'Usar mi ubicación actual' }).click();
  await denied.getByText(/Podés seguir con tu localidad/).waitFor();
  await deniedCtx.close();
});

test('preferencias: localidad incompleta se marca en el campo', async () => {
  await page.goto(`${BASE}/preferencias`);
  await page.getByLabel('Provincia').selectOption('');
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await page.getByText('Elegí la provincia.').waitFor();
  assert.equal(await page.getByLabel('Provincia').getAttribute('aria-invalid'), 'true');
  await page.getByLabel('Provincia').selectOption('Buenos Aires');
  await page.getByRole('radio', { name: '5 km' }).check();
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await page.getByText('Guardamos tus preferencias.').waitFor();
});

test('móvil 390 px: las páginas privadas no desbordan', async () => {
  const { ctx, page: phone } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await loginAs(phone, ana, '/mis-compras');
  for (const path of ['/onboarding?paso=1', '/onboarding?paso=3', '/mis-compras', '/mi-despensa', '/preferencias', '/inicio']) {
    await phone.goto(`${BASE}${path}`);
    await phone.locator('h1').waitFor();
    await phone.waitForLoadState('networkidle');
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${path}: sobra ${overflow}px`);
    await phone.screenshot({ path: resolve(SHOTS, `movil-${path.replace(/[/?=]/g, '-').replace(/^-/, '')}.png`), fullPage: true });
  }
  // El editor abierto también entra en la pantalla.
  await phone.goto(`${BASE}/mis-compras`);
  await needRow(phone, 'Pollo entero fresco').getByRole('button', { name: 'Editar Pollo entero fresco' }).click();
  await phone.getByText('Más opciones: presentación, marcas y reemplazos').click();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `editor: sobra ${overflow}px`);
  await phone.screenshot({ path: resolve(SHOTS, 'movil-editor.png'), fullPage: true });
  await ctx.close();
});

test('al cerrar sesión no quedan datos privados para la próxima cuenta', async () => {
  await page.goto(`${BASE}/mis-compras`);
  await needRow(page, 'Pollo entero fresco').waitFor();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/mis-compras`);
  await page.waitForURL(/\/login\?next=%2Fmis-compras$/);

  // Otra cuenta en la misma pestaña: no se muestra nada de lo de Ana.
  await page.getByLabel('Email').fill(beto);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(`${BASE}/mis-compras`);
  await page.getByText('Todavía no cargaste tu compra habitual').waitFor();
  assert.equal(await page.getByText('Pollo entero fresco').count(), 0);
  await page.goto(`${BASE}/mi-despensa`);
  await page.getByText('Tu despensa está vacía').waitFor();
  assert.equal(await page.getByText('Leche entera').count(), 0);
  await context.close();
});
