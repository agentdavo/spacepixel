// Renders the Kessen concept sheets to PNG.
//   node scripts/concepts/kessen/render.mjs [sheetId ...]
// Serves the repo root (for node_modules/three), opens sheets.html?sheet=<id>
// in headless Chromium (SwiftShader WebGL2) and screenshots the full page
// into docs/concepts/kessen/.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, 'docs/concepts/kessen');
const SHEETS = ['01-origin', '02-kessendra', '03-statures', '04-variants', '05-weapons', '06-skeleton', '07-train', '08-culture'];
const want = process.argv.slice(2);

// Fonts: fetched once with curl (it trusts the environment's CA bundle) into
// an ignored cache, then served locally as fonts.css.
const FONT_DIR = join(ROOT, 'node_modules/.cache/kessen-fonts');
const FONT_CSS = [
  'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;600',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@900&text=%E6%B1%BA%E6%88%A6%E7%AB%8B%E6%AD%A9%E9%89%84%E4%BA%BA%E5%9E%8B',
];
if (!existsSync(join(FONT_DIR, 'fonts.css'))) {
  mkdirSync(FONT_DIR, { recursive: true });
  let css = '';
  for (const u of FONT_CSS) css += execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 Chrome/120', u], { encoding: 'utf8' });
  let i = 0;
  css = css.replace(/url\((https:[^)]+)\)/g, (_, u) => {
    const f = `f${i++}${extname(new URL(u).pathname) || '.ttf'}`;
    execFileSync('curl', ['-sS', '-o', join(FONT_DIR, f), u]);
    return `url(${f})`;
  });
  writeFileSync(join(FONT_DIR, 'fonts.css'), css);
}
const list = want.length ? want : SHEETS;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) throw new Error('outside root');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
for (const arg of list) {
  const t0 = Date.now();
  const [id, extra = ''] = arg.split('?');
  await page.goto(`http://localhost:${port}/scripts/concepts/kessen/sheets.html?sheet=${id}&${extra}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
  const file = id === 'pose' ? join(ROOT, 'node_modules/.cache/kessen-pose.png') : join(OUT, `${id}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`${id}.png  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await browser.close();
server.close();
