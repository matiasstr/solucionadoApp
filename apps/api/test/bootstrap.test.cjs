const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const request = require('supertest');
const { createApp } = require('../dist/bootstrap');
const { JsonLogger } = require('../dist/common/json-logger');
const { validateEnvironment } = require('../dist/config/environment');

let app;
before(async () => {
  app = await createApp(validateEnvironment({
    NODE_ENV: 'test',
    // Puerto cerrado: la API arranca igual y readiness debe informar la falla.
    DATABASE_URL: 'postgresql://fixture:private-fixture@127.0.0.1:1/unreachable',
    JWT_ACCESS_SECRET: 'unit-test-secret-with-at-least-32-characters',
  }), new JsonLogger(() => {}));
  await app.init();
});
after(async () => {
  await app?.close();
});

test('health reports process liveness and security headers without claiming database readiness', async () => {
  const response = await request(app.getHttpServer()).get('/api/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok', service: 'tusofertas-api' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('readiness reports 503 when the database is unreachable without leaking connection details', async () => {
  const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
  assert.deepEqual(response.body, {
    status: 'unavailable',
    service: 'tusofertas-api',
    checks: { database: 'down' },
  });
  assert.equal(response.text.includes('private-fixture'), false);
  assert.equal(response.text.includes('127.0.0.1'), false);
});

test('unknown routes return a stable JSON error without reflecting private query values', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/missing?token=private-fixture')
    .expect('Content-Type', /json/)
    .expect(404);
  assert.deepEqual(response.body, {
    statusCode: 404,
    error: 'NOT_FOUND',
    message: 'Recurso no encontrado.',
  });
  assert.equal(response.text.includes('private-fixture'), false);
});

test('CORS permits the exact configured frontend origin and its preflight', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/health')
    .set('Origin', 'http://localhost:3000')
    .expect(200);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(response.headers['access-control-allow-credentials'], 'true');

  const preflight = await request(app.getHttpServer())
    .options('/api/health')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'GET')
    .expect(204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:3000');
});

test('CORS does not grant browser access to an origin that only resembles the allowlist', async () => {
  // CORS restricts browser access; it is not authentication or an HTTP request firewall.
  const response = await request(app.getHttpServer())
    .get('/api/health')
    .set('Origin', 'http://localhost:3000.attacker.example')
    .expect(200);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});
