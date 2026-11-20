// Neon Orbit — real gameplay screenshot capture.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// captures three PNGs into docs/screenshots/ for the README:
//   menu.png      — the main menu with the campaign map
//   gameplay.png  — level 1 mid-flight, comet trail ribbon glowing
//   complete.png  — the level-complete screen with the confetti burst
// Reuses the render-check's Three.js CDN workaround (the sandboxed browser
// cannot reach jsdelivr; the pinned module is fulfilled from a curl cache
// in the OS temp dir — nothing is vendored into the repo).
// Run: node tests/screenshots.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(GAME_DIR, 'docs', 'screenshots');
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const THREE_CACHE = path.join(os.tmpdir(), 'neon-orbit-three-0.160.0.module.js');

async function fetchThreeModule() {
  try {
    const st = fs.statSync(THREE_CACHE);
    if (st.size > 100000) return THREE_CACHE;
  } catch { /* not cached yet */ }
  await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', THREE_CACHE, THREE_URL], (err) => (err ? reject(err) : resolve()));
  });
  const st = fs.statSync(THREE_CACHE);
  if (st.size < 100000) throw new Error(`downloaded Three.js module is unexpectedly small (${st.size} bytes)`);
  return THREE_CACHE;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const require = createRequire(import.meta.url);
const playwrightPath = fileURLToPath(new URL('../../neon-hexfall/node_modules/playwright-core', import.meta.url));
const { chromium } = require(playwrightPath);
const executablePath = findHeadlessShell();
console.log('screenshots: chromium executable:', executablePath || '(playwright default)');

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));

  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  const version = await page.evaluate(() => window.__orbit.version);
  if (version !== '0.13.0') throw new Error(`expected version 0.13.0, got ${version}`);
  if (await page.isVisible('#howto')) await page.click('#btn-howto-close');
  await page.waitForTimeout(800); // let the menu scene settle

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu.png') });
  console.log('screenshots: menu.png captured');

  // Level 1 through the solver hook, screenshot mid-flight with the
  // trail ribbon visible, then again on the complete screen with
  // the confetti burst still live.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const shot = await page.evaluate(() => window.__orbit.solveShot());
  if (!shot) throw new Error('solver found no collecting line on level 1');
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
    window.__orbit.launch();
  }, shot);
  await page.waitForFunction(
    () => window.__orbit.visualState().trailPoints >= 5,
    null, { polling: 20, timeout: 30000 },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay.png') });
  console.log('screenshots: gameplay.png captured (trail ribbon mid-flight)');
  await page.waitForFunction(() => window.__orbit.state.phase === 'complete', null, { timeout: 30000 });
  await page.waitForFunction(
    () => window.__orbit.visualState().confettiActive >= 5,
    null, { polling: 20, timeout: 10000 },
  );
  await page.waitForTimeout(150); // let the shards spread a little
  await page.screenshot({ path: path.join(SHOTS_DIR, 'complete.png') });
  console.log('screenshots: complete.png captured (confetti burst)');

  if (errors.length) {
    console.error('screenshots: console/page errors during capture:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s) during capture`);
  }
  for (const name of ['menu.png', 'gameplay.png', 'complete.png']) {
    const st = fs.statSync(path.join(SHOTS_DIR, name));
    console.log(`screenshots: ${name} — ${(st.size / 1024).toFixed(1)} KB`);
  }
  console.log('screenshots: PASS — 3 real gameplay captures, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
