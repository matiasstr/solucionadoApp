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
  }), {
    nodeEnv: 'production',
    port: 4100,
    host: '0.0.0.0',
    corsOrigins: ['https://tusofertas.example', 'https://app.tusofertas.example'],
    databaseUrl: 'postgresql://app:private-fixture@db.internal:5432/tusofertas',
  });
});

const validDb = { DATABASE_URL: 'postgresql://app:pw@localhost:5432/tusofertas' };

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
  ];
  for (const input of invalid) {
    assert.throws(() => validateEnvironment({ ...validDb, ...input }), (error) => {
      assert.match(error.message, /Configuración inválida:/);
      assert.equal(error.message.includes('private-fixture'), false);
      return true;
    });
  }
});
