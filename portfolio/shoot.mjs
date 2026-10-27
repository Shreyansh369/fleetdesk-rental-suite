import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'portfolio/shots'; mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:3000';
const b = await chromium.launch();
async function run(vp, tag) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  try { await page.waitForSelector('input[type=email]', { timeout: 30000 }); } catch (e) { await page.screenshot({ path: `${OUT}/${tag}-login-fail.png` }); console.log('BODY', (await page.textContent('body')).slice(0, 600)); throw e; }
  await page.getByPlaceholder('name@company.com').fill('admin@demo.fleetdesk.app');
  await page.getByPlaceholder('Enter your password').fill('DemoPass123!');
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(async (e) => { await page.screenshot({ path: `${OUT}/${tag}-after-login.png` }); console.log('AFTER', page.url(), (await page.textContent('body')).slice(0, 400)); });
  await page.waitForTimeout(5000);
  for (const r of ['/', '/rentals.html', '/vehicles.html', '/finance.html', '/customers.html', '/expenses.html', '/staff.html']) {
    const name = r === '/' ? 'home' : r.replace('/', '').replace('.html', '');
    try {
      await page.goto(BASE + r, { waitUntil: 'load', timeout: 45000 }); await page.waitForTimeout(6000);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
      console.log('shot', tag, name);
    } catch (e) { console.log('fail', tag, name, String(e).slice(0, 150)); }
  }
  await ctx.close();
}
await run({ width: 1280, height: 769 }, 'desk');
await run({ width: 390, height: 844 }, 'phone');
await b.close();
