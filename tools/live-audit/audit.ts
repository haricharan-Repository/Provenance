// Read-only audit of a live site. Every non-GET request is blocked in the browser, so it cannot
// create orders, signups or messages. Usage: tsx tools/live-audit/audit.ts <url> <name> [maxPages]
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, type Page } from '@playwright/test';

const [start, name, max = '120'] = process.argv.slice(2);
if (!start || !name) throw new Error('Usage: audit.ts <url> <name> [maxPages]');
const origin = new URL(start).origin;
const UA = 'TruthlineAudit/1.0 (site owner test)';
const SAMPLE = 14;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string, method = 'GET') => {
  try {
    const res = await fetch(url, { method, redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
    return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type') ?? '', text: method === 'GET' ? await res.text() : '' };
  } catch (e) {
    return { status: 0, location: null, type: '', text: String(e) };
  }
};
const follow = async (url: string) => {
  let current = url;
  const hops: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(current);
    if (r.status >= 300 && r.status < 400 && r.location) {
      hops.push(`${r.status}`);
      current = new URL(r.location, current).href;
    } else return { ...r, final: current, hops };
  }
  return { status: -1, location: null, type: '', text: '', final: current, hops };
};
const attr = (html: string, re: RegExp) => re.exec(html)?.[1]?.trim() ?? '';

async function crawl() {
  const seen = new Set<string>();
  const queue = [new URL(start!).href];
  const robots = await get(`${origin}/robots.txt`);
  for (const line of robots.text.matchAll(/^sitemap:\s*(\S+)/gim)) {
    const index = await follow(line[1]!);
    const locs = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    for (const loc of locs) {
      if (loc.endsWith('.xml')) {
        const child = await follow(loc);
        queue.push(...[...child.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
      } else queue.push(loc);
    }
  }
  const pages: Record<string, unknown>[] = [];
  const links = new Map<string, Set<string>>();
  while (queue.length && pages.length < Number(max)) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await follow(url);
    const html = /html/.test(r.type) ? r.text : '';
    const jsonld = [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => {
      try { JSON.parse(m[1]!); return 'ok'; } catch { return 'invalid'; }
    });
    pages.push({
      url, status: r.status, final: r.final, hops: r.hops.length, bytes: r.text.length,
      title: attr(html, /<title[^>]*>([^<]*)/i),
      description: attr(html, /<meta[^>]+name="description"[^>]+content="([^"]*)/i),
      canonical: attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)/i),
      ogImage: attr(html, /<meta[^>]+property="og:image"[^>]+content="([^"]*)/i),
      noindex: /<meta[^>]+robots[^>]+noindex/i.test(html),
      h1: (html.match(/<h1[\s>]/gi) ?? []).length, jsonld,
    });
    for (const m of html.matchAll(/\shref="([^"#]+)/g)) {
      const raw = m[1]!;
      if (/^(mailto|tel|javascript|data|whatsapp):/.test(raw)) continue;
      let u: URL;
      try { u = new URL(raw.replaceAll('&amp;', '&'), r.final); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      if (!links.has(u.href)) links.set(u.href, new Set());
      links.get(u.href)!.add(url);
      if (u.origin === origin && !/\.(png|jpe?g|webp|svg|ico|css|js|xml|pdf|json|woff2?)(\?|$)/i.test(u.pathname) && !u.pathname.startsWith('/_') && !u.pathname.startsWith('/api')) queue.push(u.href);
    }
    await pause(150);
  }
  const broken: Record<string, unknown>[] = [];
  const external: Record<string, unknown>[] = [];
  for (const [url, from] of links) {
    if (seen.has(url)) continue;
    const isInternal = url.startsWith(origin);
    if (!isInternal && /instagram\.com|wa\.me|facebook\.com|linkedin\.com|x\.com|twitter\.com/.test(url)) continue;
    const r = await follow(url);
    const row = { url, status: r.status, from: [...from].slice(0, 3) };
    if (r.status >= 400 || r.status <= 0) (isInternal ? broken : external).push(row);
    await pause(100);
  }
  for (const p of pages) {
    if ((p.status as number) >= 400 || (p.status as number) <= 0) {
      broken.push({ url: p.url, status: p.status, from: [...(links.get(p.url as string) ?? [])].slice(0, 3) });
    }
  }
  return { pages, broken, external, linkCount: links.size, leftInQueue: queue.filter((q) => !seen.has(q)).length };
}

async function inspect(page: Page, url: string) {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); };
  const onResponse = (r: { status(): number; url(): string }) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); };
  page.on('console', onConsole);
  page.on('response', onResponse);
  const res = await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  }).catch(() => undefined);
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const lcp = (window as unknown as { __lcp?: number }).__lcp;
    const cls = (window as unknown as { __cls?: number }).__cls;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 10),
      noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
      smallTargets: [...document.querySelectorAll('a,button')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.width < 24 || b.height < 24); }).length,
      ttfb: nav ? Math.round(nav.responseStart) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      lcp: lcp ? Math.round(lcp) : null,
      cls: cls === undefined ? null : Math.round(cls * 1000) / 1000,
      kb: Math.round(resources.reduce((s, r) => s + r.transferSize, 0) / 1024),
      largest: resources.sort((a, b) => b.transferSize - a.transferSize).slice(0, 3).map((r) => `${Math.round(r.transferSize / 1024)}KB ${r.name.slice(0, 90)}`),
    };
  }).catch((e) => ({ error: String(e) }));
  page.off('console', onConsole);
  page.off('response', onResponse);
  return { url, status: res?.status() ?? 0, consoleErrors: [...new Set(consoleErrors)], failed: [...new Set(failed)], ...info };
}

async function browserPass(urls: string[]) {
  const browser = await chromium.launch();
  const out: Record<string, unknown>[] = [];
  const a11y = new Map<string, { impact: string; help: string; nodes: number; pages: Set<string>; sample: string }>();
  for (const [label, device] of [['desktop', devices['Desktop Chrome']], ['mobile', devices['Pixel 7']]] as const) {
    const context = await browser.newContext({ ...device, userAgent: `${device.userAgent} ${UA}` });
    await context.addInitScript(() => {
      const w = window as unknown as { __lcp: number; __cls: number };
      w.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await context.route('**/*', (route) => {
      const req = route.request();
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    for (const url of urls) {
      out.push({ device: label, ...(await inspect(page, url)) });
      if (label === 'desktop') {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze().catch(() => null);
        for (const v of axe?.violations ?? []) {
          const row = a11y.get(v.id) ?? { impact: v.impact ?? '', help: v.help, nodes: 0, pages: new Set<string>(), sample: v.nodes[0]?.html.slice(0, 160) ?? '' };
          row.nodes += v.nodes.length;
          row.pages.add(new URL(url).pathname);
          a11y.set(v.id, row);
        }
      }
      await pause(250);
    }
    await context.close();
  }
  await browser.close();
  return { pages: out, a11y: [...a11y].map(([id, v]) => ({ id, ...v, pages: [...v.pages].slice(0, 6), pageCount: v.pages.size })) };
}

const crawled = await crawl();
const ok = crawled.pages.filter((p) => p.status === 200).map((p) => p.url as string);
const step = Math.max(1, Math.floor(ok.length / SAMPLE));
const sample = [...new Set([ok[0]!, ...ok.filter((_, i) => i % step === 0)])].slice(0, SAMPLE);
const browser = await browserPass(sample);
mkdirSync('reports/live', { recursive: true });
writeFileSync(`reports/live/${name}.json`, JSON.stringify({ start, date: new Date().toISOString(), crawled, browser }, null, 2));
console.log(`${name}: ${crawled.pages.length} pages, ${crawled.linkCount} links, ${crawled.broken.length} broken internal, ${browser.pages.length} browser passes`);
