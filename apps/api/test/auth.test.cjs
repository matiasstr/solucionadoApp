// Auth sin base de datos: CSRF, validación, JWT y rate limit se resuelven antes de tocar la DB.
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../dist/bootstrap');
const { JsonLogger } = require('../dist/common/json-logger');
const { validateEnvironment } = require('../dist/config/environment');

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const ORIGIN = 'http://localhost:3000';
const USER_ID = '6f1c1d2e-8a7b-4c3d-9e0f-112233445566';
const env = (extra = {}) => validateEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://fixture:private-fixture@127.0.0.1:1/unreachable',
  JWT_ACCESS_SECRET: SECRET,
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  ...extra,
});

let app;
let server;
before(async () => {
  app = await createApp(env(), new JsonLogger(() => {}));
  await app.init();
  server = app.getHttpServer();
});
after(async () => {
  await app?.close();
});

const post = (path) => request(server).post(path).set('Origin', ORIGIN).set('X-Requested-With', 'tusofertas-web');

test('CSRF: rutas de auth exigen Origin permitido y header personalizado', async () => {
  const body = { email: 'ana@example.com', password: 'una-clave-larga' };
  for (const req of [
    () => request(server).post('/api/auth/login').send(body),
    () => request(server).post('/api/auth/login').set('X-Requested-With', 'tusofertas-web').send(body),
    () => request(server).post('/api/auth/login').set('Origin', 'https://evil.example').set('X-Requested-With', 'tusofertas-web').send(body),
    () => request(server).post('/api/auth/login').set('Origin', ORIGIN).send(body),
    () => request(server).post('/api/auth/refresh').set('Origin', ORIGIN).set('X-Requested-With', 'otro').send(),
    () => request(server).post('/api/auth/logout').set('Referer', 'https://evil.example/x').set('X-Requested-With', 'tusofertas-web'),
  ]) {
    const response = await req().expect(403);
    assert.equal(response.body.error, 'CSRF_REJECTED');
  }
});

test('registro valida email y política de contraseña sin reflejar valores', async () => {
  const short = await post('/api/auth/register').send({ email: 'ana@example.com', password: 'corta' }).expect(400);
  assert.deepEqual(short.body, {
    statusCode: 400, error: 'VALIDATION_FAILED', message: 'Revisá los datos ingresados.', fields: ['password'],
  });
  const long = await post('/api/auth/register').send({ email: 'ana@example.com', password: 'x'.repeat(129) }).expect(400);
  assert.deepEqual(long.body.fields, ['password']);
  const email = await post('/api/auth/register').send({ email: 'no-es-email', password: 'private-fixture-pass' }).expect(400);
  assert.deepEqual(email.body.fields, ['email']);
  assert.equal(email.text.includes('private-fixture-pass'), false);
  const extra = await post('/api/auth/register')
    .send({ email: 'ana@example.com', password: 'una-clave-larga', passwordHash: 'x' }).expect(400);
  assert.deepEqual(extra.body.fields, ['passwordHash']);
});

test('perfil exige un access JWT válido: firma, algoritmo, issuer, audience, expiración y tipo', async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = { typ: 'access', sub: USER_ID, iss: 'tusofertas-api', aud: 'tusofertas-web', iat: now, exp: now + 600 };
  const sign = (payload, secret = SECRET, options = {}) => jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
  const invalid = [
    undefined,
    'Bearer',
    'Basic abc',
    `Bearer ${sign(base, 'otra-clave-distinta-de-al-menos-32-caracteres')}`,
    `Bearer ${sign({ ...base, exp: now - 10, iat: now - 700 })}`,
    `Bearer ${sign({ ...base, aud: 'otra-app' })}`,
    `Bearer ${sign({ ...base, iss: 'otro-emisor' })}`,
    `Bearer ${sign({ ...base, typ: 'refresh' })}`,
    `Bearer ${sign({ ...base, sub: 'no-es-uuid' })}`,
    `Bearer ${sign(base, SECRET, { algorithm: 'HS512' })}`,
    // alg=none sin firma
    `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(base)).toString('base64url')}.x`,
  ];
  for (const authorization of invalid) {
    const req = request(server).get('/api/users/me');
    if (authorization) req.set('Authorization', authorization);
    const response = await req.expect(401);
    assert.equal(response.body.error, 'UNAUTHORIZED');
  }
  const patch = await request(server).patch('/api/users/me').send({ city: 'Rosario' }).expect(401);
  assert.equal(patch.body.error, 'UNAUTHORIZED');
});

test('rate limit por IP en login devuelve 429', async () => {
  const limited = await createApp(env({ AUTH_RATE_LIMIT_PER_MINUTE: '3' }), new JsonLogger(() => {}));
  await limited.init();
  try {
    const hit = () => request(limited.getHttpServer()).post('/api/auth/login')
      .set('Origin', ORIGIN).set('X-Requested-With', 'tusofertas-web').send({});
    for (let i = 0; i < 3; i += 1) await hit().expect(400);
    const response = await hit().expect(429);
    assert.equal(response.body.error, 'TOO_MANY_REQUESTS');
  } finally {
    await limited.close();
  }
});
