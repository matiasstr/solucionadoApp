// Auth contra PostgreSQL real (base *_test). Ejecutar con `npm.cmd run test:db`.
const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const { createHash } = require('node:crypto');
const request = require('supertest');
const { Client } = require('pg');
const { createApp } = require('../../dist/bootstrap');
const { JsonLogger } = require('../../dist/common/json-logger');
const { validateEnvironment } = require('../../dist/config/environment');

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('Los tests de integración requieren DATABASE_URL de una base *_test (usar npm run test:db).');
}

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'private-fixture-password';
const logs = [];
let app;
let server;
let pg;

before(async () => {
  app = await createApp(validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    JWT_ACCESS_SECRET: 'integration-secret-with-at-least-32-chars',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
  }), new JsonLogger((entry) => logs.push(entry)));
  await app.init();
  server = app.getHttpServer();
  pg = new Client({ connectionString: url });
  await pg.connect();
});
after(async () => {
  await app?.close();
  await pg?.end();
});

let counter = 0;
const uniqueEmail = () => `persona${Date.now()}${counter++}@example.com`;
const post = (path) => request(server).post(path).set('Origin', ORIGIN).set('X-Requested-With', 'tusofertas-web');
const refreshCookieOf = (response) => {
  const header = (response.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('tusofertas_refresh='));
  return header;
};
const tokenOf = (response) => /^tusofertas_refresh=([^;]*)/.exec(refreshCookieOf(response) ?? '')?.[1];
const refreshWith = (token) => post('/api/auth/refresh').set('Cookie', `tusofertas_refresh=${token}`);
const me = (accessToken) => request(server).get('/api/users/me').set('Authorization', `Bearer ${accessToken}`);

async function register(email = uniqueEmail()) {
  const response = await post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);
  return { email, response, accessToken: response.body.accessToken, refresh: tokenOf(response), user: response.body.user };
}

describe('registro y login', () => {
  test('registro normaliza email, hashea con Argon2id, emite sesión y cookie segura', async () => {
    const raw = `  Ana.${Date.now()}@Example.COM `;
    const response = await post('/api/auth/register').send({ email: raw, password: PASSWORD }).expect(201);
    const email = raw.trim().toLowerCase();
    assert.equal(response.body.tokenType, 'Bearer');
    assert.equal(response.body.expiresIn, 900);
    assert.equal(response.body.user.email, email);
    assert.equal(response.body.user.maxTravelDistanceKm, '5');
    assert.equal(response.headers['cache-control'], 'no-store');
    for (const secret of ['passwordHash', PASSWORD, 'refreshToken', 'tokenHash']) {
      assert.equal(response.text.includes(secret), false, secret);
    }

    const cookie = refreshCookieOf(response);
    assert.match(cookie, /; Path=\/api\/auth/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.match(cookie, /; Expires=/);
    assert.doesNotMatch(cookie, /; Secure/, 'Secure solo en producción');

    const row = (await pg.query('SELECT id, "passwordHash" FROM "User" WHERE email = $1', [email])).rows[0];
    assert.match(row.passwordHash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    const sessions = (await pg.query('SELECT "tokenHash" FROM "RefreshSession" WHERE "userId" = $1', [row.id])).rows;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].tokenHash, createHash('sha256').update(tokenOf(response)).digest('hex'));
  });

  test('email repetido (sin distinguir mayúsculas) y registros concurrentes: una sola cuenta', async () => {
    const { email } = await register();
    const duplicate = await post('/api/auth/register').send({ email: email.toUpperCase(), password: PASSWORD }).expect(409);
    assert.equal(duplicate.body.error, 'EMAIL_TAKEN');

    const racing = uniqueEmail();
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      post('/api/auth/register').send({ email: racing, password: PASSWORD })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
    const count = (await pg.query('SELECT count(*)::int AS n FROM "User" WHERE email = $1', [racing])).rows[0].n;
    assert.equal(count, 1);
  });

  test('login con credenciales inválidas responde igual exista o no el email', async () => {
    const { email } = await register();
    const wrong = await post('/api/auth/login').send({ email, password: 'otra-clave-incorrecta' }).expect(401);
    const unknown = await post('/api/auth/login').send({ email: uniqueEmail(), password: PASSWORD }).expect(401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.body.error, 'INVALID_CREDENTIALS');
    assert.equal(refreshCookieOf(wrong), undefined);

    const ok = await post('/api/auth/login').send({ email: ` ${email.toUpperCase()} `, password: PASSWORD }).expect(200);
    assert.equal(ok.body.user.email, email);
    assert.ok(tokenOf(ok));
  });
});

describe('perfil y ownership', () => {
  test('GET/PATCH /users/me operan solo sobre el usuario del token', async () => {
    const a = await register();
    const b = await register();
    const profile = await me(a.accessToken).expect(200);
    assert.equal(profile.body.id, a.user.id);
    assert.equal(profile.body.passwordHash, undefined);

    const patch = await request(server).patch('/api/users/me').set('Authorization', `Bearer ${a.accessToken}`).send({
      city: ' Rosario ', province: 'Santa Fe', latitude: '-32.944200', longitude: '-60.650500',
      maxTravelDistanceKm: '7.5', maxStoresPerShoppingPlan: null, storeVisitPenalty: '500',
      distancePenaltyPerKm: '120.50', paymentMethods: ['DEBIT_CARD', 'WALLET'], banks: ['Banco ficticio'],
    }).expect(200);
    assert.equal(patch.body.city, 'Rosario');
    assert.equal(patch.body.latitude, '-32.9442');
    assert.equal(patch.body.maxTravelDistanceKm, '7.5');
    assert.equal(patch.body.maxStoresPerShoppingPlan, null);
    assert.equal(patch.body.distancePenaltyPerKm, '120.5');
    assert.deepEqual(patch.body.paymentMethods, ['DEBIT_CARD', 'WALLET']);

    const other = await me(b.accessToken).expect(200);
    assert.equal(other.body.city, null, 'el perfil de B no cambió');

    const clear = await request(server).patch('/api/users/me').set('Authorization', `Bearer ${a.accessToken}`)
      .send({ latitude: null, longitude: null }).expect(200);
    assert.equal(clear.body.latitude, null);
  });

  test('PATCH rechaza mass assignment y preferencias inválidas', async () => {
    const { accessToken, user } = await register();
    const patch = (body) => request(server).patch('/api/users/me').set('Authorization', `Bearer ${accessToken}`).send(body);
    const cases = [
      [{ email: 'otra@example.com' }, ['email']],
      [{ passwordHash: 'x' }, ['passwordHash']],
      [{ id: '00000000-0000-4000-8000-000000000000' }, ['id']],
      [{ latitude: '-34.6' }, ['latitude', 'longitude']],
      [{ latitude: '95', longitude: '0' }, ['latitude']],
      [{ latitude: '-34.6', longitude: null }, ['latitude', 'longitude']],
      [{ maxTravelDistanceKm: '0' }, ['maxTravelDistanceKm']],
      [{ maxStoresPerShoppingPlan: 0 }, ['maxStoresPerShoppingPlan']],
      [{ storeVisitPenalty: '-1' }, ['storeVisitPenalty']],
      [{ paymentMethods: ['CHEQUE'] }, ['paymentMethods']],
    ];
    for (const [body, fields] of cases) {
      const response = await patch(body).expect(400);
      assert.deepEqual(response.body.fields, fields, JSON.stringify(body));
    }
    const row = (await pg.query('SELECT email FROM "User" WHERE id = $1', [user.id])).rows[0];
    assert.equal(row.email, user.email);
  });

  test('token de una cuenta eliminada ya no da acceso', async () => {
    const { accessToken, user } = await register();
    await pg.query('DELETE FROM "User" WHERE id = $1', [user.id]);
    await me(accessToken).expect(401);
  });
});

describe('refresh, rotación y logout', () => {
  test('refresh rota el token; reutilizar el anterior revoca toda la familia', async () => {
    const session = await register();
    const first = await refreshWith(session.refresh).expect(200);
    const second = tokenOf(first);
    assert.ok(second && second !== session.refresh);
    await me(first.body.accessToken).expect(200);

    const replay = await refreshWith(session.refresh).expect(401);
    assert.equal(replay.body.error, 'SESSION_EXPIRED');
    assert.match(refreshCookieOf(replay), /Expires=Thu, 01 Jan 1970/);
    // La familia quedó revocada: el sucesor legítimo tampoco sirve.
    await refreshWith(second).expect(401);
    const open = await pg.query(
      'SELECT count(*)::int AS n FROM "RefreshSession" WHERE "userId" = $1 AND "revokedAt" IS NULL', [session.user.id],
    );
    assert.equal(open.rows[0].n, 0);
  });

  test('dos refresh simultáneos con el mismo token: exactamente uno gana y la familia se revoca', async () => {
    const session = await register();
    const results = await Promise.all([refreshWith(session.refresh), refreshWith(session.refresh)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
    const winner = results.find((r) => r.status === 200);
    await refreshWith(tokenOf(winner)).expect(401);
    const successors = await pg.query(
      'SELECT count(*)::int AS n FROM "RefreshSession" WHERE "userId" = $1', [session.user.id],
    );
    assert.equal(successors.rows[0].n, 2, 'solo se creó un sucesor');
  });

  test('refresh vencido, inexistente o sin cookie responde 401', async () => {
    const session = await register();
    await pg.query(
      `UPDATE "RefreshSession" SET "createdAt" = now() - interval '2 days', "expiresAt" = now() - interval '1 second'
       WHERE "userId" = $1`, [session.user.id],
    );
    await refreshWith(session.refresh).expect(401);
    await refreshWith('A'.repeat(43)).expect(401);
    await post('/api/auth/refresh').expect(401);
  });

  test('logout revoca la sesión y borra la cookie con los mismos atributos', async () => {
    const session = await register();
    const response = await post('/api/auth/logout').set('Cookie', `tusofertas_refresh=${session.refresh}`).expect(204);
    const cookie = refreshCookieOf(response);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
    assert.match(cookie, /; Path=\/api\/auth/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
    await refreshWith(session.refresh).expect(401);
    await post('/api/auth/logout').expect(204);
  });
});

test('los logs no contienen contraseñas ni tokens', () => {
  const text = logs.join('\n');
  assert.equal(text.includes(PASSWORD), false);
  assert.equal(/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(text), false, 'sin JWT en logs');
  assert.equal(text.includes('tusofertas_refresh'), false);
});
