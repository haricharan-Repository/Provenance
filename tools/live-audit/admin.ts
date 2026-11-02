// Read-only admin check. Credentials come from the environment and are never logged or stored.
// Only /api/auth/* may POST. Output is limited to counts, statuses and field names, never customer values.
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices } from '@playwright/test';

const { TL_ADMIN_EMAIL: email, TL_ADMIN_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('Set TL_ADMIN_EMAIL and TL_ADMIN_PASSWORD.');
const CB = 'https://www.chachabakes.in';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Desktop Chrome'], recordVideo: undefined });
const blocked: string[] = [];
await context.route('**/*', (r) => {
  const q = r.request();
  const auth = new URL(q.url()).pathname.startsWith('/api/auth/') && q.url().startsWith(CB);
  if (['GET', 'HEAD'].includes(q.method()) || auth) return r.continue();
  blocked.push(`${q.method()} ${new URL(q.url()).pathname}`);
  return r.abort();
});
const page = await context.newPage();
const errors: string[] = [];
const failed: string[] = [];
const api = new Map<string, number>();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140).replace(/[\w.+-]+@[\w.-]+/g, '<email>')); });
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (path.startsWith('/api/')) api.set(`${r.request().method()} ${path}`, r.status());
  if (r.status() >= 400) failed.push(`${r.status()} ${path}`);
});

await page.goto(`${CB}/login`);
await page.getByRole('textbox').first().fill(email);
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.getByRole('button', { name: /Login with Password/ }).click();
await page.locator('input[type=password]').fill(password);
await page.locator('input[type=password]').press('Enter');
await page.waitForTimeout(4000);
console.log('after login url', new URL(page.url()).pathname);
const session = await page.evaluate(() => fetch('/api/auth/session').then((r) => r.json()));
console.log('session role', session?.user?.role ?? 'none', 'keys', Object.keys(session?.user ?? {}));
for (const c of await context.cookies()) {
  if (/token|session|csrf/i.test(c.name)) console.log('cookie', c.name, `httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite}`);
}
if (!session?.user) { console.log('LOGIN FAILED'); await browser.close(); process.exit(1); }

await page.goto(`${CB}/admin`);
await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
console.log('/admin ->', new URL(page.url()).pathname);
const links = await page.locator('a[href^="/admin"]').evaluateAll((a) => [...new Set(a.map((e) => e.getAttribute('href')!))]);
console.log('admin links', links);
const a11y = new Map<string, number>();
for (const path of ['/admin', ...links]) {
  const start = failed.length;
  const res = await page.goto(`${CB}${path}`).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({
    h: document.querySelector('h1,h2')?.textContent?.slice(0, 40),
    rows: document.querySelectorAll('table tbody tr').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
    btns: document.querySelectorAll('main button').length,
  }));
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().catch(() => null);
  axe?.violations.forEach((v) => a11y.set(`${v.impact} ${v.id}`, (a11y.get(`${v.impact} ${v.id}`) ?? 0) + v.nodes.length));
  console.log(path.padEnd(28), res?.status(), JSON.stringify(m), failed.slice(start).slice(0, 3).join(' '));
}
console.log('api seen', JSON.stringify([...api]));
const shape = async (path: string) => page.evaluate(async (u) => {
  const r = await fetch(u);
  const j = await r.json().catch(() => null);
  const list = Array.isArray(j) ? j : j && Object.values(j).find(Array.isArray);
  const first = (list as Record<string, unknown>[] | undefined)?.[0];
  return { status: r.status, top: j && !Array.isArray(j) ? Object.keys(j) : 'array', n: (list as unknown[])?.length, fields: first ? Object.keys(first) : [] };
}, path);
for (const u of ['/api/admin/orders', '/api/admin/users', '/api/orders']) console.log(u, JSON.stringify(await shape(u)));
console.log('a11y', JSON.stringify([...a11y]));
console.log('console errors', [...new Set(errors)].slice(0, 6));
console.log('blocked writes', [...new Set(blocked)]);
await context.clearCookies();
await browser.close();
