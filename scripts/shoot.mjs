import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../research/local-shots');
await mkdir(outDir, { recursive: true });

const BASE = 'http://localhost:4321/chiyo-gyosei-demo';
const all = { index: '/', shako: '/shako', passport: '/passport', about: '/about', contact: '/contact' };
const names = process.argv.slice(2);
const targets = (names.length ? names : Object.keys(all)).map((n) => ({ name: n, path: all[n] }));
const views = [
  { n: 'pc', w: 1280, h: 900, dsf: 1 },
  { n: 'sp', w: 390, h: 844, dsf: 2 },
];

const browser = await chromium.launch();
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dsf });
  for (const t of targets) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    try {
      await page.goto(BASE + t.path, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${outDir}/${t.name}-${v.n}.png`, fullPage: true });
      console.log(`[${t.name}-${v.n}] ${errs.length ? 'ERRORS: ' + errs.slice(0, 6).join(' | ') : 'ok'}`);
    } catch (e) {
      console.log(`[${t.name}-${v.n}] FAIL: ${e.message}`);
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('SHOTS DONE');
