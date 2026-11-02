// Read-only customer journeys. Non-GET requests are aborted and logged, so forms cannot submit.
import { chromium, devices, type Page } from '@playwright/test';

const log = (k: string, v: unknown) => console.log(`${k.padEnd(34)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const attempt = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { log(`ERROR ${name}`, String(e).split('\n')[0]!.slice(0, 170)); }
};
const browser = await chromium.launch();
const open = async (device = devices['Desktop Chrome']) => {
  const context = await browser.newContext(device);
  await context.route('**/*', (r) => {
    const q = r.request();
    if (q.method() === 'GET' || q.method() === 'HEAD') return r.continue();
    console.log(`  [blocked ${q.method()}] ${q.url().slice(0, 90)} ${(q.postData() ?? '').slice(0, 120)}`);
    return r.abort();
  });
  return context.newPage();
};
const go = async (p: Page, u: string) => {
  await p.goto(u, { waitUntil: 'load' });
  await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
};
const text = (p: Page) => p.locator('main').innerText().catch(() => p.locator('body').innerText());

const CB = 'https://www.chachabakes.in';
const TS = 'https://twosoulsandthreetails.com';
const productLinks = (p: Page) => p.locator('main a[href^="/products/"]').evaluateAll((a) => [...new Set(a.map((e) => e.getAttribute('href')))].length);

console.log('\n===== CHACHA BAKES');
{
  const p = await open();
  await go(p, `${CB}/menu`);
  log('menu products', await productLinks(p));
  for (const q of ['cakes', 'pastries', 'cookies', 'brownies', 'cupcakes', 'tarts', 'breads', 'Celebration Cakes', 'Cookies & Biscuits', 'Hampers']) {
    await go(p, `${CB}/menu?category=${encodeURIComponent(q)}`);
    log(`category=${q}`, await productLinks(p));
  }
  await attempt('eggless', async () => {
    await go(p, `${CB}/menu`);
    const before = await productLinks(p);
    await p.getByRole('button', { name: 'Eggless only' }).click();
    await p.waitForTimeout(1200);
    log('eggless toggle', `${before} -> ${await productLinks(p)}`);
  });
  await attempt('search', async () => {
    await p.getByRole('button', { name: 'Search products' }).click();
    await p.waitForTimeout(500);
    const box = p.getByRole('textbox').or(p.getByRole('searchbox')).first();
    for (const q of ['brownie', 'zzzznothing', '<b>x</b>']) {
      await box.fill(q);
      await p.waitForTimeout(900);
      log(`search ${q}`, (await p.locator('body').innerText()).match(/no (results|products)[^\n]*/i)?.[0] ?? `url=${p.url().replace(CB, '')} links=${await p.locator('a[href^="/products/"]').count()}`);
    }
  });
  await attempt('cart', async () => {
    await p.keyboard.press('Escape');
    await go(p, `${CB}/products/lemon-and-chia-seed-loaf`);
    log('product buttons', await p.getByRole('button').allInnerTexts().then((t) => t.filter(Boolean).filter((x) => x.length < 30).slice(0, 18)));
    log('h1s', await p.locator('h1').allInnerTexts());
    log('product text', (await text(p)).replace(/\s+/g, ' ').slice(0, 420));
    await p.getByRole('button', { name: /add to cart/i }).first().click();
    await p.waitForTimeout(1200);
    log('toast', (await p.getByRole('region', { name: /notifications/i }).innerText().catch(() => '')).slice(0, 120));
    await go(p, `${CB}/cart`);
    log('cart', (await text(p)).replace(/\s+/g, ' ').slice(0, 520));
    await p.reload();
    await p.waitForLoadState('networkidle').catch(() => undefined);
    log('cart after reload', (await text(p)).replace(/\s+/g, ' ').slice(0, 160));
    log('localStorage', await p.evaluate(() => Object.keys(localStorage)));
    await go(p, `${CB}/checkout`);
    log('checkout url', p.url());
    log('checkout', (await text(p)).replace(/\s+/g, ' ').slice(0, 520));
  });
  await attempt('qty', async () => {
    await go(p, `${CB}/cart`);
    const buttons = await p.locator('main button').evaluateAll((b) => b.map((x) => (x.getAttribute('aria-label') ?? '') + '|' + (x as HTMLElement).innerText.slice(0, 24)));
    log('cart buttons', buttons);
  });
  for (const u of ['/admin', '/admin/orders', '/account', '/track', '/weekend-menu', '/christmas', '/contact', '/login', '/register']) {
    await attempt(u, async () => {
      await go(p, `${CB}${u}`);
      log(`${u} ->`, `${p.url().replace(CB, '')} :: ${(await text(p)).replace(/\s+/g, ' ').slice(0, 300)}`);
    });
  }
  await attempt('login empty', async () => {
    await go(p, `${CB}/login`);
    await p.locator('main form button[type=submit], main form button').last().click();
    await p.waitForTimeout(500);
    log('login empty valid?', await p.locator('main form input:invalid').count());
    await p.locator('main input[type=email]').fill('not-an-email');
    await p.locator('main form button[type=submit], main form button').last().click();
    await p.waitForTimeout(500);
    log('login bad email invalid count', await p.locator('main form input:invalid').count());
  });
  await attempt('register weak', async () => {
    await go(p, `${CB}/register`);
    log('register fields', await p.locator('main form input').evaluateAll((i) => i.map((x) => `${(x as HTMLInputElement).type}:${(x as HTMLInputElement).name || x.id}:${x.hasAttribute('required')}:${x.getAttribute('minlength') ?? ''}`)));
  });
  await attempt('newsletter', async () => {
    await go(p, CB);
    await p.getByRole('textbox', { name: 'Your email address' }).fill('not-an-email');
    await p.getByRole('button', { name: 'Subscribe' }).click();
    await p.waitForTimeout(600);
    log('newsletter invalid', await p.locator('input:invalid').count());
  });
  const m = await open(devices['Pixel 7']);
  await attempt('mobile nav', async () => {
    await go(m, CB);
    log('mobile nav visible links', await m.getByRole('navigation').first().getByRole('link').count().catch(() => 'n/a'));
    log('mobile unnamed header btns', await m.locator('header button').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? (x as HTMLElement).innerText.trim()).slice(0, 8)));
    await m.locator('header button').last().click();
    await m.waitForTimeout(600);
    log('after menu tap, Weekend link', await m.getByRole('link', { name: 'Weekend Menu' }).first().isVisible());
  });
  await m.context().close();
  await p.context().close();
}

console.log('\n===== TWO SOULS AND THREE TAILS');
{
  const p = await open();
  await attempt('search', async () => {
    for (const q of ['Goa', 'zzzznothing', '<img src=x onerror=alert(1)>']) {
      await go(p, `${TS}/search/?q=${encodeURIComponent(q)}`);
      await p.waitForTimeout(1200);
      log(`search ${q.slice(0, 14)}`, `${await p.locator('main a[href^="/journal/"],main a[href^="/guides/"]').count()} links :: ${(await text(p)).replace(/\s+/g, ' ').slice(0, 130)}`);
      log('  injected img present', await p.locator('main img[src="x"]').count());
    }
  });
  await attempt('gallery', async () => {
    await go(p, `${TS}/gallery/`);
    log('gallery images', await p.locator('main img').count());
    await p.locator('main img').nth(3).click();
    await p.waitForTimeout(800);
    log('lightbox dialog', await p.locator('dialog[open],[role=dialog]').count());
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    log('after Esc dialog', await p.locator('dialog[open]').count());
  });
  await attempt('home', async () => {
    await go(p, TS);
    await p.getByRole('button', { name: 'Next' }).click();
    await p.waitForTimeout(600);
    log('carousel scrollLeft', await p.locator('[title*="scroll for more"], [aria-label*="scroll for more"]').first().evaluate((e) => e.scrollLeft).catch(() => 'n/a'));
    await p.locator('#main').scrollIntoViewIfNeeded();
    await p.getByRole('region', { name: /Interactive map/ }).scrollIntoViewIfNeeded();
    await p.waitForTimeout(3000);
    log('map tiles/canvas', await p.locator('canvas, .leaflet-tile, .maplibregl-canvas').count());
    log('map buttons enabled', await p.getByRole('button', { name: 'Take the tour' }).isEnabled());
    await p.getByRole('textbox', { name: 'Email address' }).fill('nope');
    await p.getByRole('button', { name: 'Subscribe' }).click();
    await p.waitForTimeout(500);
    log('newsletter invalid inputs', await p.locator('input:invalid').count());
    log('form', await p.locator('form').first().evaluate((f) => `${(f as HTMLFormElement).method} ${(f as HTMLFormElement).action}`).catch(() => 'n/a'));
  });
  await attempt('empty images', async () => {
    await go(p, `${TS}/journal/rag-malhar/`);
    log('empty img', await p.locator('img').evaluateAll((i) => i.filter((x) => (x as HTMLImageElement).naturalWidth === 0 && (x as HTMLImageElement).complete).map((x) => x.outerHTML.slice(0, 170))));
  });
  await attempt('contact', async () => {
    await go(p, `${TS}/contact/`);
    log('contact', (await text(p)).replace(/\s+/g, ' ').slice(0, 300));
    log('forms', await p.locator('form').count());
    log('mailto', await p.locator('a[href^="mailto"]').evaluateAll((a) => a.map((x) => x.getAttribute('href'))));
  });
  await attempt('404', async () => {
    const r = await p.goto(`${TS}/no-such-page/`);
    log('404 page', `${r?.status()} ${(await p.title())}`);
  });
  await attempt('rss', async () => {
    const r = await p.request.get(`${TS}/rss/`);
    log('/rss/', `${r.status()} ${r.headers()['content-type']}`);
    log('rss link in html', await (await p.request.get(TS)).text().then((t) => /application\/rss\+xml[^>]*/.exec(t)?.[0]?.slice(0, 100) ?? 'none'));
    for (const u of ['/rss.xml', '/feed.xml', '/sitemap-index.xml', '/robots.txt']) {
      const x = await p.request.get(`${TS}${u}`);
      log(u, `${x.status()} ${x.headers()['content-type']} ${(await x.text()).slice(0, 110).replace(/\n/g, ' ')}`);
    }
  });
  const m = await open(devices['Pixel 7']);
  await attempt('mobile', async () => {
    await go(m, TS);
    log('mobile main nav visible', await m.getByRole('link', { name: 'Journal' }).first().isVisible());
    log('mobile header btns', await m.locator('header button, header summary').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? (x as HTMLElement).innerText.trim())));
    await m.locator('header button, header summary').first().click();
    await m.waitForTimeout(500);
    log('after tap Journal visible', await m.getByRole('link', { name: 'Journal' }).first().isVisible());
  });
  await m.context().close();
  await p.context().close();
}
await browser.close();
