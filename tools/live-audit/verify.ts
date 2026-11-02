import { chromium, devices } from '@playwright/test';
const CB='https://www.chachabakes.in',TS='https://twosoulsandthreetails.com';
const b=await chromium.launch();
const mk=async(d=devices['Desktop Chrome'])=>{const c=await b.newContext({...d,timezoneId:'Asia/Kolkata'});await c.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());return c.newPage()};
const go=async(p:any,u:string)=>{await p.goto(u);await p.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{})};
const t=async(p:any,n=500)=>(await p.locator('main').innerText()).replace(/\s+/g,' ').slice(0,n);
const p=await mk();
await go(p,`${CB}/menu`);await p.waitForTimeout(1500);
console.log('MENU',await t(p,420));
console.log('menu pagers',await p.getByRole('button').allInnerTexts().then((x:string[])=>x.filter(s=>/more|next|page|\d/i.test(s)).slice(0,10)));
for(let i=0;i<6;i++){await p.mouse.wheel(0,3000);await p.waitForTimeout(500)}
console.log('after scroll links',await p.locator('main a[href^="/products/"]').evaluateAll((a:any[])=>new Set(a.map(e=>e.getAttribute('href'))).size));
await go(p,`${CB}/menu?category=cakes`);await p.waitForTimeout(2000);console.log('CAT cakes',await t(p,400));
await p.goto(CB);await p.getByRole('link',{name:'Birthday Treats'}).click();await p.waitForTimeout(2500);console.log('CLICK tile',p.url(),await p.locator('main a[href^="/products/"]').count(),(await t(p,240)));
await go(p,`${CB}/menu`);await p.getByRole('button',{name:'Search products'}).click();await p.waitForTimeout(600);
const box=p.locator('input:visible').first();
for(const q of ['brownie','cake','cheesecake','zzzz']){await box.fill(q);await p.waitForTimeout(1500);const body=await p.locator('body').innerText();console.log('SEARCH',q,(body.match(/no products found[^\n]*/i)?.[0])??(body.match(/\d+ (results?|products?)[^\n]*/i)?.[0])??'results shown')}
await p.keyboard.press('Escape');
await go(p,`${CB}/weekend-menu`);await p.waitForTimeout(1500);console.log('WEEKEND',await t(p,900));
console.log('NOW',await p.evaluate(()=>new Date().toString()));
await go(p,CB);console.log('BANNER',await p.locator('p').first().innerText());
await p.goto(`${CB}/products/lemon-and-chia-seed-loaf`);await p.getByRole('button',{name:/add to cart/i}).first().click();await p.waitForTimeout(800);await go(p,`${CB}/checkout`);
console.log('CHECKOUT tail',(await p.locator('main').innerText()).replace(/\s+/g,' ').slice(-700));
for(const u of ['shipping','terms','privacy']){await go(p,`${CB}/${u}`);const s=(await p.locator('main').innerText()).replace(/\s+/g,' ');console.log(u.toUpperCase(),s.length,[...s.matchAll(/[^.]*(deliver|minimum|refund|cancel|Bangalore|Mysore|shipping fee|₹|updated)[^.]*\./gi)].slice(0,7).map(m=>m[0].trim().slice(0,170)))}
await go(p,`${CB}/admin/orders`);await p.waitForTimeout(1500);console.log('ADMIN',await t(p,260));console.log('ADMIN controls',await p.locator('main input,main button').count(),await p.locator('header').first().innerText().then((s:string)=>s.replace(/\s+/g,' ').slice(0,120)));
const m=await mk(devices['Pixel 7']);await go(m,CB);
console.log('MOBILE header',await m.locator('header').first().innerHTML().then((h:string)=>[...h.matchAll(/<(a|button)[^>]*?(href="[^"]*"|aria-label="[^"]*")?[^>]*>/g)].map(x=>x[2]||x[1]).slice(0,14)));
console.log('MOBILE visible links',await m.locator('body a:visible').evaluateAll((a:any[])=>a.filter(e=>{const r=e.getBoundingClientRect();return r.top<900}).map(e=>e.getAttribute('href')).slice(0,14)));
console.log('MOBILE fixed bottom',await m.evaluate(()=>[...document.querySelectorAll('nav,div')].filter((e:any)=>getComputedStyle(e).position==='fixed').map((e:any)=>e.innerText.replace(/\s+/g,' ').slice(0,70)).filter(Boolean).slice(0,5)));
await m.screenshot({path:'reports/live/cb-mobile.png'});
for(const [n,u,d] of [['cb / mob',CB,devices['Pixel 7']],['cb /menu dsk',CB+'/menu',devices['Desktop Chrome']],['cb /menu mob',CB+'/menu',devices['Pixel 7']],['cb blueberry dsk',CB+'/products/blueberry-cheesecake',devices['Desktop Chrome']],['ts / mob',TS,devices['Pixel 7']]] as const){const v=[];for(let i=0;i<3;i++){const x=await mk(d);await x.addInitScript(()=>{const w:any=window;w.__c=0;new PerformanceObserver(l=>{for(const e of l.getEntries())w.__l=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries() as any)if(!e.hadRecentInput)w.__c+=e.value}).observe({type:'layout-shift',buffered:true})});await x.goto(u);await x.waitForTimeout(3500);v.push(await x.evaluate(()=>{const w:any=window;return `${Math.round(w.__l)}ms/${w.__c.toFixed(3)}`}));await x.context().close()}console.log('PERF',n,v.join(' '))}
const s=await mk();await go(s,TS);await s.getByRole('region',{name:/Interactive map/}).scrollIntoViewIfNeeded();await s.waitForTimeout(9000);
console.log('MAP enabled',await s.getByRole('button',{name:'Take the tour'}).isEnabled(),await s.locator('canvas').count(),await s.locator('text=Unfolding the map').isVisible().catch(()=>'n'));
await s.goto(`${TS}/journal/egypt-sand-stone-and-the-slow-nile/`);const e=await s.locator('main').innerText();console.log('OMAN mentions',(e.match(/Oman/g)||[]).length,e.match(/[^.\n]*Oman[^.\n]*/)?.[0]?.slice(0,160));
const r=await s.goto('https://www.ragmalhar.com/').catch((x:any)=>null);console.log('RAGMALHAR browser',r?.status());
await b.close();
