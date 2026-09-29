const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { BatchRunError, runBatches } = require('../dist/modules/imports/domain/batching');
const { readLines } = require('../dist/modules/imports/infrastructure/providers/json-lines-price.provider');
const { MockPriceProvider, formatCommaDecimal, mockEan } = require('../dist/modules/imports/infrastructure/providers/mock-price.provider');
const { isValidGtin } = require('../dist/modules/imports/domain/import-normalizer');

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Genera registros de a uno y cuenta cuántos se pidieron. */
function counting(total, payloadBytes = 0) {
  const state = { pulled: 0 };
  async function* source() {
    for (let index = 0; index < total; index += 1) {
      state.pulled += 1;
      yield payloadBytes ? { index, payload: 'x'.repeat(payloadBytes) } : index;
    }
  }
  return { state, source: source() };
}

test('backpressure: nunca hay más que lote × (concurrencia + 1) registros retenidos', async () => {
  const { source } = counting(10_000);
  let preparing = 0;
  let overlapping = false;
  let persisted = 0;
  const stats = await runBatches(source, { batchSize: 100, concurrency: 3 }, {
    prepare: async (batch) => {
      preparing += 1;
      if (preparing > 1) overlapping = true;
      await tick();
      preparing -= 1;
      return batch;
    },
    persist: async (batch) => {
      await tick();
      await tick();
      persisted += batch.length;
    },
  });
  assert.equal(persisted, 10_000);
  assert.equal(stats.batches, 100);
  assert.ok(stats.maxHeldItems <= 100 * 4, `retenidos: ${stats.maxHeldItems}`);
  assert.equal(overlapping, false, 'la resolución de identidades corre en serie');
});

test('memoria acotada: un millón de registros de 1 KB generados en streaming no se acumulan', async () => {
  const { source } = counting(1_000_000, 1024);
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  let count = 0;
  await runBatches(source, { batchSize: 1000, concurrency: 2 }, {
    prepare: async (batch) => batch.length,
    persist: async (size) => {
      count += size;
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    },
  });
  assert.equal(count, 1_000_000);
  // Todo en memoria serían más de 1 GB; con lotes de 1000 alcanza con unos pocos MB.
  assert.ok(peak - before < 200 * 1024 * 1024, `crecimiento del heap: ${Math.round((peak - before) / 1024 / 1024)} MB`);
});

test('un lote que falla detiene la lectura, espera a los que estaban en vuelo y conserva lo confirmado', async () => {
  const { state, source } = counting(100_000);
  const committed = [];
  await assert.rejects(
    runBatches(source, { batchSize: 10, concurrency: 2 }, {
      prepare: async (batch) => batch,
      persist: async (batch) => {
        await tick();
        if (batch[0] === 50) throw new Error('la base se cayó');
        committed.push(batch[0]);
      },
    }),
    (error) => {
      assert.ok(error instanceof BatchRunError);
      assert.equal(error.cause.message, 'la base se cayó');
      return true;
    },
  );
  assert.ok(state.pulled < 1000, `se dejó de leer: ${state.pulled}`);
  assert.ok(committed.includes(40) && !committed.includes(50));
});

test('un proveedor que se corta a mitad de lote no escribe el lote incompleto', async () => {
  async function* broken() {
    for (let index = 0; index < 25; index += 1) yield index;
    throw new Error('conexión perdida');
  }
  const committed = [];
  await assert.rejects(
    runBatches(broken(), { batchSize: 10, concurrency: 1 }, {
      prepare: async (batch) => batch,
      persist: async (batch) => {
        committed.push(...batch);
      },
    }),
    BatchRunError,
  );
  assert.equal(committed.length, 20, 'los dos lotes completos quedan; los 5 del tercero no');
});

test('opciones fuera de rango se rechazan', async () => {
  for (const options of [{ batchSize: 0, concurrency: 1 }, { batchSize: 10, concurrency: 0 }, { batchSize: 1.5, concurrency: 1 }, { batchSize: 10, concurrency: 17 }]) {
    await assert.rejects(runBatches(counting(1).source, options, { prepare: async (b) => b, persist: async () => {} }), RangeError);
  }
});

test('lectura de líneas por trozos: saltos partidos, CRLF, líneas demasiado largas y tope total', async () => {
  const collect = async (chunks, options = { maxLineBytes: 20, maxBytes: 1000 }) => {
    const lines = [];
    for await (const line of readLines(Readable.from(chunks), options)) lines.push(line);
    return lines;
  };
  assert.deepEqual(await collect(['uno\ndo', 's\r\ntres\n', 'cuatro']), ['uno', 'dos', 'tres', 'cuatro']);
  assert.deepEqual(await collect(['corta\n', 'x'.repeat(30), 'y'.repeat(10), '\nfinal\n']), ['corta', null, 'final']);
  await assert.rejects(collect(['a'.repeat(15) + '\n', 'b'.repeat(15) + '\n'], { maxLineBytes: 100, maxBytes: 20 }), /tamaño máximo/);
});

test('proveedor mock: reproducible, perezoso y con EAN válidos', async () => {
  const take = async (provider, count) => {
    const items = [];
    for await (const item of provider.records()) {
      items.push(item);
      if (items.length === count) break;
    }
    return items;
  };
  const options = { seed: 7, stores: 2, products: 3, days: 2, anchorDate: '2026-09-28' };
  assert.deepEqual(await take(new MockPriceProvider(options), 12), await take(new MockPriceProvider(options), 12));
  const [first] = await take(new MockPriceProvider(options), 1);
  assert.equal(first.observedAt, '2026-09-27', 'del día más viejo al más nuevo');
  assert.match(first.price, /^\d{1,3}(\.\d{3})*,\d{2}$/);
  assert.ok(isValidGtin(mockEan(0)) && isValidGtin(mockEan(123456)));
  assert.equal(formatCommaDecimal(123456789), '1.234.567,89');
  // Un millón de registros posibles, pero solo se generan los que se piden.
  const huge = new MockPriceProvider({ stores: 1000, products: 1000, days: 1 });
  assert.equal((await take(huge, 3)).length, 3);
});
