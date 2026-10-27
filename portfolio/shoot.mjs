import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'portfolio/shots'; mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3000';
const b = await chromium.launch();
async function run(vp, tag) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(BASE + '/login/', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('name@company.com').fill('admin@demo.fleetdesk.app');
  await page.getByPlaceholder('Enter your password').fill('DemoPass123!');
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(2500);
  for (const r of ['/', '/rentals/', '/vehicles/', '/finance/', '/customers/', '/expenses/', '/staff/']) {
    await page.goto(BASE + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    const name = r === '/' ? 'home' : r.replaceAll('/', '');
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    console.log('shot', tag, name);
  }
  await ctx.close();
}
await run({ width: 1280, height: 769 }, 'desk');
await run({ width: 390, height: 844 }, 'phone');
await b.close();
