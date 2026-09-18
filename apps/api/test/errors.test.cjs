const assert = require('node:assert/strict');
const { test } = require('node:test');
const { HttpException } = require('@nestjs/common');
const { HttpExceptionFilter } = require('../dist/common/http-exception.filter');
const { JsonLogger } = require('../dist/common/json-logger');

test('unexpected and HTTP server errors keep database credentials and stacks out of responses/logs', () => {
  const logs = [];
  const filter = new HttpExceptionFilter(new JsonLogger((entry) => logs.push(entry)));
  for (const exception of [
    new Error('postgres://user:private-fixture@database/internal'),
    new HttpException({ password: 'private-fixture', stack: 'internal-stack' }, 503),
  ]) {
    let statusCode;
    let body;
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; },
    };
    filter.catch(exception, { switchToHttp: () => ({ getResponse: () => response }) });
    assert.equal(statusCode, exception instanceof HttpException ? 503 : 500);
    assert.deepEqual(body, {
      statusCode,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrió un error interno.',
    });
  }
  assert.equal(logs.length, 2);
  assert.equal(logs.join('').includes('private-fixture'), false);
  assert.equal(logs.join('').includes('internal-stack'), false);
  assert.equal(JSON.parse(logs[0]).message.event, 'request_failed');
});

test('structured logger redacts nested credentials and never serializes raw errors', () => {
  const logs = [];
  const logger = new JsonLogger((entry) => logs.push(entry));
  logger.log({ event: 'test', nested: { password: 'private-fixture', accessToken: 'private-fixture' } });
  logger.error(new Error('private-fixture'));
  logger.error('private-fixture', 'private-fixture-stack');
  assert.equal(logs.join('').includes('private-fixture'), false);
  assert.equal(JSON.parse(logs[0]).message.nested.password, '[REDACTED]');
});
