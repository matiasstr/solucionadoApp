// E2E de auth en Edge real contra web + API corriendo (npm.cmd run dev). Ver README.
// Crea cuentas ficticias (e2e-*@example.com) en la base de desarrollo.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = resolve(__dirname, '../../../.cache/verification/p1-04');
const PASSWORD = 'frase-de-prueba-e2e';
const email = `e2e-${Date.now()}@example.com`;
mkdirSync(SHOTS, { recursive: true });

let browser;
let context;
let page;
const refreshCalls = [];

before(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
  page = await context.newPage();
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/refresh')) refreshCalls.push(request.url());
  });
});
after(async () => {
  await browser?.close();
});

async function noTokensInBrowserStorage() {
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.equal(/eyJ[\w-]+\.[\w-]+/.test(storage), false, 'sin JWT en storage');
  assert.equal(/[A-Za-z0-9_-]{43}/.test(storage), false, 'sin refresh token en storage');
  assert.equal(/token|eyJ/i.test(page.url()), false, 'sin tokens en la URL');
  const visible = await page.evaluate(() => document.cookie);
  assert.equal(visible.includes('tusofertas_refresh'), false, 'la cookie no es legible por JS');
}

test('visitante anónimo: portada sin pedir refresh y área privada redirige a login', async () => {
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Crear cuenta' }).first().waitFor();
  assert.equal(refreshCalls.length, 0, 'sin indicio de sesión no se consulta la API');
  await page.goto(`${BASE}/inicio`);
  await page.waitForURL(`${BASE}/login?next=%2Finicio`);
  await page.getByRole('heading', { name: 'Ingresá a tu cuenta' }).waitFor();
});

test('registro: validación accesible y alta real contra la API', async () => {
  await page.goto(`${BASE}/register`);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  const emailInput = page.getByLabel('Email');
  assert.equal(await emailInput.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'email', 'foco en el primer error');
  await emailInput.fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('corta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByText('La contraseña debe tener entre 10 y 128 caracteres.').waitFor();
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  assert.equal(await page.getByLabel('Contraseña', { exact: true }).getAttribute('aria-invalid'), 'false', 'el error se limpia al editar');
  await page.getByRole('button', { name: 'Mostrar' }).click();
  assert.equal(await page.getByLabel('Contraseña', { exact: true }).getAttribute('type'), 'text');
  await page.screenshot({ path: `${SHOTS}/register-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL(`${BASE}/bienvenida`);
  await page.getByRole('heading', { name: '¡Listo! Ya tenés tu cuenta.' }).waitFor();
  await page.getByText(email).first().waitFor();
  await noTokensInBrowserStorage();

  const cookie = (await context.cookies()).find((entry) => entry.name === 'tusofertas_refresh');
  assert.ok(cookie, 'cookie de refresh presente');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.path, '/api/auth');
  assert.equal(cookie.sameSite, 'Lax');
  await page.screenshot({ path: `${SHOTS}/bienvenida-desktop.png`, fullPage: true });

  const duplicate = await browser.newPage();
  await duplicate.goto(`${BASE}/register`);
  await duplicate.getByLabel('Email').fill(email.toUpperCase());
  await duplicate.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await duplicate.getByRole('button', { name: 'Crear cuenta' }).click();
  await duplicate.getByRole('alert').getByText('Ya existe una cuenta con ese email.').waitFor();
  await duplicate.close();
});

test('recarga: la sesión se recupera con un único refresh (StrictMode incluido)', async () => {
  refreshCalls.length = 0;
  await page.goto(`${BASE}/inicio`);
  await page.getByRole('heading', { name: 'Hola de nuevo.' }).waitFor();
  await page.getByText('Sin límite').or(page.getByText('Distancia máxima')).first().waitFor();
  await page.waitForTimeout(500);
  assert.equal(refreshCalls.length, 1, 'una sola rotación por carga');
  await noTokensInBrowserStorage();
});

test('access token vencido: se renueva una vez y reintenta la petición original', async () => {
  let forced = 0;
  await page.route('**/api/users/me', async (route) => {
    if (forced === 0) {
      forced += 1;
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"statusCode":401,"error":"UNAUTHORIZED","message":"Necesitás iniciar sesión."}' });
    }
    return route.continue();
  });
  refreshCalls.length = 0;
  await page.goto(`${BASE}/inicio`);
  await page.getByText(email).nth(1).waitFor();
  assert.equal(forced, 1);
  assert.equal(refreshCalls.length, 2, 'refresh inicial + refresh por 401');
  await page.unroute('**/api/users/me');
});

test('logout limpia la sesión y el área privada vuelve a pedir login', async () => {
  await page.goto(`${BASE}/inicio`);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('link', { name: 'Ingresar' }).waitFor();
  assert.equal((await context.cookies()).some((entry) => entry.name === 'tusofertas_refresh'), false);
  await page.goto(`${BASE}/inicio`);
  await page.waitForURL(/\/login\?next=%2Finicio$/);
});

test('login con teclado, error uniforme y redirección interna segura', async () => {
  await page.goto(`${BASE}/login?next=%2F%2Fevil.example`);
  await page.getByLabel('Email').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type('clave-incorrecta-123');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').getByText('El email o la contraseña no son correctos.').waitFor();

  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL(`${BASE}/inicio`, { timeout: 10_000 });
  assert.equal(new URL(page.url()).host, new URL(BASE).host, 'no redirige a un sitio externo');

  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Mi cuenta' }).waitFor();
});

test('refresh rechazado (cookie perdida o vencida) termina la sesión', async () => {
  await context.clearCookies();
  await page.goto(`${BASE}/inicio`);
  await page.waitForURL(/\/login\?next=%2Finicio$/);
});

test('móvil 390 px: sin desborde horizontal en login, registro y cuenta', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-AR' });
  const phone = await mobile.newPage();
  for (const path of ['/', '/login', '/register']) {
    await phone.goto(`${BASE}${path}`);
    await phone.waitForLoadState('networkidle');
    const { scroll, width } = await phone.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(scroll <= width, `${path}: ${scroll} > ${width}`);
    await phone.screenshot({ path: `${SHOTS}/mobile${path === '/' ? '-home' : path.replace('/', '-')}.png`, fullPage: true });
  }
  await phone.goto(`${BASE}/login`);
  await phone.getByLabel('Email').fill(email);
  await phone.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await phone.getByRole('button', { name: 'Ingresar' }).click();
  await phone.waitForURL(`${BASE}/inicio`);
  await phone.getByRole('heading', { name: 'Hola de nuevo.' }).waitFor();
  const { scroll, width } = await phone.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(scroll <= width, `/inicio: ${scroll} > ${width}`);
  await phone.screenshot({ path: `${SHOTS}/mobile-inicio.png`, fullPage: true });
  await mobile.close();
});
