const baseUrl = String(process.env.CONTACT_FORM_URL ?? 'http://127.0.0.1:4310').replace(/\/$/, '');
const adminBearer = process.env.CONTACT_FORM_ADMIN_BEARER ?? '';
const [command = 'help', ...args] = process.argv.slice(2);

const value = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const request = async (path, options = {}, admin = false) => {
  const headers = { accept: 'application/json', ...(options.headers ?? {}) };
  if (admin) {
    if (!adminBearer) throw new Error('CONTACT_FORM_ADMIN_BEARER is required.');
    headers.authorization = `Bearer ${adminBearer}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${result.error?.code ?? 'request_failed'}: ${result.error?.message ?? 'Request failed.'}`);
  console.log(JSON.stringify(result, null, 2));
};

const usage = () => console.log(`Usage: npm run cli -- <command> [options]

Commands:
  health
  submit --form contact --name NAME --email EMAIL --subject SUBJECT --message MESSAGE
  list [--status new] [--limit 25] [--offset 0]
  show --id UUID
  status --id UUID --set read|replied|spam|archived

Environment: CONTACT_FORM_URL and CONTACT_FORM_ADMIN_BEARER.`);

try {
  if (command === 'health') await request('/health');
  else if (command === 'submit') {
    const form = value('form', 'contact');
    await request(`/v1/forms/${encodeURIComponent(form)}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: value('name'), email: value('email'), subject: value('subject'), message: value('message'), website: '' }),
    });
  } else if (command === 'list') {
    const query = new URLSearchParams({ limit: value('limit', '25'), offset: value('offset', '0') });
    if (value('status')) query.set('status', value('status'));
    await request(`/v1/submissions?${query}`, {}, true);
  } else if (command === 'show') await request(`/v1/submissions/${encodeURIComponent(value('id'))}`, {}, true);
  else if (command === 'status') await request(`/v1/submissions/${encodeURIComponent(value('id'))}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: value('set') }) }, true);
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
