/**
 * Tiempos de respuesta de la API (P10-02) contra una API **local** ya levantada:
 *
 *   BENCH_BASE_URL=http://127.0.0.1:3020 node scripts/bench-api.cjs [--runs=20]
 *
 * Crea una cuenta ficticia bench-<marca>@example.com con zona en Caballito, débito y crédito del
 * Banco Demo declarados y una rutina con todos los productos genéricos del catálogo. Después mide,
 * en serie, búsqueda, comparación, historial, generación de planes (cada una con su propia
 * `Idempotency-Key`, así que cada pedido calcula y guarda un plan), resumen y evaluación de
 * beneficios. Imprime mínimo, mediana, p95 y máximo en milisegundos.
 *
 * Solo localhost: crea datos. Los números dependen de la máquina y del dataset; no prueban escala
 * de producción (ver "Tiempos de respuesta" en docs/RUNBOOK.md).
 */
const { randomUUID } = require('node:crypto');

const base = process.env.BENCH_BASE_URL ?? 'http://127.0.0.1:3010';
const runsArg = process.argv.slice(2).find((value) => value.startsWith('--runs='));
const RUNS = runsArg ? Number(runsArg.slice('--runs='.length)) : 20;
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 500) {
  console.error('bench — --runs debe ser un entero entre 1 y 500.');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  console.error('bench — BENCH_BASE_URL debe ser local: el benchmark crea cuentas y planes.');
  process.exit(1);
}

const CABALLITO = { latitude: '-34.6187', longitude: '-58.4407' };
const PASSWORD = 'frase-de-benchmark-local';
let token = null;

async function call(method, path, body, headers = {}) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: 'http://127.0.0.1:3000',
      'X-Requested-With': 'tusofertas-web',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return { ms, body: text ? JSON.parse(text) : null };
}

function summary(name, samples, note = '') {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile) => sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)];
  const fmt = (value) => value.toFixed(0).padStart(6);
  console.log(`${name.padEnd(44)} ${fmt(sorted[0])} ${fmt(at(0.5))} ${fmt(at(0.95))} ${fmt(sorted[sorted.length - 1])}  ${note}`);
}

async function measure(name, runs, request, describe) {
  const samples = [];
  let last;
  for (let run = 0; run < runs; run += 1) {
    const result = await request();
    samples.push(result.ms);
    last = result.body;
  }
  summary(name, samples, describe ? describe(last) : '');
  return last;
}

const isoDate = (date) => date.toISOString().slice(0, 10);

async function main() {
  const health = await call('GET', '/health/ready');
  if (health.body.checks?.database !== 'up') throw new Error('La API no tiene base de datos disponible.');

  const registered = await call('POST', '/auth/register', { email: `bench-${Date.now()}@example.com`, password: PASSWORD });
  token = registered.body.accessToken;
  await call('PATCH', '/users/me', {
    ...CABALLITO,
    maxTravelDistanceKm: '5',
    maxStoresPerShoppingPlan: 2,
    paymentMethods: ['DEBIT_CARD', 'CREDIT_CARD'],
    banks: ['Banco Demo'],
  });

  const canonicals = [];
  let cursor = null;
  do {
    const page = await call('GET', `/canonical-products?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    canonicals.push(...page.body.items);
    cursor = page.body.page.nextCursor;
  } while (cursor);
  const routine = await call('POST', '/shopping-routines', { name: 'Benchmark', frequencyDays: 7 });
  for (const canonical of canonicals) {
    await call('POST', `/shopping-routines/${routine.body.id}/items`, {
      canonicalProductId: canonical.id,
      quantity: canonical.defaultUnit === 'UNIT' ? '6' : '2',
      unit: canonical.defaultUnit,
    });
  }

  const products = await call('GET', '/products?search=arroz&limit=1');
  const productId = products.body.items[0]?.id;
  const arroz = products.body.items[0]?.canonicalProductId;
  if (!productId || !arroz) throw new Error('El catálogo no tiene arroz: correr el seed DEMO.');
  const near = `latitude=${CABALLITO.latitude}&longitude=${CABALLITO.longitude}&radiusKm=5`;
  const today = new Date();

  console.log(`API ${base} · ${RUNS} pedidos en serie por fila · rutina con ${canonicals.length} productos genéricos`);
  console.log(`${'pedido'.padEnd(44)} ${'mín'.padStart(6)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'máx'.padStart(6)}  (ms)`);
  await measure('GET /products?search=arroz (cerca, 5 km)', RUNS, () => call('GET', `/products?search=arroz&${near}`), (body) => `${body.items.length} resultados`);
  await measure('GET /products?search=leche (todo el catálogo)', RUNS, () => call('GET', '/products?search=leche'), (body) => `${body.items.length} resultados`);
  await measure('GET /canonical-products/:id/prices (5 km)', RUNS, () => call('GET', `/canonical-products/${arroz}/prices?${near}&limit=50`), (body) => `${body.offers.length} ofertas`);
  await measure(
    'GET /products/:id/price-history (90 días)',
    RUNS,
    () => call('GET', `/products/${productId}/price-history?${near}&from=${isoDate(new Date(today.getTime() - 89 * 86_400_000))}&to=${isoDate(today)}`),
    (body) => `${body.series?.length ?? 0} series`,
  );
  await measure(
    'POST /shopping-plans/generate (7 días)',
    RUNS,
    () => call('POST', '/shopping-plans/generate', {}, { 'Idempotency-Key': randomUUID() }),
    (body) => `${body.lineCount} líneas, ${body.visitCount} visitas, ${body.method}, canasta ${body.benefits?.basketSearch ?? '—'}`,
  );
  await measure(
    'POST /shopping-plans/generate (28 días)',
    Math.max(1, Math.ceil(RUNS / 4)),
    () => call('POST', '/shopping-plans/generate', { startDate: isoDate(today), endDate: isoDate(new Date(today.getTime() + 27 * 86_400_000)) }, { 'Idempotency-Key': randomUUID() }),
    (body) => `${body.lineCount} líneas, ${body.visitCount} visitas, ${body.method}, canasta ${body.benefits?.basketSearch ?? '—'}`,
  );
  await measure('GET /shopping-plans', RUNS, () => call('GET', '/shopping-plans'), (body) => `${body.items.length} planes`);
  await measure('GET /dashboard', RUNS, () => call('GET', '/dashboard'));
}

main().catch((error) => {
  console.error(`bench — ${error.message}`);
  process.exit(1);
});
