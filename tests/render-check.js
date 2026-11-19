// Neon Orbit — headless Chromium render check.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// asserts: menu renders with v0.5.0, PLAY starts level 1, a real mouse
// drag-aim + launch moves the comet and uses a shot, zero console errors
// and zero page errors, and a WebGL context exists. Also checks the Block 2
// additions: level cards show par + star thresholds, the power meter is
// visible while aiming, and the preview predicts the shot outcome.
// Block 3 additions: level 7 "Event Horizon" has a black hole and the
// bot-verified line completes it in 1 shot; level 8 "Carousel" has a
// moving planet whose mesh position actually changes over time, and a
// launch there resolves cleanly.
// Block 4: the grazing Level 4 line (-20deg, power 0.3) collects the
// target and credits a slingshot near-miss as it skims the planet.
// Block 5 additions (audio): layered music + intensity, the completed SFX
// set, and a persisted volume slider — see the audio block after the
// first level-1 shot, the level-3 intensity check after the save seed,
// and the last-shot warning check below.
// Reuses playwright-core from the Neon Hexfall checkout and the cached
// Chromium headless shell.
//
// CDN note: the repo pins Three.js 0.160.0 from jsdelivr and does NOT vendor
// it. The sandboxed browser cannot reach the jsdelivr CDN (the VM egress
// proxy answers policy_denied to every non-curl/wget client, including
// Chromium and Firefox), even though curl gets HTTP 200 for the pinned URL
// from this VM. So this check downloads the pinned module with curl into
// the OS temp dir and fulfils that one request locally via Playwright
// routing — the page still requests the exact pinned URL, and the repo
// keeps no copy of Three.js. On a machine where the browser can reach the
// CDN, set NO_THREE_CACHE=1 to skip the substitution and load it live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
console.log('render-check: chromium executable:', executablePath || '(playwright default)');
const launchArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: launchArgs,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));

  // Fulfil the pinned Three.js module from the curl-downloaded cache when
  // the sandboxed browser cannot reach the CDN (see header note). The page
  // still requests the exact pinned URL; nothing is vendored into the repo.
  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    console.log(`render-check: fulfilling pinned three@0.160.0 from local curl cache (${cached}) — sandboxed browser cannot reach jsdelivr directly`);
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The game module loads Three.js from the jsdelivr CDN; wait for the hooks.
  try {
    await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  } catch {
    console.error('render-check: window.__orbit never appeared — the pinned Three.js module failed to load.');
    console.error('CDN check from this VM: curl -sI ' + THREE_URL + ' (expect HTTP 200).');
    throw new Error('game module did not initialise (see CDN note above)');
  }

  const version = await page.evaluate(() => window.__orbit.version);
  const menuText = await page.textContent('#menu');
  if (version !== '0.5.0') throw new Error(`expected version 0.5.0, got ${version}`);
  if (!menuText.includes('NEON ORBIT')) throw new Error('menu title missing');
  if (!menuText.includes('v0.5.0')) throw new Error('menu version v0.5.0 missing');
  if (!menuText.includes('/ 24')) throw new Error('menu total stars should be / 24 (8 levels)');
  console.log('render-check: menu renders with v0.5.0');

  // Block 2: level cards show par and the star thresholds.
  const cardText = await page.textContent('#level-select');
  if (!cardText.includes('Par 2')) throw new Error('level card par missing');
  if (!cardText.includes('★★★ ≤ 2')) throw new Error('level card star thresholds missing');
  console.log('render-check: level cards show par + star thresholds');

  const webgl = await page.evaluate(() => {
    const c = document.querySelector('#game-container canvas');
    if (!c) return false;
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  if (!webgl) throw new Error('no WebGL context on the game canvas');
  console.log('render-check: WebGL context exists');

  // PLAY. On a first visit the how-to overlay shows at load instead of the
  // menu, so close it first if it is up.
  if (await page.isVisible('#howto')) {
    await page.click('#btn-howto-close');
  }
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const hudVisible = await page.isVisible('#hud');
  const levelName = await page.textContent('#hud-level');
  if (!hudVisible) throw new Error('HUD not visible after PLAY');
  if (!levelName.includes('First Light')) throw new Error(`expected level 1, got: ${levelName}`);
  const hudPar = await page.textContent('#hud-par');
  if (!hudPar.includes('Par 2')) throw new Error(`HUD par missing, got: ${hudPar}`);
  console.log('render-check: PLAY starts level 1 (First Light), HUD shows Par 2');

  // Block 2: while aiming, the power meter is visible and the preview
  // predicts the shot outcome. Drag part-way first and inspect mid-drag.

  // Real mouse drag-aim from the comet pad, then release to launch.
  // Camera fit at 1280x720: half-height 28 world units, half-width 28*aspect.
  // Pad (-14, 0) -> screen (460, 360). Pull left ~154px, up ~7px aims the
  // comet at about -2.5 degrees, full power — the bot-verified level 1 line.
  const box = await page.locator('#game-container canvas').boundingBox();
  const aspect = box.width / box.height;
  const halfW = 28 * aspect;
  const halfH = 28;
  const padX = box.x + (( -14 / halfW) * 0.5 + 0.5) * box.width;
  const padY = box.y + ((0 / halfH) * -0.5 + 0.5) * box.height;
  await page.mouse.move(padX, padY);
  await page.mouse.down();
  await page.mouse.move(padX - 154, padY - 7, { steps: 12 });
  const midDrag = await page.evaluate(() => ({
    meterVisible: !document.getElementById('power-meter').classList.contains('hidden'),
    powerLabel: document.getElementById('power-label').textContent,
    readout: document.getElementById('aim-readout').textContent,
    previewOutcome: window.__orbit.state.previewOutcome,
    previewEnd: window.__orbit.state.previewEnd,
  }));
  if (!midDrag.meterVisible) throw new Error('power meter not visible while aiming');
  if (!midDrag.powerLabel.startsWith('Power ')) throw new Error(`power label wrong: ${midDrag.powerLabel}`);
  if (!midDrag.readout.includes('Predicted:')) throw new Error(`aim readout has no prediction: ${midDrag.readout}`);
  if (!['collect', 'crash', 'lost'].includes(midDrag.previewOutcome)) {
    throw new Error(`unexpected preview outcome: ${midDrag.previewOutcome}`);
  }
  if (!midDrag.previewEnd || typeof midDrag.previewEnd.x !== 'number') {
    throw new Error('preview end point missing');
  }
  console.log(`render-check: mid-drag power meter "${midDrag.powerLabel}", preview predicts ${midDrag.previewOutcome}`);
  await page.mouse.up();
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  console.log('render-check: drag-aim + launch starts flight');

  // Block 4: the collect fires a shockwave ring and live particles while
  // the comet is still flying (polled fast — the ring only lives 0.7s).
  await page.waitForFunction(
    () => window.__orbit.feedbackState().shockwavesActive > 0,
    null, { polling: 20, timeout: 15000 },
  );
  const juice1 = await page.evaluate(() => window.__orbit.feedbackState());
  if (juice1.particlesAlive < 5) {
    throw new Error(`collect should leave live particles, got ${juice1.particlesAlive}`);
  }
  console.log(`render-check: collect fired a shockwave ring (${juice1.shockwavesActive} active, ${juice1.particlesAlive} particles alive)`);

  // Wait for the shot to resolve (collect, crash, or out of bounds).
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 15000 },
  );
  const after = await page.evaluate(() => ({
    phase: window.__orbit.state.phase,
    shotsUsed: window.__orbit.state.shotsUsed,
    targetsRemaining: window.__orbit.state.targetsRemaining,
  }));
  console.log(`render-check: shot resolved — phase=${after.phase}, shotsUsed=${after.shotsUsed}, targetsRemaining=${after.targetsRemaining}`);
  if (after.shotsUsed < 1 && after.phase !== 'complete') {
    throw new Error('launch did not consume a shot');
  }

  // Block 5: audio — completing level 1 unlocks level 2, which rings the
  // unlock chime after the win arpeggio; the music scheduler runs at
  // calm intensity 0 on level 1 with the default 60% volume, unmuted.
  await page.waitForFunction(
    () => window.__orbit.audioState().lastSfx === 'unlock',
    null, { polling: 50, timeout: 10000 },
  );
  const audio1 = await page.evaluate(() => window.__orbit.audioState());
  if (!audio1.audioReady) throw new Error('AudioContext was not created on PLAY');
  if (!audio1.musicPlaying) throw new Error('music scheduler is not running after PLAY');
  if (audio1.intensity !== 0) throw new Error(`level 1 calm intensity should be 0, got ${audio1.intensity}`);
  if (audio1.volume !== 0.6) throw new Error(`default volume should be 0.6, got ${audio1.volume}`);
  if (audio1.muted) throw new Error('game should start unmuted');
  console.log(`render-check: unlock chime fired, music playing at intensity ${audio1.intensity}, volume ${audio1.volume}`);

  // Block 5: mute toggle flips the persisted setting and the HUD label.
  await page.evaluate(() => document.getElementById('btn-mute-hud').click());
  const mutedState = await page.evaluate(() => ({
    muted: window.__orbit.audioState().muted,
    label: document.getElementById('btn-mute-hud').textContent,
  }));
  if (!mutedState.muted || mutedState.label !== 'Sound: Off') {
    throw new Error(`mute toggle failed: ${JSON.stringify(mutedState)}`);
  }
  await page.evaluate(() => document.getElementById('btn-mute-hud').click());
  if ((await page.evaluate(() => window.__orbit.audioState().muted))) {
    throw new Error('second mute toggle should unmute');
  }
  console.log('render-check: mute toggle flips state and label, and back');

  // Block 5: volume slider (pause menu) changes the live volume, persists
  // it to localStorage, and syncs the menu slider to the same value.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.evaluate(() => {
    const el = document.getElementById('volume-range-pause');
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const vol = await page.evaluate(() => ({
    volume: window.__orbit.audioState().volume,
    menuSlider: document.getElementById('volume-range-menu').value,
    stored: JSON.parse(window.localStorage.getItem('nor-settings') || '{}').volume,
  }));
  if (vol.volume !== 0.3) throw new Error(`volume slider should set 0.3, got ${vol.volume}`);
  if (vol.menuSlider !== '30') throw new Error(`menu slider should sync to 30, got ${vol.menuSlider}`);
  if (vol.stored !== 0.3) throw new Error(`volume should persist as 0.3, got ${vol.stored}`);
  console.log('render-check: volume slider sets 0.3 live, persists, and syncs to the menu slider');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });

  // Block 5: last-shot warning — burn 3 straight-up shots (each flies out
  // of bounds) so 1 shot remains; entering aim with 1 left fires the
  // lastShot SFX and the music jumps to tense intensity 1.
  for (let n = 1; n <= 3; n++) {
    await page.evaluate(() => {
      window.__orbit.aim(Math.PI / 2, 1.0);
      window.__orbit.launch();
    });
    await page.waitForFunction(
      (want) => window.__orbit.state.shotsUsed >= want,
      n, { timeout: 15000 },
    );
  }
  await page.waitForFunction(
    () => window.__orbit.audioState().lastSfx === 'lastShot',
    null, { polling: 50, timeout: 10000 },
  );
  const tense = await page.evaluate(() => window.__orbit.audioState().intensity);
  if (tense !== 1) throw new Error(`last-shot intensity should be 1, got ${tense}`);
  console.log('render-check: last-shot warning fired, music at tense intensity 1');

  // Block 3: level 7 "Event Horizon" has a black hole; the bot-verified
  // line (-10 degrees, full power) arcs over it and completes the level.
  // Seed a save that unlocks all 8 levels, then reload to pick it up.
  await page.evaluate(() => {
    window.localStorage.setItem('nor-stars', JSON.stringify({
      stars: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 },
      unlocked: 8,
      seenHowTo: true,
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  const cardText7 = await page.textContent('#level-select');
  if (!cardText7.includes('Event Horizon')) throw new Error('level 7 card missing');
  if (!cardText7.includes('Carousel')) throw new Error('level 8 card missing');

  // Block 5: level 3+ runs the music at mid intensity 1 (bass + arpeggio)
  // from the first aim, with a full shot budget.
  await page.evaluate(() => window.__orbit.selectLevel(3));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const mid = await page.evaluate(() => window.__orbit.audioState().intensity);
  if (mid !== 1) throw new Error(`level 3 mid intensity should be 1, got ${mid}`);
  console.log('render-check: level 3 music runs at mid intensity 1 (bass + arpeggio)');
  await page.evaluate(() => window.__orbit.selectLevel(7));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info7 = await page.evaluate(() => window.__orbit.info());
  if (info7.blackHoles !== 1) throw new Error(`level 7 should have 1 black hole, got ${info7.blackHoles}`);
  await page.evaluate(() => {
    window.__orbit.aim((-10 * Math.PI) / 180, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 15000 },
  );
  const after7 = await page.evaluate(() => ({
    phase: window.__orbit.state.phase,
    shotsUsed: window.__orbit.state.shotsUsed,
  }));
  if (after7.phase !== 'complete') {
    throw new Error(`bot line on level 7 should complete it, got phase=${after7.phase} shotsUsed=${after7.shotsUsed}`);
  }
  console.log('render-check: level 7 Event Horizon (1 black hole) completes on the bot line in 1 shot');

  // Block 3: level 8 "Carousel" has a moving planet whose mesh position
  // changes over time, and a launch there resolves cleanly.
  await page.evaluate(() => window.__orbit.selectLevel(8));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info8 = await page.evaluate(() => window.__orbit.info());
  if (info8.movingPlanets !== 1) throw new Error(`level 8 should have 1 moving planet, got ${info8.movingPlanets}`);
  const posA = await page.evaluate(() => window.__orbit.info().planetPositions[0]);
  await page.waitForTimeout(1200);
  const posB = await page.evaluate(() => window.__orbit.info().planetPositions[0]);
  const moved = Math.hypot(posB[0] - posA[0], posB[1] - posA[1]);
  if (moved < 0.5) throw new Error(`moving planet did not move (moved ${moved.toFixed(2)} in 1.2s)`);
  console.log(`render-check: level 8 Carousel moving planet moved ${moved.toFixed(2)} units in 1.2s`);
  await page.evaluate(() => {
    window.__orbit.aim((13 * Math.PI) / 180, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 15000 },
  );
  console.log('render-check: level 8 launch resolves cleanly');

  // Block 4: a straight shot into Level 4's planet crashes with a
  // large-tier trauma (>= 0.7) and a real hit-stop that then restores.
  await page.evaluate(() => window.__orbit.selectLevel(4));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(0, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(
    () => window.__orbit.feedbackState().hitStopActive,
    null, { polling: 20, timeout: 15000 },
  );
  const crashState = await page.evaluate(() => window.__orbit.feedbackState());
  if (crashState.trauma < 0.7) {
    throw new Error(`crash trauma should be large-tier (>= 0.7), got ${crashState.trauma}`);
  }
  if (crashState.hitStopToken < 1) throw new Error('crash should take a hit-stop token');
  if (crashState.shockwavesActive < 1) throw new Error('crash should fire a shockwave ring');
  console.log(`render-check: crash fired large trauma ${crashState.trauma.toFixed(2)} + hit-stop + shockwave`);
  await page.waitForFunction(
    () => !window.__orbit.feedbackState().hitStopActive,
    null, { polling: 20, timeout: 5000 },
  );
  console.log('render-check: hit-stop restored after the crash freeze');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1,
    null, { timeout: 15000 },
  );

  // Block 4: the grazing Level 4 line (-20deg, power 0.3) collects the
  // target and credits a slingshot near-miss as it skims the planet.
  await page.evaluate(() => window.__orbit.selectLevel(4));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim((-20 * Math.PI) / 180, 0.3);
    window.__orbit.launch();
  });
  await page.waitForFunction(
    () => window.__orbit.feedbackState().slingshotCount >= 1,
    null, { polling: 20, timeout: 15000 },
  );
  console.log('render-check: grazing Level 4 line credited a slingshot near-miss');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 15000 },
  );

  if (errors.length > 0) {
    throw new Error('console/page errors:\n' + errors.join('\n'));
  }
  console.log('render-check: zero console errors, zero page errors');
  console.log('render-check: PASS');
} finally {
  if (browser) await browser.close();
  server.close();
  if (errors.length > 0) {
    console.error('render-check errors:', errors.join(' | '));
    process.exit(1);
  }
}
