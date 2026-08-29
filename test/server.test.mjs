import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createContactFormApp } from '../src/server.mjs';

const bearer = 'test-administration-value-with-enough-entropy';

async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kujo-contact-form-'));
  const app = createContactFormApp({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(directory, 'test.sqlite'),
    adminBearer: bearer,
    ipHashKey: 'test-ip-hash-value',
    allowedOrigins: ['https://site.example'],
    rateLimit: 5,
    ...options,
  });
  const address = await app.listen();
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

const submission = (overrides = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Project inquiry',
  message: 'I would like to learn more about this project.',
  website: '',
  ...overrides,
});

const post = (baseUrl, body, headers = {}) => fetch(`${baseUrl}/v1/forms/contact/submissions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://site.example', ...headers },
  body: JSON.stringify(body),
});

test('health and OpenAPI discovery are public', async () => {
  const context = await fixture();
  try {
    const health = await fetch(`${context.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'kujo-contact-form');
    const contract = await fetch(`${context.baseUrl}/openapi.json`);
    assert.equal(contract.status, 200);
    assert.equal((await contract.json()).openapi, '3.1.0');
    const browserComponent = await fetch(`${context.baseUrl}/assets/contact-form.js`, { headers: { origin: 'https://site.example' } });
    assert.equal(browserComponent.status, 200);
    assert.match(await browserComponent.text(), /customElements\.define/);
    assert.equal(browserComponent.headers.get('access-control-allow-origin'), 'https://site.example');
  } finally { await context.close(); }
});

test('accepts valid submissions and protects administration reads', async () => {
  const context = await fixture();
  try {
    const response = await post(context.baseUrl, submission());
    assert.equal(response.status, 202);
    const accepted = await response.json();
    assert.match(accepted.submission_id, /^[0-9a-f-]{36}$/);

    assert.equal((await fetch(`${context.baseUrl}/v1/submissions`)).status, 401);
    const list = await fetch(`${context.baseUrl}/v1/submissions?status=new`, { headers: { authorization: `Bearer ${bearer}` } });
    assert.equal(list.status, 200);
    const payload = await list.json();
    assert.equal(payload.pagination.total, 1);
    assert.equal(payload.items[0].email, 'ada@example.com');
    assert.equal(Object.hasOwn(payload.items[0], 'ip_hash'), false);

    const update = await fetch(`${context.baseUrl}/v1/submissions/${accepted.submission_id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'replied' }),
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).submission.status, 'replied');
  } finally { await context.close(); }
});

test('rejects invalid fields and disallowed origins', async () => {
  const context = await fixture();
  try {
    const invalid = await post(context.baseUrl, submission({ tracking_code: 'unexpected' }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'unknown_fields');
    const denied = await post(context.baseUrl, submission(), { origin: 'https://attacker.example' });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'origin_denied');
  } finally { await context.close(); }
});

test('honeypot submissions are accepted without persistence', async () => {
  const context = await fixture();
  try {
    const trapped = await post(context.baseUrl, submission({ website: 'https://spam.example' }));
    assert.equal(trapped.status, 202);
    assert.deepEqual(await trapped.json(), { accepted: true });
    const list = await fetch(`${context.baseUrl}/v1/submissions`, { headers: { authorization: `Bearer ${bearer}` } });
    assert.equal((await list.json()).pagination.total, 0);
  } finally { await context.close(); }
});

test('rate limits repeated public submissions', async () => {
  const context = await fixture({ rateLimit: 1 });
  try {
    assert.equal((await post(context.baseUrl, submission())).status, 202);
    const limited = await post(context.baseUrl, submission({ email: 'second@example.com' }));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'rate_limited');
  } finally { await context.close(); }
});

test('delivers signed notification events without exposing connector credentials', async () => {
  let delivered;
  const delivery = new Promise((resolve) => { delivered = resolve; });
  const signingKey = 'test-notification-signing-value';
  const context = await fixture({
    notifyUrl: 'https://automation.example/contact',
    notifySigningKey: signingKey,
    fetchImpl: async (url, options) => {
      delivered({ url, options });
      return new Response(null, { status: 202 });
    },
  });
  try {
    assert.equal((await post(context.baseUrl, submission())).status, 202);
    const notification = await delivery;
    assert.equal(notification.url, 'https://automation.example/contact');
    const expected = `sha256=${createHmac('sha256', signingKey).update(notification.options.body).digest('hex')}`;
    assert.equal(notification.options.headers['x-kujo-signature'], expected);
    const payload = JSON.parse(notification.options.body);
    assert.equal(payload.event, 'contact.submitted');
    assert.equal(Object.hasOwn(payload.data, 'ip_hash'), false);
  } finally { await context.close(); }
});
