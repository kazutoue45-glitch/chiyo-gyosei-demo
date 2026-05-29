import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotDir = resolve(__dirname, '../research/screenshots');
const assetDir = resolve(__dirname, '../research/source-assets');
const contentDir = resolve(__dirname, '../research/content');

const sites = [
  { key: 'syako', url: 'https://syakosyoumei-osaka.jimdofree.com/' },
  { key: 'passport', url: 'https://passport-osaka.jimdofree.com/' },
];

const UA_PC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_SP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const sanitize = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'top';

const browser = await chromium.launch();

for (const site of sites) {
  console.log(`\n========== SITE: ${site.key} (${site.url}) ==========`);
  await mkdir(`${assetDir}/${site.key}`, { recursive: true });

  const ctxPc = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, userAgent: UA_PC });
  const page = await ctxPc.newPage();
  await page.goto(site.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 同一ドメイン内のページURLを収集（ナビ＝サイト構成）
  const host = new URL(site.url).host;
  const pageUrls = await page.evaluate((host) => {
    const set = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      try {
        const u = new URL(a.href, location.href);
        if (u.host === host && !u.href.match(/\.(jpg|jpeg|png|gif|pdf|zip)$/i) && !u.hash) {
          set.add(u.origin + u.pathname);
        }
      } catch (e) {}
    });
    return Array.from(set);
  }, host);
  console.log(`  found ${pageUrls.length} internal pages`);

  // ナビメニューのラベルも取得
  const navLabels = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('nav a, .cc-nav a, #cc-m-navigation a, .navigation a').forEach((a) => {
      const t = (a.textContent || '').trim();
      if (t) out.push({ text: t, href: a.href });
    });
    return out;
  });

  // トップの配色・フォント抽出
  const colors = await page.evaluate(() => {
    const sample = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, font: cs.fontFamily, fontSize: cs.fontSize }; };
    return { body: sample('body'), h1: sample('h1'), h2: sample('h2'), header: sample('header') || sample('#cc-m-header'), nav: sample('nav') };
  });

  // 全ページのURLリストを優先度付け（トップ＋主要ページ最大7件）
  const ordered = [site.url, ...pageUrls.filter((u) => u !== site.url && u !== site.url.replace(/\/$/, ''))];
  const uniq = Array.from(new Set(ordered)).slice(0, 8);

  const allContent = { site: site.key, url: site.url, navLabels, colors, pages: [] };
  const imgSet = new Map();

  for (const pageUrl of uniq) {
    const name = sanitize(new URL(pageUrl).pathname);
    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1500);
    } catch (e) { console.log(`  skip ${pageUrl}: ${e.message}`); continue; }

    // テキスト抽出（見出し階層＋本文）
    const text = await page.evaluate(() => {
      const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const main = document.querySelector('#cc-m-content, main, #content, .cc-m-content') || document.body;
      const bodyText = (main.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
      return { title: document.title, h1: pick('h1'), h2: pick('h2'), h3: pick('h3'), bodyText: bodyText.slice(0, 6000) };
    });
    allContent.pages.push({ url: pageUrl, name, ...text });
    console.log(`  [content] ${name}: h2=${text.h2.length} bodyLen=${text.bodyText.length}`);

    // PCスクショ
    await page.screenshot({ path: `${shotDir}/${site.key}-${name}-pc.png`, fullPage: true });
    console.log(`  [shot] ${site.key}-${name}-pc.png`);

    // 画像を収集
    const imgs = await page.evaluate(() => {
      const list = [];
      document.querySelectorAll('img').forEach((img) => { const s = img.currentSrc || img.src; if (s) list.push({ src: s, alt: img.alt || '', w: img.naturalWidth, h: img.naturalHeight }); });
      document.querySelectorAll('*').forEach((el) => { const bg = getComputedStyle(el).backgroundImage; if (bg && bg.includes('url(')) { for (const m of bg.matchAll(/url\(["']?(.+?)["']?\)/g)) list.push({ src: m[1], alt: 'bg', isBg: true }); } });
      return list;
    });
    for (const im of imgs) {
      if (!im.src || im.src.startsWith('data:')) continue;
      let abs; try { abs = new URL(im.src, pageUrl).toString(); } catch { continue; }
      if (imgSet.has(abs)) continue;
      imgSet.set(abs, im);
    }
  }

  // トップのSPスクショ
  const ctxSp = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: UA_SP });
  const sp = await ctxSp.newPage();
  try {
    await sp.goto(site.url, { waitUntil: 'networkidle', timeout: 45000 });
    await sp.waitForTimeout(1500);
    await sp.screenshot({ path: `${shotDir}/${site.key}-top-sp.png`, fullPage: true });
    console.log(`  [shot] ${site.key}-top-sp.png`);
  } catch (e) { console.log(`  sp shot fail: ${e.message}`); }
  await ctxSp.close();

  // 画像DL
  let i = 0;
  for (const [abs, im] of imgSet) {
    i++;
    try {
      const res = await ctxPc.request.get(abs);
      if (!res.ok()) { console.log(`  img skip ${res.status()} ${abs.slice(-40)}`); continue; }
      const buf = await res.body();
      if (buf.length < 1000) continue; // アイコン等の極小は除外
      const base = abs.split('?')[0].split('/').pop() || 'img';
      const ext = (base.split('.').pop() || '').toLowerCase();
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext) ? ext : 'bin';
      const fn = `${String(i).padStart(2, '0')}-${base}`.slice(0, 50);
      await writeFile(`${assetDir}/${site.key}/${fn}`, buf);
      console.log(`  [DL] ${fn} (${(buf.length / 1024).toFixed(0)}KB) ${im.w || ''}x${im.h || ''} ${im.alt ? '«' + im.alt.slice(0, 20) + '»' : ''}`);
    } catch (e) { console.log(`  img fail ${e.message}`); }
  }

  await writeFile(`${contentDir}/${site.key}.json`, JSON.stringify(allContent, null, 2));
  await ctxPc.close();
  console.log(`  [saved] content/${site.key}.json`);
}

await browser.close();
console.log('\nDONE');
