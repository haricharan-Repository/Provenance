// Disposable sample app so the framework can be run end to end. Delete it when targeting a real app.
// DEMO_BUG=expiry plants a real defect: expired coupons are accepted (REQ-142).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

if (!process.env.TEST_USER_EMAIL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Handled by the check below.
  }
}

const { TEST_USER_EMAIL, TEST_USER_PASSWORD, DEMO_BUG } = process.env;
if (!TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
  throw new Error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD (see .env.example).');
}

const SUBTOTAL_CENTS = 10_000;
const MAX_CODE_LENGTH = 20;
const sessions = new Set<string>();
const coupons = new Map<string, { percentOff: number; expiresOn: string }>();

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;

const LOGIN = page(
  'Sign in',
  `<form id="f">
    <label>Email <input name="email" type="email" autocomplete="username"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password"></label>
    <button>Sign in</button>
  </form>
  <p role="alert" id="err"></p>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(d)) });
      if (r.ok) location.href = '/checkout';
      else document.getElementById('err').textContent = 'Invalid email or password';
    });
  </script>`,
);

const CHECKOUT = page(
  'Checkout',
  `<p>Subtotal: <output aria-label="Subtotal">$100.00</output></p>
  <form id="f">
    <label>Coupon code <input name="code"></label>
    <button>Apply coupon</button>
  </form>
  <p role="status" aria-label="Coupon message" id="msg"></p>
  <p>Total: <output aria-label="Total" id="total">$100.00</output></p>
  <script>
    const msg = document.getElementById('msg');
    const total = document.getElementById('total');
    const MESSAGES = {
      COUPON_EXPIRED: 'This coupon has expired',
      COUPON_UNKNOWN: 'Coupon not found',
      COUPON_REQUIRED: 'Enter a coupon code',
      COUPON_TOO_LONG: 'Coupon codes are at most ${MAX_CODE_LENGTH} characters',
    };
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = new FormData(e.target).get('code');
      try {
        const r = await fetch('/api/coupons/apply', { method: 'POST', body: JSON.stringify({ code }) });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(MESSAGES[b.error] ?? 'Coupons are unavailable. Try again.');
        total.textContent = '$' + (b.totalCents / 100).toFixed(2);
        msg.textContent = 'Coupon applied';
      } catch (err) {
        total.textContent = '$100.00';
        msg.textContent = err.message;
      }
    });
  </script>`,
);

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const json = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const session = (req: IncomingMessage) => {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return !!sid && sessions.has(sid);
};

const today = () => new Date().toISOString().slice(0, 10);

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const route = `${req.method} ${pathname}`;

  if (route === 'GET /health') return json(res, 200, { ok: true });
  if (route === 'GET /login') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(LOGIN);
  }
  if (route === 'GET /checkout') {
    if (!session(req)) {
      res.writeHead(302, { location: '/login' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(CHECKOUT);
  }
  if (route === 'POST /api/login') {
    const { email, password } = await readJson(req);
    if (email !== TEST_USER_EMAIL || password !== TEST_USER_PASSWORD) {
      return json(res, 401, { error: 'INVALID_CREDENTIALS' });
    }
    const sid = randomUUID();
    sessions.add(sid);
    return json(res, 200, { ok: true }, { 'set-cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax` });
  }
  if (route === 'POST /api/test/coupons') {
    const { code, percentOff, expiresOn } = await readJson(req);
    coupons.set(String(code), { percentOff: Number(percentOff), expiresOn: String(expiresOn) });
    return json(res, 201, { code });
  }
  if (route === 'POST /api/coupons/apply') {
    if (!session(req)) return json(res, 401, { error: 'UNAUTHENTICATED' });
    const code = String((await readJson(req)).code ?? '').trim();
    if (!code) return json(res, 422, { error: 'COUPON_REQUIRED' });
    if (code.length > MAX_CODE_LENGTH) return json(res, 422, { error: 'COUPON_TOO_LONG' });
    const coupon = coupons.get(code);
    if (!coupon) return json(res, 404, { error: 'COUPON_UNKNOWN' });
    if (coupon.expiresOn < today() && DEMO_BUG !== 'expiry') {
      return json(res, 422, { error: 'COUPON_EXPIRED' });
    }
    const totalCents = Math.round(SUBTOTAL_CENTS * (1 - coupon.percentOff / 100));
    return json(res, 200, { totalCents });
  }
  return json(res, 404, { error: 'NOT_FOUND' });
});

const port = Number(process.env.DEMO_PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log(`demo app on http://127.0.0.1:${port}`));
