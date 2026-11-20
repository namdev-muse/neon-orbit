// Neon Orbit v2 — real gameplay screenshot capture + size sweep.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// captures three PNGs into docs/screenshots/ for the README:
//   menu.png      — the main menu over the live 3D attract scene
//   gameplay.png  — level 1 mid-flight, comet trail ribbon glowing, fuel burning
//   complete.png  — the level-complete screen with the confetti burst
// Then runs the game-ui-ux size sweep (1280x720, 2560x1080, 1080x2340):
// menu screenshots at each size go to /tmp/neon-orbit-size-sweep/ for the
// by-eye check — no clipped or overlapping elements at any size.
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
const SWEEP_DIR = path.join(os.tmpdir(), 'neon-orbit-size-sweep');
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
  if (version !== '2.1.0') throw new Error(`expected version 2.1.0, got ${version}`);
  if (await page.isVisible('#howto')) await page.click('#btn-howto-close');
  await page.waitForTimeout(1200); // menu pop-in + attract comet orbits in

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu.png') });
  console.log('screenshots: menu.png captured');

  // Level 1 through the thrust solver hook: steer from the very first
  // frame (the plan assumes thrust from t=0 — waiting for a screenshot
  // first would let the comet fly ballistically off the planned arc),
  // capture gameplay.png mid-flight once the trail ribbon is visible,
  // then the complete screen with the confetti burst still live.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const plan = await page.evaluate(() => window.__orbit.solveThrust());
  if (!plan || !plan.lines.length) throw new Error('thrust solver found no plan for level 1');
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
    window.__orbit.launch();
  }, plan.lines[0]);
  let shotTaken = false;
  const started = Date.now();
  for (;;) {
    const phase = await page.evaluate(() => window.__orbit.state.phase);
    if (phase !== 'fly') break;
    if (Date.now() - started > 60000) throw new Error('level 1 flight did not resolve within 60s');
    if (!shotTaken) {
      const trail = await page.evaluate(() => window.__orbit.visualState().trailPoints);
      if (trail >= 5) {
        await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay.png') });
        console.log('screenshots: gameplay.png captured (trail ribbon mid-flight)');
        shotTaken = true;
      }
    }
    await page.evaluate(() => {
      const o = window.__orbit;
      const f = o.flightState();
      if (!f) return;
      const info = o.info();
      const remaining = info.targetPositions
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => !o.state.collected.includes(i));
      if (!remaining.length) { o.setThrust(null); return; }
      let best = null, bd = Infinity;
      for (const { t } of remaining) {
        const d = Math.hypot(t[0] - f.x, t[1] - f.y);
        if (d < bd) { bd = d; best = t; }
      }
      const dx = best[0] - f.x, dy = best[1] - f.y;
      const d = Math.hypot(dx, dy) || 1;
      const dvx = (dx / d) * 9 - f.vx, dvy = (dy / d) * 9 - f.vy;
      const err = Math.hypot(dvx, dvy);
      if (err > 1.0) o.setThrust(dvx / err, dvy / err);
      else o.setThrust(null);
    });
    await page.waitForTimeout(200);
  }
  const phase = await page.evaluate(() => window.__orbit.state.phase);
  if (phase !== 'complete') throw new Error(`level 1 did not complete (phase=${phase})`);
  await page.waitForFunction(
    () => window.__orbit.visualState().confettiActive >= 5,
    null, { polling: 20, timeout: 10000 },
  );
  await page.waitForTimeout(150); // let the shards spread a little
  await page.screenshot({ path: path.join(SHOTS_DIR, 'complete.png') });
  console.log('screenshots: complete.png captured (confetti burst)');

  // Size sweep (game-ui-ux step 8): the menu at 1280x720, 2560x1080 and
  // 1080x2340 — inspect all three for clipped or overlapping elements.
  // One context, resized between shots: a fresh context per size churned
  // WebGL contexts under swiftshader and the 2560x1080 page never got
  // __orbit in 30s. The main page is closed first so only one heavy
  // WebGL page is alive at a time.
  await context.close();
  fs.mkdirSync(SWEEP_DIR, { recursive: true });
  const sweepCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
  });
  const sweepPage = await sweepCtx.newPage();
  sweepPage.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('sweep console: ' + msg.text());
  });
  sweepPage.on('pageerror', (err) => errors.push('sweep pageerror: ' + String(err)));
  if (!process.env.NO_THREE_CACHE) {
    await sweepPage.route(THREE_URL, (route) => route.fulfill({ path: THREE_CACHE }));
  }
  await sweepPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sweepPage.waitForFunction(() => window.__orbit, null, { timeout: 60000 });
  if (await sweepPage.isVisible('#howto')) await sweepPage.click('#btn-howto-close');
  for (const [w, h] of [[1280, 720], [2560, 1080], [1080, 2340]]) {
    await sweepPage.setViewportSize({ width: w, height: h });
    await sweepPage.waitForTimeout(1200); // resize settles + menu pop-in
    // No horizontal overflow at any size — the layout must fit.
    const overflow = await sweepPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error(`horizontal overflow at ${w}x${h}`);
    const name = `menu-${w}x${h}.png`;
    // A 1080x2340 swiftshader frame takes a while to composite; the
    // default 30s screenshot timeout is too short for the tall shot.
    await sweepPage.screenshot({ path: path.join(SWEEP_DIR, name), timeout: 120000 });
    console.log(`screenshots: sweep ${name} captured (no horizontal overflow)`);
  }
  await sweepCtx.close();
  console.log(`screenshots: size sweep saved to ${SWEEP_DIR} — INSPECT BY EYE (no clipped/overlapping elements)`);

  if (errors.length) {
    console.error('screenshots: console/page errors during capture:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s) during capture`);
  }
  for (const name of ['menu.png', 'gameplay.png', 'complete.png']) {
    const st = fs.statSync(path.join(SHOTS_DIR, name));
    console.log(`screenshots: ${name} — ${(st.size / 1024).toFixed(1)} KB`);
  }
  console.log('screenshots: PASS — 3 README captures + 3 size-sweep captures, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
