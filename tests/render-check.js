// Neon Orbit — headless Chromium render check.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// asserts: menu renders with v0.13.0, PLAY starts level 1, a real mouse
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
// Block 6 additions (challenge modes): the menu shows the Daily Orbit
// button with today's date, the Endless Orbit button and the seed box;
// the daily level plays to completion (solved through the public hook)
// and records a daily best; ?seed=777 auto-starts the same generated
// level and records a seed best; Endless Orbit completes round 1 and
// advances to round 2 at a higher difficulty.
// Block 7 additions (UI): the menu shows a campaign progress bar (levels
// cleared + stars earned) with a gold NEXT ring on the next uncompleted
// level, a My Stats overlay lists best stars per level plus challenge
// bests, and the failed screen shows attempt stats with a Level Select
// button that returns to the campaign map.
// Block 8 additions (touch / keyboard / responsive): a touchscreen tap
// launches with the current aim, Enter starts the game from the menu and
// Space launches, arrow keys adjust the aim and navigate the level grid,
// P pauses with Resume focused and Enter resumes, Escape closes My Stats,
// the mouse wheel / HUD buttons / + and - keys zoom the camera (clamped
// 0.6..2.0), a two-finger pinch zooms without launching, and a 390x844
// phone viewport shows a 2-column grid with no horizontal overflow.
// Block 9 additions (portals / shields / bounce): level 9 "Portal Hop"
// has a paired portal the solver's line hops through, level 10
// "Shielded Stars" has two shielded targets that crack on the first hit
// and collect on the second, and level 11 "Bounce House" has a bounce
// pad the bot-verified line (37.5deg, power 0.59) reflects off to
// collect a target.
// Block 10 additions (moving targets / time attack / difficulty): level
// 12 "Moving Stars" has two moving targets whose mesh positions change
// over time and completes through the solver hook; Time Attack starts a
// 4:00 clock across levels 1-5, shows the HUD timer, and advances to
// level 2 after the first clear with the clock still running.
// Block 11 additions (browser playtest + bot harness + bugfix pass):
// the bot plays the six campaign levels no earlier section completed
// (2, 3, 4, 5, 6, 8) through the live game, asserting completion and
// >= 1 star each — so all 12 levels are now bot-verified in the
// browser; the pause menu's Restart Level and Quit to Menu are clicked
// for real; and the NaN guards + 1s state audit are exercised by
// corrupting the live flight and the level clock through the test hook.
// Block 12 additions (visual polish): the nebula background shader
// animates, every planet wears a fresnel atmosphere halo, the comet's
// trail is a fading glow ribbon mid-flight, and completing a level
// bursts 3D confetti shards from the collected targets.
// Block 14 additions (perf + accessibility): an FPS guard steps the
// pixel ratio and particle budget down on sustained slow frames and back
// up when fast; reduce-motion and music toggles live in the menu and the
// pause menu and persist; a screen-reader live region announces level
// starts, collects, lost shots, wins and failures; every interactive
// element shows a visible cyan focus outline.
// Timeout note (Block 12): the fullscreen nebula shader doubles the
// frame cost under swiftshader (in-level ~8fps, game time ~0.36x real
// time), so every game-time-bound wait in this file uses a 30s timeout
// (20s for the 10s ones) — a 10s-max flight takes ~28s of real time
// there. On a real GPU the game runs at 60fps and these waits resolve
// in a few seconds; the longer timeouts only slow down a genuine
// failure, they never weaken an assertion.
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

// Plays the current level to completion through the public solveShot hook:
// polls for a collecting line (the 3s launch window slides with the level
// clock, so a moving-planet level eventually offers one), waits for the
// clock to reach its launch time, launches, and repeats until the level
// completes or the shot budget runs out.
async function playLevelToCompletion(page, label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const phase = await page.evaluate(() => window.__orbit.state.phase);
    if (phase === 'complete') return;
    if (phase === 'failed') throw new Error(`${label}: level failed (out of shots)`);
    if (phase !== 'aim') {
      await page.waitForFunction(
        () => ['aim', 'complete', 'failed'].includes(window.__orbit.state.phase),
        null, { timeout: 30000 },
      );
      continue;
    }
    let shot = null;
    for (let p = 0; p < 30 && !shot; p++) {
      shot = await page.evaluate(() => window.__orbit.solveShot());
      if (!shot) await page.waitForTimeout(500);
    }
    if (!shot) throw new Error(`${label}: solver found no collecting line in 15s`);
    await page.waitForFunction(
      (t0) => window.__orbit.info().levelTime >= t0 - 0.05,
      shot.t0, { timeout: 20000 },
    );
    const before = await page.evaluate(() => window.__orbit.state.shotsUsed);
    await page.evaluate((s) => {
      window.__orbit.aim(s.angle, s.power);
      window.__orbit.launch();
    }, shot);
    await page.waitForFunction(
      (want) => window.__orbit.state.shotsUsed > want || window.__orbit.state.phase === 'complete',
      before, { timeout: 30000 },
    );
  }
  const phase = await page.evaluate(() => window.__orbit.state.phase);
  if (phase !== 'complete') throw new Error(`${label}: did not complete after 8 shots (phase=${phase})`);
}

// Back to the main menu from any end state (complete / failed / in-level).
async function quitToMenu(page) {
  const phase = await page.evaluate(() => window.__orbit.state.phase);
  if (phase === 'complete') {
    await page.click('#btn-menu-complete');
  } else if (phase === 'failed') {
    await page.click('#btn-menu-failed');
  } else {
    await page.keyboard.press('p');
    await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
    await page.click('#btn-quit');
  }
  await page.waitForFunction(() => window.__orbit.state.phase === 'menu', null, { timeout: 5000 });
}

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
  // The daily level is date-based, so the browser runs in the player's
  // timezone (Asia/Bangkok) — otherwise the headless shell's UTC clock
  // would show yesterday's daily.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true, // Block 8: touchscreen.tap drives the tap-to-launch test
  });
  const page = await context.newPage();
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
  if (version !== '0.14.0') throw new Error(`expected version 0.14.0, got ${version}`);
  if (!menuText.includes('NEON ORBIT')) throw new Error('menu title missing');
  if (!menuText.includes('v0.14.0')) throw new Error('menu version v0.14.0 missing');
  if (!menuText.includes('/ 36')) throw new Error('menu total stars should be / 36 (12 levels)');
  console.log('render-check: menu renders with v0.14.0');

  // Block 6: challenge-mode menu — Daily Orbit shows today's date, the
  // Endless Orbit button and the seed box are present.
  if (!menuText.includes('Daily Orbit — 2026-11-20')) {
    throw new Error(`daily button should show today's date, menu says: ${menuText.slice(0, 200)}`);
  }
  if (!menuText.includes('Endless Orbit')) throw new Error('endless button missing');
  if (!menuText.includes('Time Attack')) throw new Error('time attack button missing');
  const seedPlaceholder = await page.getAttribute('#seed-input', 'placeholder');
  if (!seedPlaceholder || !seedPlaceholder.includes('Seed')) {
    throw new Error(`seed input missing, placeholder: ${seedPlaceholder}`);
  }
  console.log('render-check: menu shows Daily Orbit (2026-11-20), Endless Orbit, and the seed box');

  // Block 2: level cards show par and the star thresholds.
  const cardText = await page.textContent('#level-select');
  if (!cardText.includes('Par 2')) throw new Error('level card par missing');
  if (!cardText.includes('★★★ ≤ 2')) throw new Error('level card star thresholds missing');
  console.log('render-check: level cards show par + star thresholds');

  // Block 7: campaign progress bar + NEXT ring on the next uncompleted
  // level, and the My Stats overlay with a per-level best-stars table.
  const progressText = await page.textContent('#campaign-progress');
  if (!progressText.includes('Campaign — 0/12 cleared')) {
    throw new Error(`campaign progress wrong: ${progressText}`);
  }
  if (!progressText.includes('0 / 36 stars')) {
    throw new Error(`campaign stars wrong: ${progressText}`);
  }
  const nextCard = await page.evaluate(() => {
    const el = document.querySelector('.level-btn.current');
    return el ? el.textContent : null;
  });
  if (!nextCard || !nextCard.includes('First Light') || !nextCard.includes('NEXT')) {
    throw new Error(`next level card should be First Light with a NEXT tag, got: ${nextCard}`);
  }
  console.log('render-check: campaign progress 0/12 cleared, 0/36 stars, NEXT ring on First Light');

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

  // Block 7: the My Stats overlay lists best stars per level (8 rows,
  // locked levels marked) plus the campaign totals and challenge bests,
  // and closes back to the menu.
  await page.click('#btn-stats');
  await page.waitForFunction(() => !document.getElementById('stats').classList.contains('hidden'), null, { timeout: 5000 });
  const statsRows = await page.evaluate(() => document.querySelectorAll('#stats-body tr').length);
  if (statsRows !== 12) throw new Error(`stats table should have 12 rows, got ${statsRows}`);
  const statsTotals = await page.textContent('#stats-totals');
  if (!statsTotals.includes('Campaign: 0 / 36 stars · 0 / 12 levels cleared')) {
    throw new Error(`stats totals wrong: ${statsTotals}`);
  }
  const statsChallenge = await page.textContent('#stats-challenge');
  if (!statsChallenge.includes('Daily best today: ☆☆☆') || !statsChallenge.includes('Endless best: 0 rounds')) {
    throw new Error(`stats challenge line wrong: ${statsChallenge}`);
  }
  const statsFirstRow = await page.evaluate(() => document.querySelector('#stats-body tr').textContent);
  if (!statsFirstRow.includes('First Light') || !statsFirstRow.includes('☆☆☆')) {
    throw new Error(`stats first row wrong: ${statsFirstRow}`);
  }
  console.log('render-check: My Stats shows 12 rows, 0/36 stars, daily + endless + time attack bests');
  await page.click('#btn-stats-close');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });

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
    null, { polling: 20, timeout: 30000 },
  );
  const juice1 = await page.evaluate(() => window.__orbit.feedbackState());
  if (juice1.particlesAlive < 5) {
    throw new Error(`collect should leave live particles, got ${juice1.particlesAlive}`);
  }
  console.log(`render-check: collect fired a shockwave ring (${juice1.shockwavesActive} active, ${juice1.particlesAlive} particles alive)`);

  // Wait for the shot to resolve (collect, crash, or out of bounds).
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 30000 },
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
    null, { polling: 50, timeout: 20000 },
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

  // Block 14: accessibility + perf. Start from a fresh level 1 so the
  // two corrupted shots below have a full budget, and hand a fresh level
  // back to the last-shot test afterwards.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });

  // The live region announces the level start for screen readers.
  const announced = await page.evaluate(() => window.__orbit.settingsState().lastAnnouncement);
  if (!announced.includes('Level 1 — First Light') || !announced.includes('Par 2')) {
    throw new Error(`live region should announce the level start, got: ${announced}`);
  }
  const liveRegion = await page.evaluate(() => {
    const el = document.getElementById('sr-status');
    return { role: el.getAttribute('role'), live: el.getAttribute('aria-live') };
  });
  if (liveRegion.role !== 'status' || liveRegion.live !== 'polite') {
    throw new Error(`live region attributes wrong: ${JSON.stringify(liveRegion)}`);
  }
  console.log(`render-check: live region announces "${announced}" (role=status, aria-live=polite)`);

  // The stylesheet carries a visible focus outline and a reduced-motion
  // media query (read as served text — :focus-visible only matches on
  // real keyboard focus, which a headless click cannot fake).
  const cssText = await page.evaluate(async () => (await fetch('style.css')).text());
  if (!cssText.includes('outline: 2px solid var(--cyan)')) {
    throw new Error('stylesheet is missing the visible focus outline');
  }
  if (!cssText.includes('@media (prefers-reduced-motion: reduce)')) {
    throw new Error('stylesheet is missing the reduced-motion media query');
  }
  if (!cssText.includes('.sr-only')) throw new Error('stylesheet is missing the .sr-only class');
  console.log('render-check: stylesheet has visible focus outlines, .sr-only, and a reduced-motion query');

  // Reduce motion (pause menu): flip it on, check it persists and syncs
  // to the menu checkbox, then prove it zeroes shake — a corrupted
  // flight ends as a lost shot, which normally adds 0.15 trauma.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#reduce-motion-pause');
  const rmOn = await page.evaluate(() => ({
    setting: window.__orbit.settingsState().reduceMotion,
    menuChecked: document.getElementById('reduce-motion-menu').checked,
    stored: JSON.parse(window.localStorage.getItem('nor-settings') || '{}').reduceMotion,
  }));
  if (!rmOn.setting || !rmOn.menuChecked || rmOn.stored !== true) {
    throw new Error(`reduce-motion toggle failed: ${JSON.stringify(rmOn)}`);
  }
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(Math.PI / 2, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  await page.evaluate(() => window.__orbit.testCorrupt('flight'));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 30000 });
  const rmShot = await page.evaluate(() => ({
    peakTrauma: window.__orbit.feedbackState().peakTrauma,
    announcement: window.__orbit.settingsState().lastAnnouncement,
  }));
  if (rmShot.peakTrauma !== 0) {
    throw new Error(`reduce motion should keep peak trauma at 0, got ${rmShot.peakTrauma}`);
  }
  if (!rmShot.announcement.includes('out of bounds')) {
    throw new Error(`lost shot should announce out of bounds, got: ${rmShot.announcement}`);
  }
  console.log('render-check: reduce motion on — lost shot adds 0 trauma and announces "out of bounds"');

  // Same corrupted shot with reduce motion off: trauma must register.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#reduce-motion-pause');
  if ((await page.evaluate(() => window.__orbit.settingsState().reduceMotion))) {
    throw new Error('reduce-motion toggle should turn off on second click');
  }
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(Math.PI / 2, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  await page.evaluate(() => window.__orbit.testCorrupt('flight'));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 30000 });
  const normalShot = await page.evaluate(() => window.__orbit.feedbackState().peakTrauma);
  if (normalShot < 0.15) {
    throw new Error(`reduce motion off should let the lost shot add trauma, got peak ${normalShot}`);
  }
  console.log(`render-check: reduce motion off — same lost shot peaks at trauma ${normalShot}`);

  // Music toggle (pause menu): off stops the scheduler, on restarts it.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#music-toggle-pause');
  const musicOff = await page.evaluate(() => ({
    music: window.__orbit.settingsState().music,
    playing: window.__orbit.audioState().musicPlaying,
    stored: JSON.parse(window.localStorage.getItem('nor-settings') || '{}').music,
    menuChecked: document.getElementById('music-toggle-menu').checked,
  }));
  if (musicOff.music || musicOff.playing || musicOff.stored !== false || musicOff.menuChecked) {
    throw new Error(`music toggle off failed: ${JSON.stringify(musicOff)}`);
  }
  await page.click('#music-toggle-pause');
  const musicOn = await page.evaluate(() => ({
    music: window.__orbit.settingsState().music,
    playing: window.__orbit.audioState().musicPlaying,
  }));
  if (!musicOn.music || !musicOn.playing) {
    throw new Error(`music toggle on failed: ${JSON.stringify(musicOn)}`);
  }
  console.log('render-check: music toggle stops the scheduler when off and restarts it when on');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });

  // FPS guard: the guard reports a sane state; feeding it slow frames
  // steps the quality down (pixel ratio drops), fast frames step it back
  // to full quality. testPerf runs synchronously, so no real frame can
  // interleave and skew the EMA mid-feed.
  const perfBefore = await page.evaluate(() => window.__orbit.perfState());
  if (!(perfBefore.emaMs > 0) || perfBefore.level < 0 || perfBefore.level > 3
    || ![2, 1.5, 1.25, 1].includes(perfBefore.targetPixelRatio)) {
    throw new Error(`perf state looks wrong: ${JSON.stringify(perfBefore)}`);
  }
  const slowLevel = await page.evaluate(() => window.__orbit.testPerf(30, 150));
  const perfSlow = await page.evaluate(() => window.__orbit.perfState());
  if (slowLevel < 1 || perfSlow.targetPixelRatio >= 2 || perfSlow.particleScale >= 1) {
    throw new Error(`slow frames should step quality down, got level ${slowLevel}: ${JSON.stringify(perfSlow)}`);
  }
  const fastLevel = await page.evaluate(() => window.__orbit.testPerf(8, 1500));
  const perfFast = await page.evaluate(() => window.__orbit.perfState());
  if (fastLevel !== 0 || perfFast.targetPixelRatio !== 2 || perfFast.particleScale !== 1) {
    throw new Error(`fast frames should recover full quality, got level ${fastLevel}: ${JSON.stringify(perfFast)}`);
  }
  console.log(`render-check: FPS guard steps down to level ${slowLevel} on slow frames (target pixel ratio ${perfSlow.targetPixelRatio}) and back to 0 on fast frames (EMA ${perfFast.emaMs}ms, ${perfFast.stepsDown} down / ${perfFast.stepsUp} up)`);
  // Hand the last-shot test a fresh level 1.
  await page.evaluate(() => window.__orbit.selectLevel(1));
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
      n, { timeout: 30000 },
    );
  }
  await page.waitForFunction(
    () => window.__orbit.audioState().lastSfx === 'lastShot',
    null, { polling: 50, timeout: 20000 },
  );
  const tense = await page.evaluate(() => window.__orbit.audioState().intensity);
  if (tense !== 1) throw new Error(`last-shot intensity should be 1, got ${tense}`);
  console.log('render-check: last-shot warning fired, music at tense intensity 1');

  // Block 7: burn the last shot — the level fails, the failed screen
  // shows the attempt stats (shots used vs budget, par, banked best),
  // and Level Select returns to the campaign map.
  await page.evaluate(() => {
    window.__orbit.aim(Math.PI / 2, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'failed', null, { timeout: 30000 });
  const failedText = await page.textContent('#failed-stats');
  if (!failedText.includes('Shots used: 4 / 4 · Par 2')) {
    throw new Error(`failed stats wrong: ${failedText}`);
  }
  if (!failedText.includes('Best on this level: ★★★')) {
    throw new Error(`failed stats should show the banked best: ${failedText}`);
  }
  console.log(`render-check: failed screen shows attempt stats (${failedText.trim()})`);
  await page.click('#btn-level-select');
  await page.waitForFunction(() => window.__orbit.state.phase === 'menu', null, { timeout: 5000 });
  if (!await page.isVisible('#level-select')) {
    throw new Error('level select not visible after Level Select');
  }
  console.log('render-check: Level Select returns to the campaign map');

  // Block 3: level 7 "Event Horizon" has a black hole; the bot-verified
  // line (-10 degrees, full power) arcs over it and completes the level.
  // Seed a save that unlocks all 12 levels, then reload to pick it up.
  await page.evaluate(() => {
    window.localStorage.setItem('nor-stars', JSON.stringify({
      stars: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 },
      unlocked: 12,
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
    null, { timeout: 30000 },
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
    null, { timeout: 30000 },
  );
  console.log('render-check: level 8 launch resolves cleanly');

  // Block 9: level 9 "Portal Hop" has one portal pair; the solver's
  // first line hops through it to collect the far target.
  await page.evaluate(() => window.__orbit.selectLevel(9));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info9 = await page.evaluate(() => window.__orbit.info());
  if (info9.portals !== 2) throw new Error(`level 9 should have 2 portals, got ${info9.portals}`);
  const portalShot = await page.evaluate(() => window.__orbit.solveShot());
  if (!portalShot) throw new Error('solver found no collecting line on level 9');
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
    window.__orbit.launch();
  }, portalShot);
  await page.waitForFunction(
    () => window.__orbit.feedbackState().portalCount >= 1,
    null, { polling: 20, timeout: 30000 },
  );
  const portalAudio = await page.evaluate(() => window.__orbit.audioState().lastSfx);
  if (portalAudio !== 'portal') throw new Error(`portal hop should play the portal SFX, got: ${portalAudio}`);
  console.log('render-check: level 9 portal hop fired (portalCount 1, portal SFX)');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 30000 },
  );
  await playLevelToCompletion(page, 'portal hop');
  console.log('render-check: level 9 Portal Hop completes');

  // Block 9: level 10 "Shielded Stars" has two shielded targets; the
  // first hit cracks a shield (no collect), the second collects it.
  await page.evaluate(() => window.__orbit.selectLevel(10));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info10 = await page.evaluate(() => window.__orbit.info());
  if (info10.shieldedTargets !== 2) {
    throw new Error(`level 10 should have 2 shielded targets, got ${info10.shieldedTargets}`);
  }
  const crackShot = await page.evaluate(() => window.__orbit.solveShot());
  if (!crackShot) throw new Error('solver found no line on level 10');
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
    window.__orbit.launch();
  }, crackShot);
  await page.waitForFunction(
    () => window.__orbit.feedbackState().shieldHitCount >= 1,
    null, { polling: 20, timeout: 30000 },
  );
  const cracked = await page.evaluate(() => window.__orbit.info().shieldHits);
  if (Object.keys(cracked).length < 1) {
    throw new Error(`cracked shield should persist in state, got: ${JSON.stringify(cracked)}`);
  }
  const shieldAudio = await page.evaluate(() => window.__orbit.audioState().lastSfx);
  if (shieldAudio !== 'shieldhit') throw new Error(`shield crack should play the shieldhit SFX, got: ${shieldAudio}`);
  console.log(`render-check: level 10 shield cracked (${JSON.stringify(cracked)}), shieldhit SFX`);
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1,
    null, { timeout: 30000 },
  );
  await playLevelToCompletion(page, 'shielded stars');
  console.log('render-check: level 10 Shielded Stars completes in 4 shots');

  // Block 9: level 11 "Bounce House" has one bounce pad; the
  // bot-verified line (37.5deg, power 0.59) reflects off it to collect
  // the upper target.
  await page.evaluate(() => window.__orbit.selectLevel(11));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info11 = await page.evaluate(() => window.__orbit.info());
  if (info11.bouncePads !== 1) throw new Error(`level 11 should have 1 bounce pad, got ${info11.bouncePads}`);
  await page.evaluate(() => {
    window.__orbit.aim((37.5 * Math.PI) / 180, 0.59);
    window.__orbit.launch();
  });
  await page.waitForFunction(
    () => window.__orbit.feedbackState().bounceCount >= 1,
    null, { polling: 20, timeout: 30000 },
  );
  const bounceAudio = await page.evaluate(() => window.__orbit.audioState().lastSfx);
  if (bounceAudio !== 'bounce') throw new Error(`bounce should play the bounce SFX, got: ${bounceAudio}`);
  console.log('render-check: level 11 bounce pad reflected the comet (bounceCount 1, bounce SFX)');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 30000 },
  );
  await playLevelToCompletion(page, 'bounce house');
  console.log('render-check: level 11 Bounce House completes');

  // Block 10: level 12 "Moving Stars" has two moving targets whose mesh
  // positions change over time; the solver's lines collect them and the
  // level completes.
  await page.evaluate(() => window.__orbit.selectLevel(12));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const info12 = await page.evaluate(() => window.__orbit.info());
  if (info12.movingTargets !== 2) {
    throw new Error(`level 12 should have 2 moving targets, got ${info12.movingTargets}`);
  }
  // Drift is measured over 0.8s of GAME time, not wall time: under
  // swiftshader the game runs at ~0.25x real time, so a fixed 1.2s wall
  // wait only advances ~0.3 game-seconds and the 0.3-unit threshold
  // flakes with host load (Block 14: measured 0.26 on a slow run).
  const t0 = await page.evaluate(() => window.__orbit.info().levelTime);
  const tPosA = await page.evaluate(() => window.__orbit.info().targetPositions);
  await page.waitForFunction(
    (start) => window.__orbit.info().levelTime - start >= 0.8,
    t0, { timeout: 30000 },
  );
  const tPosB = await page.evaluate(() => window.__orbit.info().targetPositions);
  const tMoved = Math.hypot(tPosB[0][0] - tPosA[0][0], tPosB[0][1] - tPosA[0][1]);
  if (tMoved < 0.5) throw new Error(`moving target did not move (moved ${tMoved.toFixed(2)} in 0.8 game-seconds)`);
  console.log(`render-check: level 12 Moving Stars target drifted ${tMoved.toFixed(2)} units in 0.8 game-seconds`);
  await playLevelToCompletion(page, 'moving stars');
  console.log('render-check: level 12 Moving Stars completes');

  // Block 11 (#45): the browser bot now plays EVERY campaign level to
  // completion. Levels 1, 7, 9, 10, 11 and 12 already completed above
  // (plus daily / seed / endless / Time Attack level 1); this sweep
  // closes the gaps — 2, 3, 4, 5, 6 and 8 — and asserts at least 1
  // star on each, so the full campaign is bot-verified in the live game.
  for (const id of [2, 3, 4, 5, 6, 8]) {
    await page.evaluate((i) => window.__orbit.selectLevel(i), id);
    await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
    await playLevelToCompletion(page, `campaign sweep level ${id}`);
    const sweep = await page.evaluate(() => ({
      phase: window.__orbit.state.phase,
      stars: window.__orbit.state.stars,
      shotsUsed: window.__orbit.state.shotsUsed,
      name: window.__orbit.state.levelName,
    }));
    if (sweep.phase !== 'complete') {
      throw new Error(`sweep level ${id} did not complete (phase=${sweep.phase})`);
    }
    if (sweep.stars < 1) throw new Error(`sweep level ${id} earned 0 stars`);
    console.log(`render-check: sweep level ${id} "${sweep.name}" complete in ${sweep.shotsUsed} shot(s) -> ${sweep.stars} star(s)`);
  }
  console.log('render-check: campaign sweep — all 12 levels now completed in the browser (1, 7, 9-12 above; 2-6, 8 here)');

  // Block 11 (#37): the pause menu's Restart Level and Quit to Menu
  // both work. Launch a shot, pause mid-flight, restart (fresh aim,
  // 0 shots used), pause again, quit (back to the menu).
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(Math.PI / 2, 1.0);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-restart');
  const restarted = await page.evaluate(() => ({
    phase: window.__orbit.state.phase,
    shotsUsed: window.__orbit.state.shotsUsed,
  }));
  if (restarted.phase !== 'aim' || restarted.shotsUsed !== 0) {
    throw new Error(`pause Restart should reset to aim with 0 shots, got: ${JSON.stringify(restarted)}`);
  }
  console.log('render-check: pause menu Restart Level resets the level (aim, 0 shots used)');
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__orbit.state.phase === 'menu', null, { timeout: 5000 });
  console.log('render-check: pause menu Quit to Menu returns to the menu');

  // Block 11 (#47): the physics NaN guard and the 1s state audit.
  // Corrupt the live flight mid-shot: the guard must end the shot
  // cleanly (phase back to aim, one shot spent, no page error) and the
  // game must stay playable. Then corrupt the level clock: only the
  // audit can catch it — it must restart the level within ~10s and
  // record a recovery.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(0, 0.6);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  const corrupted = await page.evaluate(() => window.__orbit.testCorrupt('flight'));
  if (!corrupted) throw new Error('testCorrupt(flight) found no live flight to corrupt');
  await page.waitForFunction(
    () => window.__orbit.state.phase === 'aim' || window.__orbit.state.phase === 'failed',
    null, { timeout: 20000 },
  );
  const afterCorrupt = await page.evaluate(() => ({
    phase: window.__orbit.state.phase,
    shotsUsed: window.__orbit.state.shotsUsed,
  }));
  if (afterCorrupt.shotsUsed < 1) {
    throw new Error(`corrupted flight should cost a shot, got: ${JSON.stringify(afterCorrupt)}`);
  }
  console.log(`render-check: corrupted flight ended cleanly as a lost shot (${afterCorrupt.phase}, ${afterCorrupt.shotsUsed} shot used)`);
  const auditBefore = await page.evaluate(() => window.__orbit.auditState());
  const timeCorrupted = await page.evaluate(() => window.__orbit.testCorrupt('time'));
  if (!timeCorrupted) throw new Error('testCorrupt(time) failed');
  await page.waitForFunction(
    (before) => window.__orbit.auditState().recoveries > before,
    auditBefore.recoveries, { polling: 100, timeout: 20000 },
  );
  const auditAfter = await page.evaluate(() => ({
    audit: window.__orbit.auditState(),
    phase: window.__orbit.state.phase,
    levelTime: window.__orbit.info().levelTime,
  }));
  if (auditAfter.phase !== 'aim') {
    throw new Error(`audit recovery should leave the level aiming, got phase=${auditAfter.phase}`);
  }
  if (!Number.isFinite(auditAfter.levelTime)) {
    throw new Error('audit recovery should leave a finite level clock');
  }
  console.log(`render-check: state audit caught the bad clock and restarted the level (${auditAfter.audit.failures} failure(s), ${auditAfter.audit.recoveries} recoverie(s), last: ${auditAfter.audit.lastFailure})`);

  // Block 4: a straight shot into Level 4's planet crashes with a
  // large-tier trauma (>= 0.7) and a real hit-stop that then restores.
  await page.evaluate(() => window.__orbit.selectLevel(4));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => {
    window.__orbit.aim(0, 1.0);
    window.__orbit.launch();
  });
  // Read trauma atomically with the hit-stop check: the crash's 0.12s
  // freeze decays trauma at 1.4/s, so a second round-trip after the
  // wait would read a decayed value on a slow headless frame.
  const crashHandle = await page.waitForFunction(
    () => {
      const s = window.__orbit.feedbackState();
      return s.hitStopActive ? s : null;
    },
    null, { polling: 20, timeout: 30000 },
  );
  const crashState = await crashHandle.jsonValue();
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
    null, { timeout: 30000 },
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
    null, { polling: 20, timeout: 30000 },
  );
  console.log('render-check: grazing Level 4 line credited a slingshot near-miss');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 30000 },
  );

  // Block 12 (#28/#29/#30): visual polish — nebula background, planet
  // atmosphere glow, fading comet trail ribbon, level-complete confetti.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const visual1 = await page.evaluate(() => window.__orbit.visualState());
  if (visual1.planetGlows !== 1) {
    throw new Error(`level 1 should have 1 planet glow halo, got ${visual1.planetGlows}`);
  }
  if (!(visual1.nebulaTime > 0)) {
    throw new Error(`nebula shader clock should be running, got ${visual1.nebulaTime}`);
  }
  console.log(`render-check: nebula background animating (t=${visual1.nebulaTime.toFixed(1)}s), ${visual1.planetGlows} planet glow halo on level 1`);
  const trailShot = await page.evaluate(() => window.__orbit.solveShot());
  if (!trailShot) throw new Error('solver found no collecting line for the trail test');
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
    window.__orbit.launch();
  }, trailShot);
  await page.waitForFunction(
    () => window.__orbit.visualState().trailPoints >= 5,
    null, { polling: 20, timeout: 30000 },
  );
  const trailState = await page.evaluate(() => window.__orbit.visualState());
  if (!trailState.trailRibbonVisible) {
    throw new Error('trail ribbon should be visible mid-flight');
  }
  console.log(`render-check: comet trail ribbon glowing mid-flight (${trailState.trailPoints} points)`);
  await page.waitForFunction(() => window.__orbit.state.phase === 'complete', null, { timeout: 30000 });
  const confetti = await page.evaluate(() => window.__orbit.visualState().confettiActive);
  if (confetti < 5) {
    throw new Error(`level complete should burst confetti, got ${confetti} active shards`);
  }
  console.log(`render-check: level complete burst ${confetti} confetti shards`);

  // Block 6: challenge modes — daily, seed links, endless.
  await quitToMenu(page);
  const menuAfter = await page.textContent('#menu');
  if (!menuAfter.includes('Daily Orbit — 2026-11-20')) {
    throw new Error('daily button missing after quit to menu');
  }

  // Daily: one level for everyone today; solve it through the hook and
  // complete it — the daily best is recorded in the save.
  await page.click('#btn-daily');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const dailyHud = await page.textContent('#hud-level');
  if (!dailyHud.includes('Daily — 2026-11-20')) throw new Error(`daily HUD wrong: ${dailyHud}`);
  const dailyInfo = await page.evaluate(() => window.__orbit.challengeInfo());
  if (dailyInfo.mode !== 'daily') throw new Error(`challenge mode should be daily, got ${dailyInfo.mode}`);
  if (dailyInfo.difficulty !== 2) throw new Error(`today's daily difficulty should be 2, got ${dailyInfo.difficulty}`);
  await playLevelToCompletion(page, 'daily');
  const dailyBest = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nor-stars') || '{}').daily);
  if (!dailyBest || dailyBest.date !== '2026-11-20' || dailyBest.stars < 1) {
    throw new Error(`daily best not recorded: ${JSON.stringify(dailyBest)}`);
  }
  console.log(`render-check: daily level complete, daily best ${dailyBest.stars} star(s) recorded`);
  await quitToMenu(page);
  const dailyLabel = await page.textContent('#btn-daily');
  if (!dailyLabel.includes('★')) throw new Error(`daily button should show earned stars, got: ${dailyLabel}`);
  console.log(`render-check: menu daily button shows the earned stars (${dailyLabel.trim()})`);

  // Seed link: ?seed=777 auto-starts the same generated level; completing
  // it records a per-seed best.
  await page.goto(`http://127.0.0.1:${port}/?seed=777`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const seedHud = await page.textContent('#hud-level');
  if (!seedHud.includes('Seed 777')) throw new Error(`seed HUD wrong: ${seedHud}`);
  const seedInputValue = await page.evaluate(() => document.getElementById('seed-input').value);
  if (seedInputValue !== '777') throw new Error(`seed input should be prefilled with 777, got: ${seedInputValue}`);
  await playLevelToCompletion(page, 'seed 777');
  const seedBest = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nor-stars') || '{}').seedBest);
  if (!seedBest || (seedBest['777'] || 0) < 1) {
    throw new Error(`seed best not recorded: ${JSON.stringify(seedBest)}`);
  }
  console.log(`render-check: ?seed=777 level complete, seed best ${seedBest['777']} star(s) recorded`);

  // Endless: round 1 completes, the Next button becomes "Next Round" and
  // advances to round 2 at a higher difficulty.
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  if (await page.isVisible('#howto')) await page.click('#btn-howto-close');
  await page.click('#btn-endless');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const endlessHud = await page.textContent('#hud-level');
  if (!endlessHud.includes('Endless Round 1')) throw new Error(`endless HUD wrong: ${endlessHud}`);
  await playLevelToCompletion(page, 'endless round 1');
  const nextLabel = await page.textContent('#btn-next');
  if (nextLabel.trim() !== 'Next Round →') throw new Error(`endless next button should say "Next Round →", got: ${nextLabel}`);
  await page.click('#btn-next');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const round2Hud = await page.textContent('#hud-level');
  if (!round2Hud.includes('Endless Round 2')) throw new Error(`round 2 HUD wrong: ${round2Hud}`);
  const round2Info = await page.evaluate(() => window.__orbit.challengeInfo());
  if (round2Info.round !== 2 || round2Info.difficulty !== 2) {
    throw new Error(`round 2 should be difficulty 2, got: ${JSON.stringify(round2Info)}`);
  }
  console.log('render-check: endless round 1 complete, Next Round advances to round 2 (difficulty 2)');

  // Block 10: Time Attack — one 4:00 clock across levels 1-5. Starting it
  // shows the HUD timer; completing level 1 banks stars and advances to
  // level 2 with the clock still running.
  await quitToMenu(page);
  await page.click('#btn-timeattack');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const taHud = await page.textContent('#hud-level');
  if (!taHud.includes('Time Attack 1/5')) throw new Error(`time attack HUD wrong: ${taHud}`);
  const taTimer = await page.evaluate(() => ({
    visible: !document.getElementById('hud-timer').classList.contains('hidden'),
    text: document.getElementById('hud-timer').textContent,
  }));
  if (!taTimer.visible || !taTimer.text.startsWith('⏱ 4:0')) {
    throw new Error(`time attack timer wrong: ${JSON.stringify(taTimer)}`);
  }
  const taInfo = await page.evaluate(() => window.__orbit.challengeInfo());
  if (taInfo.mode !== 'timeattack') throw new Error(`challenge mode should be timeattack, got ${taInfo.mode}`);
  if (!(taInfo.timeLeft > 0 && taInfo.timeLeft <= 240)) {
    throw new Error(`time attack clock should start at 240s, got ${taInfo.timeLeft}`);
  }
  console.log(`render-check: Time Attack started, HUD timer ${taTimer.text.trim()}, clock at ${taInfo.timeLeft.toFixed(1)}s`);
  await playLevelToCompletion(page, 'time attack level 1');
  const taNext = await page.textContent('#btn-next');
  if (taNext.trim() !== 'Next Level →') {
    throw new Error(`time attack next button should say "Next Level →", got: ${taNext}`);
  }
  await page.click('#btn-next');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const taHud2 = await page.textContent('#hud-level');
  if (!taHud2.includes('Time Attack 2/5')) throw new Error(`time attack level 2 HUD wrong: ${taHud2}`);
  const taInfo2 = await page.evaluate(() => window.__orbit.challengeInfo());
  if (taInfo2.timeAttackIndex !== 1 || taInfo2.timeAttackStars < 1) {
    throw new Error(`after level 1 the run should bank stars, got: ${JSON.stringify(taInfo2)}`);
  }
  if (taInfo2.timeLeft >= taInfo.timeLeft) {
    throw new Error('time attack clock should keep running across levels');
  }
  console.log(`render-check: Time Attack level 1 complete (${taInfo2.timeAttackStars} star(s) banked), advanced to 2/5 with ${taInfo2.timeLeft.toFixed(1)}s left`);

  // Block 8: touch, keyboard-only play, responsive + camera zoom.
  // Fresh load so the menu is untouched (Play focused, no shots spent).
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  if (await page.isVisible('#howto')) await page.click('#btn-howto-close');

  // Keyboard-only: Enter on the menu (nothing focused) starts the game,
  // arrow keys adjust the aim, Space launches.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  console.log('render-check: Enter on the menu starts the game (keyboard-only)');
  const angleBefore = await page.evaluate(() => window.__orbit.state.aimAngle);
  await page.keyboard.press('ArrowLeft');
  const angleAfter = await page.evaluate(() => window.__orbit.state.aimAngle);
  if (angleAfter <= angleBefore) {
    throw new Error(`ArrowLeft should increase the aim angle, ${angleBefore} -> ${angleAfter}`);
  }
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  console.log('render-check: ArrowLeft adjusts aim, Space launches (keyboard-only)');
  await page.waitForFunction(() => window.__orbit.state.shotsUsed >= 1, null, { timeout: 30000 });

  // P pauses; the pause overlay focuses Resume, and Enter resumes.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  const resumeFocused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (resumeFocused !== 'btn-resume') {
    throw new Error(`pause should focus Resume, got: ${resumeFocused}`);
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  console.log('render-check: P pauses with Resume focused, Enter resumes');

  // Escape closes My Stats back to the menu.
  await quitToMenu(page);
  await page.click('#btn-stats');
  await page.waitForFunction(() => !document.getElementById('stats').classList.contains('hidden'), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });
  console.log('render-check: Escape closes My Stats back to the menu');

  // Arrow keys on the menu move focus between the level buttons, wrapping
  // around the ends of the grid.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ArrowRight');
  const focusedLevel = await page.evaluate(() => document.activeElement && document.activeElement.className);
  if (!focusedLevel || !focusedLevel.includes('level-btn')) {
    throw new Error(`ArrowRight on the menu should focus a level button, got: ${focusedLevel}`);
  }
  await page.keyboard.press('ArrowLeft');
  const wrappedLevel = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  if (!wrappedLevel || !wrappedLevel.includes('Moving Stars')) {
    throw new Error(`ArrowLeft should wrap focus to the last level (Moving Stars), got: ${wrappedLevel}`);
  }
  console.log('render-check: menu arrow keys move focus between level buttons and wrap');

  // Camera zoom: wheel, HUD buttons, + / - keys, all clamped 0.6..2.0.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => window.__orbit.setZoom(1));
  const zoom0 = await page.evaluate(() => window.__orbit.zoom());
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -240);
  const zoomIn = await page.evaluate(() => window.__orbit.zoom());
  if (zoomIn <= zoom0) throw new Error(`wheel up should zoom in, ${zoom0} -> ${zoomIn}`);
  await page.mouse.wheel(0, 240);
  const zoomOut = await page.evaluate(() => window.__orbit.zoom());
  if (Math.abs(zoomOut - zoom0) > 0.001) {
    throw new Error(`wheel down should restore the zoom, got ${zoomOut} (was ${zoom0})`);
  }
  console.log(`render-check: mouse wheel zooms ${zoom0} -> ${zoomIn.toFixed(2)} -> ${zoomOut.toFixed(2)}`);
  await page.click('#btn-zoom-in');
  const zoomBtn = await page.evaluate(() => ({
    z: window.__orbit.zoom(),
    label: document.getElementById('zoom-label').textContent,
  }));
  if (Math.abs(zoomBtn.z - zoomOut * 1.25) > 0.001) {
    throw new Error(`zoom-in button should step 25%, got ${zoomBtn.z}`);
  }
  if (zoomBtn.label !== `${Math.round(zoomBtn.z * 100)}%`) {
    throw new Error(`zoom label should track the zoom, got ${zoomBtn.label}`);
  }
  await page.keyboard.press('+');
  const zoomKey = await page.evaluate(() => window.__orbit.zoom());
  if (zoomKey <= zoomBtn.z) throw new Error(`+ key should zoom in, ${zoomBtn.z} -> ${zoomKey}`);
  await page.evaluate(() => window.__orbit.setZoom(99));
  if ((await page.evaluate(() => window.__orbit.zoom())) !== 2) {
    throw new Error('zoom should clamp at 2.0');
  }
  await page.evaluate(() => window.__orbit.setZoom(0.01));
  if ((await page.evaluate(() => window.__orbit.zoom())) !== 0.6) {
    throw new Error('zoom should clamp at 0.6');
  }
  console.log('render-check: HUD zoom buttons, + / - keys, and 0.6..2.0 clamping all work');
  await page.evaluate(() => window.__orbit.setZoom(1));

  // Tap-to-launch: aim a collecting line through the hook, then a real
  // touchscreen tap launches with that aim — no drag needed.
  const tapShot = await page.evaluate(() => window.__orbit.solveShot());
  if (!tapShot) throw new Error('solver found no collecting line for the tap test');
  await page.evaluate((s) => window.__orbit.aim(s.angle, s.power), tapShot);
  await page.touchscreen.tap(640, 360);
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  console.log('render-check: touchscreen tap launches with the current aim');
  await page.waitForFunction(
    () => window.__orbit.state.shotsUsed >= 1 || window.__orbit.state.phase === 'complete',
    null, { timeout: 30000 },
  );

  // Pinch zoom: two pointers spreading apart zooms in, and lifting a
  // finger ends the pinch without launching a shot.
  await page.evaluate(() => window.__orbit.selectLevel(1));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  await page.evaluate(() => window.__orbit.setZoom(1));
  const pinch = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    const opts = (id, x, y) => ({
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1,
    });
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts(1, 400, 360)));
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts(2, 880, 360)));
    const before = window.__orbit.zoom();
    canvas.dispatchEvent(new PointerEvent('pointermove', opts(1, 300, 360)));
    canvas.dispatchEvent(new PointerEvent('pointermove', opts(2, 980, 360)));
    const after = window.__orbit.zoom();
    canvas.dispatchEvent(new PointerEvent('pointerup', opts(1, 300, 360)));
    canvas.dispatchEvent(new PointerEvent('pointerup', opts(2, 980, 360)));
    return { before, after, phase: window.__orbit.state.phase };
  });
  if (pinch.after <= pinch.before) {
    throw new Error(`pinch-out should zoom in, ${pinch.before} -> ${pinch.after}`);
  }
  if (pinch.phase !== 'aim') throw new Error(`pinch must not launch, phase is ${pinch.phase}`);
  console.log(`render-check: pinch-out zooms ${pinch.before} -> ${pinch.after.toFixed(2)} without launching`);

  // Small screens: a 390x844 phone viewport renders the menu with no
  // horizontal overflow, the level grid drops to 2 columns, and Enter
  // still starts the game with the zoom buttons visible.
  const small = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'Asia/Bangkok',
  });
  const smallPage = await small.newPage();
  smallPage.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('small console: ' + msg.text());
  });
  smallPage.on('pageerror', (err) => errors.push('small pageerror: ' + String(err)));
  if (!process.env.NO_THREE_CACHE) {
    const cachedSmall = await fetchThreeModule();
    await smallPage.route(THREE_URL, (route) => route.fulfill({ path: cachedSmall }));
  }
  await smallPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await smallPage.waitForFunction(() => window.__orbit, null, { timeout: 30000 });
  const overflow = await smallPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`small viewport has ${overflow}px of horizontal overflow`);
  const cols = await smallPage.evaluate(
    () => getComputedStyle(document.getElementById('level-select')).gridTemplateColumns.split(' ').length,
  );
  if (cols !== 2) throw new Error(`small viewport level grid should be 2 columns, got ${cols}`);
  if (await smallPage.isVisible('#howto')) await smallPage.click('#btn-howto-close');
  await smallPage.evaluate(() => document.activeElement && document.activeElement.blur());
  await smallPage.keyboard.press('Enter');
  await smallPage.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  if (!await smallPage.isVisible('#btn-zoom-in')) {
    throw new Error('zoom-in button not visible on the small viewport');
  }
  console.log('render-check: 390x844 viewport — no overflow, 2-column grid, Enter starts the game, zoom buttons visible');
  await small.close();

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
