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
  });
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
    { ACCESS_TOKEN_TTL_SECONDS: '30' }, { REFRESH_TOKEN_TTL_DAYS: '0' }, { JWT_AUDIENCE: 'Bad Audience' }, { TRUST_PROXY: 'true' },
  ];
  for (const input of invalid) {
    assert.throws(() => validateEnvironment({ ...validDb, ...input }), (error) => {
      assert.match(error.message, /Configuración inválida:/);
      assert.equal(error.message.includes('private-fixture'), false);
      return true;
    });
  }
});
