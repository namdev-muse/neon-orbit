// Neon Orbit v2 — headless Chromium render check.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// asserts the rebuild's core, by eye and by hook:
//   - the menu renders over a LIVE 3D scene (no flat panel over darkness),
//     with no version/engine text anywhere the player can see, one clear
//     primary Play action, and no buttons for the dormant modes
//     (daily / endless / time attack / zen / seed) — no dead buttons
//   - the how-to shows on a first visit and closes back to the menu
//   - a real mouse drag aims (angle only — power is decoupled), the power
//     slider sets power, a plain tap does NOT launch, the Launch button
//     and Space do
//   - the preview is a short stub with NO verdict text anywhere in the DOM
//   - mid-flight thrust steers the comet (setThrust toward the nearest
//     target, the same pursuit the solver uses) and drains fuel; the
//     thrust plan completes level 1 in one shot
//   - the Skip button fast-forwards a flight
//   - the verified L4 graze line (24deg, power 0.55) collects a target
//     and credits a slingshot + slow-mo dip + gravity-assist bonus
//   - level 5's planet actually moves; pause focuses Resume; My Stats
//     lists 6 levels; Achievements lists 11; the save is schema v4
//     (Block 2: ship upgrades)
//   - ship upgrades (Block 2): both locked at 0 stars, Ion Thrusters
//     unlocks at 15 stars and equips on click, Big Tank stays locked
//     (needs 30), the equipped loadout flies live, one boost pad per level
//   - zero console errors and zero page errors, and a WebGL context exists
// Timeout note: the fullscreen nebula shader doubles the frame cost under
// swiftshader (in-level ~8fps, game time ~0.36x real time), so every
// game-time-bound wait in this file uses a 30s timeout — a 10s-max flight
// takes ~28s of real time there. On a real GPU the game runs at 60fps and
// these waits resolve in a few seconds; the longer timeouts only slow down
// a genuine failure, they never weaken an assertion.
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
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-orbit-render-check');
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

// Steer the live flight with thrust toward the nearest uncollected
// target — the same greedy pursuit the solver uses (cruise speed 9,
// burn only when the velocity error exceeds 1.0). Polls until the shot
// resolves (complete / aim / failed) and reports the phase plus the
// lowest fuel seen, so the caller can prove thrust actually burned.
async function steerFlight(page, { timeoutMs = 60000 } = {}) {
  // minFuel starts at the flight's own tank (Block 2: a Big Tank ship
  // starts at 130, so a fixed 100 baseline would cry wolf when the
  // flight burns less than 30 fuel).
  let minFuel = Infinity;
  let startFuel = null;
  const started = Date.now();
  for (;;) {
    const phase = await page.evaluate(() => window.__orbit.state.phase);
    if (phase !== 'fly') return { phase, minFuel, startFuel };
    if (Date.now() - started > timeoutMs) throw new Error(`flight did not resolve within ${timeoutMs}ms`);
    const fuel = await page.evaluate(() => {
      const o = window.__orbit;
      const f = o.flightState();
      if (!f) return 100;
      const info = o.info();
      const remaining = info.targetPositions
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => !o.state.collected.includes(i));
      if (!remaining.length) { o.setThrust(null); return f.fuel; }
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
      return f.fuel;
    });
    if (fuel < minFuel) minFuel = fuel;
    if (startFuel === null) startFuel = fuel;
    await page.waitForTimeout(200);
  }
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
  // The browser runs in the player's timezone (Asia/Bangkok).
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true, // touchscreen.tap drives the tap-must-not-launch test
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));

  // Fulfil the pinned Three.js module from the curl-downloaded cache when
  // the sandboxed browser cannot reach the CDN (see header note).
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
  if (version !== '2.1.0') throw new Error(`expected version 2.1.0, got ${version}`);
  console.log('render-check: game module initialised, version 2.1.0');

  // WebGL context exists and the canvas is on screen.
  const gl = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? { width: canvas.width, height: canvas.height } : null;
  });
  if (!gl) throw new Error('no WebGL context on the game canvas');
  console.log(`render-check: WebGL context live (${gl.width}x${gl.height} canvas)`);

  // The how-to shows on a first visit (fresh profile, empty save).
  if (await page.isVisible('#howto')) {
    console.log('render-check: how-to shows on first visit');
  } else {
    throw new Error('how-to should show on a first visit');
  }
  await page.click('#btn-howto-close');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });

  // The menu: title, one primary Play, campaign map, NO version/engine
  // text anywhere the player can see, and NO buttons for the dormant
  // modes — no dead buttons on screen.
  const menuText = await page.textContent('#menu');
  if (!menuText.includes('NEON ORBIT')) throw new Error('menu title missing');
  if (menuText.includes('v2.1.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
    throw new Error('menu shows version/engine text — it must live in the README only');
  }
  const bodyText = await page.textContent('body');
  if (bodyText.includes('Predicted:') || bodyText.includes('Predicted')) {
    throw new Error('oracle text "Predicted" found in the DOM — the oracle is dead in v2');
  }
  for (const id of ['#btn-daily', '#btn-endless', '#btn-timeattack', '#btn-zen', '#seed-input', '#btn-seed']) {
    if (await page.locator(id).count()) throw new Error(`dormant-mode control still in the menu: ${id}`);
  }
  const playClass = await page.getAttribute('#btn-play', 'class');
  if (!playClass || !playClass.includes('primary')) throw new Error('Play is not the primary action');
  const levelButtons = await page.locator('#level-select .level-btn').count();
  if (levelButtons !== 6) throw new Error(`expected 6 level buttons, got ${levelButtons}`);
  if (!menuText.includes('0/6 cleared')) throw new Error(`campaign progress should be 0/6 cleared, got: ${menuText.slice(0, 200)}`);
  if (!menuText.includes('0 / 18')) throw new Error('campaign stars should be 0 / 18 (6 levels)');
  console.log('render-check: menu renders — live 3D behind it, no version text, Play primary, 6 levels, 0/6 cleared, 0/18 stars, no dormant-mode buttons');

  // Menu screenshot for the by-eye check (inspected after the run).
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(1200); // let the menu pop-in finish + the attract comet orbit in
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu-1280x720.png') });
  console.log(`render-check: menu screenshot saved to ${SHOTS_DIR}/menu-1280x720.png — INSPECT BY EYE (live 3D scene, no clipped buttons)`);

  // PLAY starts level 1 with the HUD, the power control and the fuel bar.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  if (!await page.isVisible('#hud')) throw new Error('HUD not visible after PLAY');
  const hudLevel = await page.textContent('#hud-level');
  if (!hudLevel.includes('First Burn')) throw new Error(`expected level 1 First Burn, got: ${hudLevel}`);
  const hudPar = await page.textContent('#hud-par');
  if (!hudPar.includes('Par 1')) throw new Error(`HUD par should be Par 1, got: ${hudPar}`);
  if (await page.locator('#power-control').count() === 0) throw new Error('power control missing');
  if (!await page.isVisible('#power-control')) throw new Error('power control not visible while aiming');
  if (!await page.isVisible('#hud-fuel')) throw new Error('fuel bar not visible while aiming');
  // Block 2 (#3): level 1 has exactly one boost pad.
  const info1 = await page.evaluate(() => window.__orbit.info());
  if (info1.boostPads !== 1) throw new Error(`level 1 should have exactly 1 boost pad, got ${info1.boostPads}`);
  console.log('render-check: PLAY starts level 1 (First Burn), HUD + power control + fuel bar visible');

  // A plain tap must NOT launch (audit fix): tap on the pad, still aiming.
  const pad = await page.evaluate(() => window.__orbit.worldToScreen(-14, 0));
  await page.touchscreen.tap(pad.x, pad.y);
  await page.waitForTimeout(300);
  const afterTap = await page.evaluate(() => ({ phase: window.__orbit.state.phase, shots: window.__orbit.state.shotsUsed }));
  if (afterTap.phase !== 'aim' || afterTap.shots !== 0) {
    throw new Error(`tap launched the comet (phase=${afterTap.phase}, shots=${afterTap.shots}) — a tap must never launch`);
  }
  console.log('render-check: plain tap on the pad does NOT launch');

  // Real mouse drag-aim from the pad: the drag sets the ANGLE only.
  // Pull left ~150px, up ~10px: the slingshot angle is near-east.
  await page.mouse.move(pad.x, pad.y);
  await page.mouse.down();
  await page.mouse.move(pad.x - 150, pad.y - 10, { steps: 12 });
  const midDrag = await page.evaluate(() => ({
    angle: window.__orbit.state.aimAngle,
    power: window.__orbit.state.aimPower,
    readout: document.getElementById('aim-readout').textContent,
    powerLabel: document.getElementById('power-label').textContent,
  }));
  if (Math.abs(midDrag.angle) > 0.6) throw new Error(`drag angle wrong: ${midDrag.angle} rad (expected near-east)`);
  if (Math.abs(midDrag.power - 0.6) > 0.01) throw new Error(`drag changed the power to ${midDrag.power} — aim and power are decoupled in v2`);
  if (midDrag.readout.includes('Predicted')) throw new Error(`aim readout shows a prediction: ${midDrag.readout}`);
  if (!midDrag.powerLabel.startsWith('Power 60%')) throw new Error(`power label wrong mid-drag: ${midDrag.powerLabel}`);
  console.log(`render-check: real drag aims ${(midDrag.angle * 180 / Math.PI).toFixed(1)}deg, power stays 60% (decoupled), no prediction text`);

  // The power slider is the adjustable control: set it, the power follows.
  await page.evaluate(() => {
    const range = document.getElementById('power-range');
    range.value = '95';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterSlider = await page.evaluate(() => ({
    power: window.__orbit.state.aimPower,
    label: document.getElementById('power-label').textContent,
  }));
  if (Math.abs(afterSlider.power - 0.95) > 0.01 || !afterSlider.label.includes('95%')) {
    throw new Error(`power slider did not set 95%: ${JSON.stringify(afterSlider)}`);
  }
  console.log('render-check: power slider sets 95% live');

  // Launch with the thrust plan's first shot (aim set through the hook,
  // released through the real mouse button), then fly it with thrust.
  const plan = await page.evaluate(() => window.__orbit.solveThrust());
  if (!plan || !plan.lines || !plan.lines.length) throw new Error('thrust solver found no plan for level 1');
  const line = plan.lines[0];
  await page.evaluate((s) => {
    window.__orbit.aim(s.angle, s.power);
  }, line);
  await page.mouse.up();
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  const shotsUsed = await page.evaluate(() => window.__orbit.state.shotsUsed);
  if (shotsUsed !== 1) throw new Error(`launch should use exactly 1 shot, got ${shotsUsed}`);
  if (!await page.isVisible('#btn-skip')) throw new Error('Skip button not visible mid-flight');
  console.log(`render-check: drag-release launches the thrust plan's shot (${(line.angle * 180 / Math.PI).toFixed(1)}deg, p=${line.power.toFixed(2)}), Skip button visible`);

  // Skip fast-forwards the flight (Space does the same on keyboard).
  await page.click('#btn-skip');
  const ff = await page.evaluate(() => window.__orbit.thrustState().fastForward);
  if (!ff) throw new Error('Skip button did not enable fast-forward');
  console.log('render-check: Skip enables fast-forward mid-flight');

  // Steer with thrust until the shot resolves; fuel must drain and the
  // level must complete (the plan collects both targets in one shot).
  const flight = await steerFlight(page);
  if (flight.minFuel >= flight.startFuel) throw new Error('thrust never burned fuel — steering did not happen');
  if (flight.phase !== 'complete') throw new Error(`level 1 did not complete (phase=${flight.phase})`);
  const completeStars = await page.textContent('#complete-stars');
  if (!completeStars.includes('★')) throw new Error(`complete screen shows no stars: ${completeStars}`);
  console.log(`render-check: thrust steers the comet (fuel burned to ${flight.minFuel.toFixed(0)}), level 1 completes in one shot, stars: ${completeStars.trim()}`);

  // Next advances to level 2.
  await page.click('#btn-next');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const hud2 = await page.textContent('#hud-level');
  if (!hud2.includes('Slingshot Turn')) throw new Error(`expected level 2 Slingshot Turn, got: ${hud2}`);
  // Block 2 (#3): level 2 has exactly one boost pad too.
  const info2 = await page.evaluate(() => window.__orbit.info());
  if (info2.boostPads !== 1) throw new Error(`level 2 should have exactly 1 boost pad, got ${info2.boostPads}`);
  console.log('render-check: Next advances to level 2 (Slingshot Turn)');

  // The verified L4 graze line (24deg, power 0.55) collects a target and
  // credits a slingshot near-miss, a slow-mo dip and a +100 assist bonus.
  // This shot flies BALLISTICALLY — no thrust steering — because the
  // graze is a property of the line itself; steering would pull the
  // comet off the near-miss path.
  await page.evaluate(() => {
    window.__orbit.unlockAll(); // level 4 is locked until levels 1-3 clear
    window.__orbit.selectLevel(4);
    window.__orbit.aim((24 * Math.PI) / 180, 0.55);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  // Block 2 (#3): level 4 has exactly one boost pad.
  const info4 = await page.evaluate(() => window.__orbit.info());
  if (info4.boostPads !== 1) throw new Error(`level 4 should have exactly 1 boost pad, got ${info4.boostPads}`);
  // launch() resets the per-shot slingshot / slow-mo ledgers, so the
  // baseline is read AFTER the launch, not before it.
  const before = await page.evaluate(() => ({
    slingshots: window.__orbit.feedbackState().slingshotCount,
    slowMo: window.__orbit.feedbackState().slowMoCount,
  }));
  await page.waitForFunction(
    () => ['aim', 'complete', 'failed'].includes(window.__orbit.state.phase),
    null, { timeout: 60000 },
  );
  const grazePhase = await page.evaluate(() => window.__orbit.state.phase);
  if (grazePhase !== 'aim' && grazePhase !== 'complete') throw new Error(`L4 graze shot ended in phase ${grazePhase}`);
  const after = await page.evaluate(() => ({
    collected: window.__orbit.state.collected.length,
    slingshots: window.__orbit.feedbackState().slingshotCount,
    slowMo: window.__orbit.feedbackState().slowMoCount,
    assist: window.__orbit.state.assistBonus,
  }));
  if (after.collected < 1) throw new Error('L4 graze line collected nothing');
  if (after.slingshots <= before.slingshots) throw new Error('L4 graze line credited no slingshot near-miss');
  if (after.slowMo <= before.slowMo) throw new Error('slingshot did not trigger a near-miss slow-mo dip');
  if (after.assist < 100) throw new Error(`slingshot should bank a +100 assist bonus, got ${after.assist}`);
  console.log(`render-check: L4 graze line collects ${after.collected} target(s), slingshot + slow-mo + +${after.assist} assist`);

  // Level 5's planet actually moves over time (moving-planet level).
  await page.evaluate(() => window.__orbit.selectLevel(5));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  // Block 2 (#3): levels 3, 5 and 6 each have exactly one boost pad.
  for (const id of [3, 5, 6]) {
    const pads = await page.evaluate((levelId) => {
      window.__orbit.selectLevel(levelId);
      return window.__orbit.info().boostPads;
    }, id);
    if (pads !== 1) throw new Error(`level ${id} should have exactly 1 boost pad, got ${pads}`);
  }
  await page.evaluate(() => window.__orbit.selectLevel(5));
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  const posA = await page.evaluate(() => window.__orbit.info().planetPositions[0]);
  await page.waitForTimeout(3000);
  const posB = await page.evaluate(() => window.__orbit.info().planetPositions[0]);
  if (Math.hypot(posB[0] - posA[0], posB[1] - posA[1]) < 0.1) {
    throw new Error(`level 5 planet did not move: ${JSON.stringify(posA)} -> ${JSON.stringify(posB)}`);
  }
  console.log('render-check: level 5 moving planet travels its orbit');

  // Pause focuses Resume; Enter resumes.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'btn-resume') throw new Error(`pause should focus Resume, focused: ${focused}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__orbit.state.phase === 'aim', null, { timeout: 5000 });
  console.log('render-check: P pauses with Resume focused, Enter resumes');

  // Back to the menu: My Stats lists 6 levels, Achievements lists 11.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__orbit.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__orbit.state.phase === 'menu', null, { timeout: 5000 });
  await page.click('#btn-stats');
  await page.waitForFunction(() => !document.getElementById('stats').classList.contains('hidden'), null, { timeout: 5000 });
  const statsText = await page.textContent('#stats');
  if (!statsText.includes('Level 1') || !statsText.includes('/ 18')) {
    throw new Error(`My Stats should list 6 levels with / 18 stars: ${statsText.slice(0, 200)}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });
  console.log('render-check: My Stats lists 6 levels, / 18 stars, Escape closes it');
  await page.click('#btn-achievements');
  await page.waitForFunction(() => !document.getElementById('achievements').classList.contains('hidden'), null, { timeout: 5000 });
  const achCount = await page.locator('#achievements-grid .achievement-row').count();
  if (achCount !== 11) throw new Error(`expected 11 achievements, got ${achCount}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden'), null, { timeout: 5000 });
  console.log('render-check: Achievements overlay lists 11 achievements, Escape closes it');

  // Block 2 (#1-3): ship upgrades + the equipped loadout flying live.
  // This runs last on purpose: grantStars changes which level Play
  // continues from (the first uncompleted level), so the upgrade flow
  // is verified after the base-ship flight tests above, not before.
  // Two upgrade buttons in Level Select, both locked at the 3 stars
  // earned so far, each showing its star requirement. Ion Thrusters
  // unlocks at 15 stars (reachable now: 6 levels x 3 stars); Big Tank
  // needs 30 stars, which the 6-level campaign cannot reach yet — it
  // unlocks when levels 7-12 land in Block 6, so here it must stay
  // locked with its requirement showing.
  const upgradeButtons = await page.locator('#upgrades-list .upgrade-btn').count();
  if (upgradeButtons !== 2) throw new Error(`expected 2 ship upgrade buttons, got ${upgradeButtons}`);
  const upgradeText = await page.textContent('#upgrades-list');
  if (!upgradeText.includes('Ion Thrusters') || !upgradeText.includes('Big Tank')) {
    throw new Error(`upgrade list should name both upgrades: ${upgradeText}`);
  }
  if (!upgradeText.includes('15') || !upgradeText.includes('30')) {
    throw new Error(`upgrade list should show the 15 / 30 star requirements: ${upgradeText}`);
  }
  const lockedBoth = await page.evaluate(() => window.__orbit.upgrades().every((u) => !u.unlocked && !u.equipped));
  if (!lockedBoth) throw new Error('both upgrades should start locked at the stars earned so far');
  const granted15 = await page.evaluate(() => window.__orbit.grantStars(15));
  if (granted15 !== 15) throw new Error(`grantStars(15) should return 15, got ${granted15}`);
  const after15 = await page.evaluate(() => window.__orbit.upgrades());
  if (!after15[0].unlocked || after15[1].unlocked) {
    throw new Error(`at 15 stars Ion Thrusters should unlock and Big Tank stay locked: ${JSON.stringify(after15)}`);
  }
  const tankRefused = await page.evaluate(() => window.__orbit.setUpgrade('tank', true));
  if (tankRefused) throw new Error('setUpgrade must refuse a locked upgrade');
  await page.locator('#upgrades-list .upgrade-btn').nth(0).click();
  const thrustEquipped = await page.evaluate(() => window.__orbit.upgrades()[0]);
  if (!thrustEquipped.equipped) throw new Error('clicking Ion Thrusters should equip it');
  const thrustBtnClass = await page.locator('#upgrades-list .upgrade-btn').nth(0).getAttribute('class');
  if (!thrustBtnClass || !thrustBtnClass.includes('equipped')) throw new Error('equipped upgrade button should carry the equipped class');
  const tankBtnDisabled = await page.locator('#upgrades-list .upgrade-btn').nth(1).isDisabled();
  if (!tankBtnDisabled) throw new Error('Big Tank button should stay disabled at 15 stars (needs 30)');
  console.log('render-check: ship upgrades — 2 buttons, both locked at first; at 15 stars Ion Thrusters unlocks and equips on click, Big Tank stays locked (needs 30)');
  // The equipped loadout flies: replay level 1, launch, and read the
  // live flight — Ion Thrusters burns at 18.75 (15 x 1.25) on the base
  // 100 tank (Big Tank still locked). The HUD chip names it too.
  await page.evaluate(() => {
    window.__orbit.selectLevel(1);
    window.__orbit.aim(Math.PI * 0.3, 0.95);
    window.__orbit.launch();
  });
  await page.waitForFunction(() => window.__orbit.state.phase === 'fly', null, { timeout: 5000 });
  if (!await page.isVisible('#hud-upgrades')) throw new Error('equipped-upgrades HUD chip not visible while aiming/flying');
  const hudUpgrades = await page.textContent('#hud-upgrades');
  if (!hudUpgrades.includes('Ion Thrusters')) throw new Error(`HUD chip should name Ion Thrusters: ${hudUpgrades}`);
  const liveLoadout = await page.evaluate(() => window.__orbit.flightState());
  if (!liveLoadout || Math.abs(liveLoadout.thrustAccel - 18.75) > 0.01 || liveLoadout.fuelMax !== 100) {
    throw new Error(`equipped Ion Thrusters should fly at 18.75 accel / 100 tank, got ${JSON.stringify(liveLoadout)}`);
  }
  console.log('render-check: equipped Ion Thrusters fly live (thrust accel 18.75, tank 100), HUD chip names it');

  // The save on disk is the v2 schema (version 4 — Block 2 upgrades).
  const saveVersion = await page.evaluate(() => {
    const raw = window.localStorage.getItem('nor2-stars');
    return raw ? JSON.parse(raw).version : null;
  });
  if (saveVersion !== 4) throw new Error(`save schema should be version 4, got ${saveVersion}`);
  console.log('render-check: save is schema version 4');

  if (errors.length) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log('render-check: PASS — menu, aim, thrust flight, graze, modes dormant, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
