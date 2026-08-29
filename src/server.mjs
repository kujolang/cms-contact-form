import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 32 * 1024;
const VALID_STATUSES = new Set(['new', 'read', 'replied', 'spam', 'archived']);
const FORM_KEY_PATTERN = /^[a-z0-9_-]{2,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (response, status, payload, headers = {}) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
};

const text = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    'cache-control': 'public, max-age=300',
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
};

const safeEqual = (provided, expected) => {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const readJson = async (request) => {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.code = 'body_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.code = 'invalid_json';
    throw error;
  }
};

const parseInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const normalizeSubmission = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_submission', message: 'Submission must be an object.' };
  }
  const allowed = new Set(['name', 'email', 'subject', 'message', 'website']);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) {
    return { ok: false, code: 'unknown_fields', message: 'Submission contains unsupported fields.', details: { fields: unknown } };
  }
  const value = {
    name: String(raw.name ?? '').trim(),
    email: String(raw.email ?? '').trim().toLowerCase(),
    subject: String(raw.subject ?? '').trim(),
    message: String(raw.message ?? '').trim(),
    website: String(raw.website ?? '').trim(),
  };
  if (value.name.length < 2 || value.name.length > 160) return { ok: false, code: 'invalid_name', message: 'Name must contain 2 to 160 characters.' };
  if (value.email.length > 254 || !EMAIL_PATTERN.test(value.email)) return { ok: false, code: 'invalid_email', message: 'A valid email address is required.' };
  if (value.subject.length > 200) return { ok: false, code: 'invalid_subject', message: 'Subject must contain at most 200 characters.' };
  if (value.message.length < 10 || value.message.length > 10_000) return { ok: false, code: 'invalid_message', message: 'Message must contain 10 to 10,000 characters.' };
  if (value.website.length > 500) return { ok: false, code: 'invalid_website', message: 'Website field is invalid.' };
  return { ok: true, value };
};

const publicSubmission = (row) => ({
  id: row.id,
  form_key: row.form_key,
  name: row.name,
  email: row.email,
  subject: row.subject,
  message: row.message,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const openApiDocument = (port) => ({
  openapi: '3.1.0',
  info: { title: 'Kujo Contact Form Plugin API', version: '1.0.0' },
  servers: [{ url: `http://127.0.0.1:${port}` }],
  paths: {
    '/v1/forms/{formKey}/submissions': { post: { summary: 'Submit a contact form', security: [] } },
    '/v1/submissions': { get: { summary: 'List submissions', security: [{ bearerAuth: [] }] } },
    '/v1/submissions/{id}': {
      get: { summary: 'Read a submission', security: [{ bearerAuth: [] }] },
      patch: { summary: 'Moderate a submission', security: [{ bearerAuth: [] }] },
    },
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
});

export function createContactFormApp(options = {}) {
  const config = {
    host: options.host ?? process.env.CONTACT_FORM_HOST ?? '127.0.0.1',
    port: parseInteger(options.port ?? process.env.CONTACT_FORM_PORT, 4310, 0, 65_535),
    dbPath: resolve(options.dbPath ?? process.env.CONTACT_FORM_DB_PATH ?? '.data/contact-form.sqlite'),
    adminBearer: options.adminBearer ?? process.env.CONTACT_FORM_ADMIN_BEARER ?? '',
    allowedOrigins: options.allowedOrigins ?? String(process.env.CONTACT_FORM_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    rateLimit: parseInteger(options.rateLimit ?? process.env.CONTACT_FORM_RATE_LIMIT, 5, 1, 1_000),
    rateWindowMs: parseInteger(options.rateWindowMs ?? Number(process.env.CONTACT_FORM_RATE_WINDOW_SECONDS) * 1000, 60_000, 1_000, 86_400_000),
    ipHashKey: options.ipHashKey ?? process.env.CONTACT_FORM_IP_HASH_KEY ?? randomUUID(),
    notifyUrl: options.notifyUrl ?? process.env.CONTACT_FORM_NOTIFY_URL ?? '',
    notifySigningKey: options.notifySigningKey ?? process.env.CONTACT_FORM_NOTIFY_SIGNING_KEY ?? '',
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    browserSource: options.browserSource ?? fileURLToPath(new URL('./contact-form.js', import.meta.url)),
  };

  if (config.adminBearer && config.adminBearer.length < 32) throw new Error('CONTACT_FORM_ADMIN_BEARER must contain at least 32 characters.');
  if (config.notifyUrl && !config.notifyUrl.startsWith('https://')) throw new Error('CONTACT_FORM_NOTIFY_URL must use HTTPS.');

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const database = new DatabaseSync(config.dbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      form_key TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_status_created ON submissions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_submissions_form_created ON submissions(form_key, created_at DESC);
  `);

  const rateBuckets = new Map();
  const browserScript = config.browserSource;

  const corsHeaders = (origin) => origin && config.allowedOrigins.includes(origin)
    ? { 'access-control-allow-origin': origin, vary: 'origin' }
    : {};

  const originAllowed = (origin) => !origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin);

  const ipHash = (request) => createHmac('sha256', config.ipHashKey)
    .update(request.socket.remoteAddress ?? 'unknown')
    .digest('hex');

  const rateAllowed = (key) => {
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + config.rateWindowMs });
      return true;
    }
    current.count += 1;
    return current.count <= config.rateLimit;
  };

  const adminAllowed = (request) => safeEqual(
    String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''),
    config.adminBearer,
  );

  const notify = async (submission) => {
    if (!config.notifyUrl) return;
    const body = JSON.stringify({ event: 'contact.submitted', data: submission });
    const headers = { 'content-type': 'application/json', 'user-agent': 'kujo-contact-form/1.0' };
    if (config.notifySigningKey) {
      headers['x-kujo-signature'] = `sha256=${createHmac('sha256', config.notifySigningKey).update(body).digest('hex')}`;
    }
    await config.fetchImpl(config.notifyUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(5_000) });
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const origin = String(request.headers.origin ?? '');
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      if (!originAllowed(origin)) return json(response, 403, { error: { code: 'origin_denied', message: 'Origin is not allowed.' } });
      response.writeHead(204, { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' });
      return response.end();
    }

    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, service: 'kujo-contact-form', version: '1.0.0' });
    if (request.method === 'GET' && url.pathname === '/openapi.json') return json(response, 200, openApiDocument(server.address()?.port ?? config.port));
    if (request.method === 'GET' && url.pathname === '/assets/contact-form.js') {
      return text(response, 200, readFileSync(browserScript, 'utf8'), cors);
    }

    const publicMatch = url.pathname.match(/^\/v1\/forms\/([a-z0-9_-]+)\/submissions$/);
    if (request.method === 'POST' && publicMatch) {
      if (!originAllowed(origin)) return json(response, 403, { error: { code: 'origin_denied', message: 'Origin is not allowed.' } });
      const formKey = publicMatch[1];
      if (!FORM_KEY_PATTERN.test(formKey)) return json(response, 400, { error: { code: 'invalid_form_key', message: 'Form key is invalid.' } }, cors);
      const requestIpHash = ipHash(request);
      if (!rateAllowed(`${requestIpHash}:${formKey}`)) return json(response, 429, { error: { code: 'rate_limited', message: 'Please wait before trying again.' } }, { ...cors, 'retry-after': String(Math.ceil(config.rateWindowMs / 1000)) });
      let body;
      try { body = await readJson(request); } catch (error) {
        const status = error.code === 'body_too_large' ? 413 : 400;
        return json(response, status, { error: { code: error.code, message: error.message } }, cors);
      }
      const normalized = normalizeSubmission(body);
      if (!normalized.ok) return json(response, 400, { error: { code: normalized.code, message: normalized.message, details: normalized.details ?? {} } }, cors);
      if (normalized.value.website) return json(response, 202, { accepted: true }, cors);

      const now = new Date().toISOString();
      const submission = { id: randomUUID(), form_key: formKey, ...normalized.value, status: 'new', created_at: now, updated_at: now };
      database.prepare('INSERT INTO submissions (id, form_key, name, email, subject, message, status, ip_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(submission.id, formKey, submission.name, submission.email, submission.subject, submission.message, submission.status, requestIpHash, now, now);
      void notify(publicSubmission(submission)).catch(() => {});
      return json(response, 202, { accepted: true, submission_id: submission.id }, cors);
    }

    if (url.pathname.startsWith('/v1/submissions')) {
      if (!adminAllowed(request)) return json(response, 401, { error: { code: 'unauthorized', message: 'A valid administration bearer is required.' } }, { 'www-authenticate': 'Bearer' });

      if (request.method === 'GET' && url.pathname === '/v1/submissions') {
        const limit = parseInteger(url.searchParams.get('limit'), 25, 1, 100);
        const offset = parseInteger(url.searchParams.get('offset'), 0, 0, 1_000_000);
        const status = url.searchParams.get('status') ?? '';
        if (status && !VALID_STATUSES.has(status)) return json(response, 400, { error: { code: 'invalid_status', message: 'Status filter is invalid.' } });
        const rows = status
          ? database.prepare('SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset)
          : database.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
        const total = status
          ? database.prepare('SELECT COUNT(*) AS total FROM submissions WHERE status = ?').get(status).total
          : database.prepare('SELECT COUNT(*) AS total FROM submissions').get().total;
        return json(response, 200, { items: rows.map(publicSubmission), pagination: { limit, offset, total } });
      }

      const itemMatch = url.pathname.match(/^\/v1\/submissions\/([0-9a-f-]{36})$/);
      if (itemMatch && request.method === 'GET') {
        const row = database.prepare('SELECT * FROM submissions WHERE id = ?').get(itemMatch[1]);
        return row ? json(response, 200, { submission: publicSubmission(row) }) : json(response, 404, { error: { code: 'not_found', message: 'Submission not found.' } });
      }
      if (itemMatch && request.method === 'PATCH') {
        let body;
        try { body = await readJson(request); } catch (error) { return json(response, 400, { error: { code: error.code, message: error.message } }); }
        if (!body || Object.keys(body).some((key) => key !== 'status') || !VALID_STATUSES.has(body.status)) {
          return json(response, 400, { error: { code: 'invalid_status', message: 'Status must be new, read, replied, spam, or archived.' } });
        }
        const updatedAt = new Date().toISOString();
        const result = database.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?').run(body.status, updatedAt, itemMatch[1]);
        if (result.changes === 0) return json(response, 404, { error: { code: 'not_found', message: 'Submission not found.' } });
        const row = database.prepare('SELECT * FROM submissions WHERE id = ?').get(itemMatch[1]);
        return json(response, 200, { submission: publicSubmission(row) });
      }
    }

    return json(response, 404, { error: { code: 'not_found', message: 'Route not found.' } });
  });

  return {
    config,
    database,
    server,
    listen: () => new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolveListen(server.address());
      });
    }),
    close: () => new Promise((resolveClose, reject) => server.close((error) => {
      database.close();
      if (error) reject(error); else resolveClose();
    })),
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const app = createContactFormApp();
  const address = await app.listen();
  console.log(`Kujo Contact Form listening at http://${app.config.host}:${address.port}`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
