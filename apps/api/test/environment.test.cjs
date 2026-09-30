const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateEnvironment } = require('../dist/config/environment');

test('environment accepts and normalizes an explicit port and multiple exact origins', () => {
  assert.deepEqual(validateEnvironment({
    NODE_ENV: 'production',
    PORT: '4100',
    HOST: '0.0.0.0',
    CORS_ORIGINS: 'https://tusofertas.example, https://app.tusofertas.example,https://tusofertas.example',
    DATABASE_URL: 'postgresql://app:private-fixture@db.internal:5432/tusofertas',
    REDIS_URL: 'redis://unused-private-fixture',
    JWT_ACCESS_SECRET: 'private-fixture-secret-with-32-chars-min',
    ACCESS_TOKEN_TTL_SECONDS: '600',
    TRUST_PROXY: 'loopback',
  }), {
    nodeEnv: 'production',
    port: 4100,
    host: '0.0.0.0',
    corsOrigins: ['https://tusofertas.example', 'https://app.tusofertas.example'],
    trustProxy: 'loopback',
    databaseUrl: 'postgresql://app:private-fixture@db.internal:5432/tusofertas',
    auth: {
      accessSecret: 'private-fixture-secret-with-32-chars-min',
      issuer: 'tusofertas-api',
      audience: 'tusofertas-web',
      accessTtlSeconds: 600,
      refreshTtlDays: 30,
      rateLimitPerMinute: 10,
      secureCookies: true,
    },
    prices: { maxAgeDays: 7, sourcePrecedence: [] },
    planner: { maxHorizonDays: 28, maxCandidateDates: 7, maxCandidateStores: 8, maxOffersPerStore: 2, maxCombinations: 100000 },
    alerts: { cooldownHours: 24 },
  });
});

test('la política de precios se configura por entorno y rechaza valores inválidos', () => {
  const config = validateEnvironment({
    ...validDb,
    PRICE_MAX_AGE_DAYS: '14',
    PRICE_SOURCE_PRECEDENCE: 'oficial, scraper ,oficial',
  });
  assert.deepEqual(config.prices, { maxAgeDays: 14, sourcePrecedence: ['oficial', 'scraper'] });
  for (const input of [{ PRICE_MAX_AGE_DAYS: '0' }, { PRICE_MAX_AGE_DAYS: '400' }, { PRICE_MAX_AGE_DAYS: '2.5' }, { PRICE_SOURCE_PRECEDENCE: 'Fuente Oficial' }]) {
    assert.throws(() => validateEnvironment({ ...validDb, ...input }), /Configuración inválida:/);
  }
});

test('los límites del planificador se configuran por entorno y rechazan valores fuera de rango', () => {
  const config = validateEnvironment({
    ...validDb,
    PLANNER_MAX_HORIZON_DAYS: '14',
    PLANNER_MAX_CANDIDATE_DATES: '3',
    PLANNER_MAX_CANDIDATE_STORES: '4',
    PLANNER_MAX_OFFERS_PER_STORE: '1',
    PLANNER_MAX_COMBINATIONS: '5000',
  });
  assert.deepEqual(config.planner, {
    maxHorizonDays: 14,
    maxCandidateDates: 3,
    maxCandidateStores: 4,
    maxOffersPerStore: 1,
    maxCombinations: 5000,
  });
  for (const input of [
    { PLANNER_MAX_HORIZON_DAYS: '0' }, { PLANNER_MAX_HORIZON_DAYS: '63' },
    { PLANNER_MAX_CANDIDATE_DATES: '32' }, { PLANNER_MAX_CANDIDATE_STORES: '21' },
    { PLANNER_MAX_OFFERS_PER_STORE: '0' }, { PLANNER_MAX_CANDIDATE_STORES: '2.5' },
    { PLANNER_MAX_COMBINATIONS: '0' }, { PLANNER_MAX_COMBINATIONS: '3000000' },
  ]) {
    assert.throws(() => validateEnvironment({ ...validDb, ...input }), /Configuración inválida: PLANNER_/);
  }
});

const validDb = {
  DATABASE_URL: 'postgresql://app:pw@localhost:5432/tusofertas',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

test('invalid ports, unknown modes, empty hosts and unsafe origins prevent startup', () => {
  const invalid = [
    { PORT: '0' }, { PORT: '65536' }, { PORT: '1.5' }, { PORT: '' }, { PORT: '3001oops' },
    { NODE_ENV: 'prod' }, { HOST: '' }, { CORS_ORIGINS: '' }, { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://example.com/path' },
    { CORS_ORIGINS: 'https://example.com/' },
    { CORS_ORIGINS: 'https://user:private-fixture@example.com' },
    { CORS_ORIGINS: 'file:///local' },
    { DATABASE_URL: undefined }, { DATABASE_URL: '' },
    { DATABASE_URL: 'mysql://app:private-fixture@localhost/db' },
    { DATABASE_URL: 'postgresql://app:private-fixture@localhost' },
    { DATABASE_URL: 'private-fixture' },
    { JWT_ACCESS_SECRET: undefined }, { JWT_ACCESS_SECRET: 'private-fixture-short' },
    { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'solo-desarrollo-cambiar-por-un-valor-aleatorio-largo' },
    { ACCESS_TOKEN_TTL_SECONDS: '30' }, { REFRESH_TOKEN_TTL_DAYS: '0' }, { JWT_AUDIENCE: 'Bad Audience' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '2' },
  ];
  for (const input of invalid) {
    assert.throws(() => validateEnvironment({ ...validDb, ...input }), (error) => {
      assert.match(error.message, /Configuración inválida:/);
      assert.equal(error.message.includes('private-fixture'), false);
      return true;
    });
  }
});

test('TRUST_PROXY=vercel confía en exactamente un salto', () => {
  const config = validateEnvironment({ ...validDb, TRUST_PROXY: 'vercel' });
  assert.equal(config.trustProxy, 1);
  assert.equal(validateEnvironment({ ...validDb }).trustProxy, false);
});
