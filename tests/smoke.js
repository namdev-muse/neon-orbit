// Neon Orbit — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, LEVELS, MAX_SPEED, PLAYFIELD_RADIUS, SUBSTEP, levelById, shotBudget,
  starsForShots, starThresholds, isLevelComplete, mulberry32, generateDecor,
  launchState, stepFlight, simulateLaunch, previewShot, planetPosAt, targetPosAt,
  levelHasMovingPlanets, levelHasMovingTargets, levelMovingTargets, levelBlackHoles, levelPortals, levelBouncePads,
  targetHits, FEEDBACK, FEEDBACK_TIERS,
  NEAR_MISS_BAND, isNearMiss, COMET_RADIUS,
  defaultSave, serializeSave, parseSave, totalStars,
  SAVE_VERSION, defaultStats, ACHIEVEMENTS, checkAchievements,
  dateSeed, dateKey, seedFromString, parseSeedParam, dailyDifficulty,
  endlessDifficulty, generateLevel, registerGeneratedLevel, solveShot, solveLevel,
  TIME_ATTACK_LEVEL_IDS, TIME_ATTACK_SECONDS, formatClock,
  clampZoom, ZOOM_MIN, ZOOM_MAX, isTapGesture, TAP_MAX_MS, TAP_MAX_PX, focusStep,
  createPerfGuard, PERF_LEVELS, PERF_SLOW_MS, PERF_FAST_MS,
  slowMoScale, SLOW_MO_SCALE, SLOW_MO_MS, zenLevel, ZEN_ID,
  MUSIC_STYLES, musicStyleById, nextMusicStyleId,
  flashAllowed, FLASH_MIN_INTERVAL_MS,
  GRAVITY_ASSIST_POINTS, gravityAssistPoints,
  ORB_POINTS, ORB_RADIUS, levelOrbs, orbPoints, orbRadius,
  FUEL_MAX, FUEL_BURN_RATE, THRUST_ACCEL, FUEL_ORB_REFILL, THRUST_CRUISE_SPEED,
  fuelCost, canThrust, thrustPolicyFor, solveShotThrust, solveLevelThrust, solveShotThrustTop,
  UPGRADES, upgradeById, upgradeUnlocked, loadoutMultipliers, activeLoadout,
  THRUST_UPGRADE_MULT, TANK_UPGRADE_MULT,
  levelBoostPads, boostPadRadius, BOOST_PAD_REFILL, BOOST_PAD_KICK, BOOST_PAD_RADIUS,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// --- level definitions ---
check('6 dense levels defined', LEVELS.length === 6);
check('level ids are 1..6 in order', LEVELS.every((l, i) => l.id === i + 1));
check('every level has a name', LEVELS.every((l) => typeof l.name === 'string' && l.name.length > 0));
check('every level has a hint', LEVELS.every((l) => typeof l.hint === 'string' && l.hint.length > 0));
check('every level has a pad inside the playfield',
  LEVELS.every((l) => l.pad.x * l.pad.x + l.pad.y * l.pad.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS));
check('every level has >= 1 planet', LEVELS.every((l) => l.planets.length >= 1));
check('every level has >= 1 target', LEVELS.every((l) => l.targets.length >= 1));
check('every planet has positive radius and gravity',
  LEVELS.every((l) => l.planets.every((p) => p.r > 0 && p.mu > 0)));
check('every planet is inside the playfield',
  LEVELS.every((l) => l.planets.every((p) => p.x * p.x + p.y * p.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)));
check('every target is inside the playfield',
  LEVELS.every((l) => l.targets.every((t) => t.x * t.x + t.y * t.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)));
check('no target overlaps a planet',
  LEVELS.every((l) => l.targets.every((t) => l.planets.every((p) => {
    const dx = t.x - p.x, dy = t.y - p.y;
    return dx * dx + dy * dy > (p.r + t.r + 0.5) * (p.r + t.r + 0.5);
  }))));
check('no planet overlaps the pad',
  LEVELS.every((l) => l.planets.every((p) => {
    const dx = p.x - l.pad.x, dy = p.y - l.pad.y;
    return dx * dx + dy * dy > (p.r + 2) * (p.r + 2);
  })));
check('every black hole has positive radius and gravity',
  LEVELS.every((l) => levelBlackHoles(l).every((b) => b.r > 0 && b.mu > 0)));
check('every black hole is inside the playfield',
  LEVELS.every((l) => levelBlackHoles(l).every((b) => b.x * b.x + b.y * b.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)));
check('every portal is inside the playfield',
  LEVELS.every((l) => levelPortals(l).every((p) => p.x * p.x + p.y * p.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)));
check('every portal has a twin with the same pair index',
  LEVELS.every((l) => levelPortals(l).every((p) =>
    levelPortals(l).some((q) => q !== p && (q.pair ?? 0) === (p.pair ?? 0)))));
check('every bounce pad is inside the playfield',
  LEVELS.every((l) => levelBouncePads(l).every((p) => p.x * p.x + p.y * p.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)));
check('no target overlaps a portal or a bounce pad',
  LEVELS.every((l) => l.targets.every((t) =>
    levelPortals(l).every((p) => Math.hypot(t.x - p.x, t.y - p.y) > p.r + t.r + 0.5)
    && levelBouncePads(l).every((p) => Math.hypot(t.x - p.x, t.y - p.y) > p.r + t.r + 0.5))));
check('no portal overlaps a planet or a bounce pad',
  LEVELS.every((l) => levelPortals(l).every((p) =>
    l.planets.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > p.r + q.r + 0.5)
    && levelBouncePads(l).every((b) => Math.hypot(p.x - b.x, p.y - b.y) > p.r + b.r + 0.5))));
check('shielded targets declare hits: 2, unshielded default to 1',
  LEVELS.every((l) => l.targets.every((t) => targetHits(t) === 1 || targetHits(t) === 2))
  && targetHits({ x: 0, y: 0, r: 1 }) === 1
  && targetHits({ x: 0, y: 0, r: 1, hits: 2 }) === 2);
check('no target overlaps a black hole',
  LEVELS.every((l) => l.targets.every((t) => levelBlackHoles(l).every((b) => {
    const dx = t.x - b.x, dy = t.y - b.y;
    return dx * dx + dy * dy > (b.r + t.r + 1) * (b.r + t.r + 1);
  }))));
check('moving targets never sweep over a planet or the pad',
  LEVELS.every((l) => levelMovingTargets(l).every((t) => {
    const o = t.orbit;
    const clear = (x, y, extra) => {
      const d = Math.hypot(x - o.cx, y - o.cy);
      return Math.abs(d - o.radius) > t.r + extra + 0.5;
    };
    return l.planets.every((p) => clear(p.x, p.y, p.r))
      && clear(l.pad.x, l.pad.y, 1.5)
      // A moving target's whole orbit stays inside the playfield.
      && Math.hypot(o.cx, o.cy) + o.radius + t.r < PLAYFIELD_RADIUS;
  })));
check('moving planets never sweep over a target or the pad',
  LEVELS.every((l) => l.planets.every((p) => {
    if (!p.orbit) return true;
    const clear = (x, y, extra) => {
      const d = Math.hypot(x - p.orbit.cx, y - p.orbit.cy);
      return Math.abs(d - p.orbit.radius) > p.r + extra + 0.5;
    };
    return l.targets.every((t) => clear(t.x, t.y, t.r))
      && clear(l.pad.x, l.pad.y, 1.5);
  })));
// v2 level identity: every level has its own theme (disc colour +
// nebula tint) and its own mechanic — no two levels look or play alike
// (audit fix: levels 1-3 used to be identical).
check('every level has a distinct theme', LEVELS.every((l) => l.theme
  && typeof l.theme.disc === 'string' && typeof l.theme.tint === 'string')
  && new Set(LEVELS.map((l) => l.theme.disc)).size === LEVELS.length);
check('every level has >= 2 planets', LEVELS.every((l) => l.planets.length >= 2));
check('every level has >= 2 targets', LEVELS.every((l) => l.targets.length >= 2));
check('level 1 has two targets in different lob zones', LEVELS[0].targets.length === 2);
check('level 4 has a black hole', levelBlackHoles(LEVELS[3]).length === 1);
check('level 5 has a moving planet', levelHasMovingPlanets(LEVELS[4]));
check('level 6 has one portal pair', levelPortals(LEVELS[5]).length === 2
  && (LEVELS[5].portals[0].pair ?? 0) === (LEVELS[5].portals[1].pair ?? 0));
check('level 6 has a black hole and one shielded target',
  levelBlackHoles(LEVELS[5]).length === 1
  && LEVELS[5].targets.some((t) => targetHits(t) === 2));
check('level 6 has four targets', LEVELS[5].targets.length === 4);
check('levels 1-3 have no black holes, portals or shielded targets',
  LEVELS.slice(0, 3).every((l) => levelBlackHoles(l).length === 0
    && levelPortals(l).length === 0
    && l.targets.every((t) => targetHits(t) === 1)));
check('levels 1-4 have no moving planets',
  LEVELS.slice(0, 4).every((l) => !levelHasMovingPlanets(l)));
check('levelById finds level 4', levelById(4) && levelById(4).name === 'Event Horizon');
check('levelById returns null for unknown id', levelById(99) === null);
check('shot budget is par + 2', LEVELS.every((l) => shotBudget(l) === l.par + 2));

// --- star thresholds ---
check('par shots = 3 stars', starsForShots(2, 2) === 3);
check('fewer than par = 3 stars', starsForShots(1, 3) === 3);
check('par+1 = 2 stars', starsForShots(4, 3) === 2);
check('par+2 = 1 star', starsForShots(5, 3) === 1);
check('over budget = 0 stars', starsForShots(6, 3) === 0);
check('star thresholds match the star rule for every level',
  LEVELS.every((l) => {
    const t = starThresholds(l.par);
    return t.three === l.par && t.two === l.par + 1 && t.one === l.par + 2
      && starsForShots(t.three, l.par) === 3
      && starsForShots(t.two, l.par) === 2
      && starsForShots(t.one, l.par) === 1;
  }));
check('star thresholds for par 2 are 2/3/4',
  JSON.stringify(starThresholds(2)) === JSON.stringify({ three: 2, two: 3, one: 4 }));
check('level complete when all targets collected',
  isLevelComplete(LEVELS[2], [0, 1, 2]) === true);
check('level not complete with targets left',
  isLevelComplete(LEVELS[2], [0]) === false);

// --- trajectory preview (v2: a short stub, no oracle) ---
{
  check('physics version is 2.1.0', VERSION === '2.1.0');
  const lvl = LEVELS[0];
  const hit = previewShot(lvl, 0, 0.55);
  // Audit fix: the default aim must NOT collect anything — a plain
  // click on the pad never solves a level in v2. The stub shows the
  // first second of flight and ends without a verdict.
  check('preview of the level 1 default aim collects nothing',
    hit.collected.length === 0);
  check('preview records trajectory points starting at the pad',
    hit.points.length > 10 && hit.points[0][0] === lvl.pad.x && hit.points[0][1] === lvl.pad.y);
  const crashLevel = { pad: { x: -10, y: 0 }, planets: [{ x: 0, y: 0, r: 2, mu: 10 }], targets: [] };
  const crash = previewShot(crashLevel, 0, 0.5);
  check('preview of a head-on shot predicts a crash', crash.outcome === 'crash');
  check('preview crash end sits on the planet surface',
    Math.hypot(crash.end.x, crash.end.y) < 2.6);
  const away = previewShot(lvl, Math.PI, 0.8);
  check('preview of a shot aimed away predicts it flies out', away.outcome === 'lost');
  const p1 = previewShot(LEVELS[5], 0.7, 0.8);
  const p2 = previewShot(LEVELS[5], 0.7, 0.8);
  check('preview is deterministic', JSON.stringify(p1.points) === JSON.stringify(p2.points));
  check('preview respects already-collected targets',
    previewShot(lvl, 0, 0.55, [0]).collected.length === 0);
}

// --- seeded determinism ---
{
  const a = mulberry32(42), b = mulberry32(42);
  check('same seed gives same sequence', a() === b() && a() === b());
  const c = mulberry32(7);
  check('different seed gives different sequence', c() !== mulberry32(42)());
  const d1 = generateDecor(123, 50, 26), d2 = generateDecor(123, 50, 26);
  check('same seed gives same decor layout', JSON.stringify(d1) === JSON.stringify(d2));
  check('different seed gives different decor layout',
    JSON.stringify(generateDecor(123, 50, 26)) !== JSON.stringify(generateDecor(124, 50, 26)));
  check('decor points stay inside radius',
    d1.every((p) => p.x * p.x + p.y * p.y <= 26 * 26));
}

// --- straight flight with no gravity ---
{
  const flat = { pad: { x: 0, y: 0 }, planets: [], targets: [{ x: 10, y: 0, r: 1.6 }] };
  const res = simulateLaunch(flat, 0, 0.5);
  check('straight shot reaches its target', res.outcome === 'collected');
  check('straight shot stays on the x axis',
    res.points.every((p) => Math.abs(p[1]) < 1e-6));
  check('straight shot speed matches power',
    approx(launchState(flat, 0, 0.5).vx, MAX_SPEED * 0.5));
  const miss = simulateLaunch(flat, Math.PI / 2, 0.5);
  check('shot aimed away misses and is lost', miss.outcome === 'lost');
  check('lost shot collects nothing', miss.collected.length === 0);
  const far = { pad: { x: 0, y: 0 }, planets: [], targets: [{ x: 5, y: 20, r: 1 }] };
  const weak = simulateLaunch(far, 0, 0.05);
  check('very weak shot times out instead of flying forever',
    weak.outcome === 'timeout' || weak.outcome === 'lost');
}

// --- gravity bends the trajectory ---
{
  const lvl = LEVELS[1]; // Curveball: planet at origin
  const bent = simulateLaunch(lvl, 0.35, 0.7);
  const flat = { pad: lvl.pad, planets: [], targets: lvl.targets };
  const straight = simulateLaunch(flat, 0.35, 0.7);
  const bend = Math.abs(bent.end.y - straight.end.y);
  check('gravity bends the trajectory away from the straight line', bend > 0.5);
  // A comet passing near a planet must curve toward it.
  const near = { pad: { x: -10, y: 3 }, planets: [{ x: 0, y: 0, r: 2, mu: 200 }], targets: [] };
  const s = launchState(near, 0, 0.6);
  const col = [];
  for (let i = 0; i < 120; i++) stepFlight(s, near, SUBSTEP, [], col);
  check('gravity pulls the comet toward the planet (y decreases toward 0)',
    s.y < 3 && s.y > -1);
}

// --- planet collision = crash ---
{
  const lvl = { pad: { x: -10, y: 0 }, planets: [{ x: 0, y: 0, r: 2, mu: 10 }], targets: [] };
  const res = simulateLaunch(lvl, 0, 0.5);
  check('flying straight into a planet crashes', res.outcome === 'crash');
  const grazed = simulateLaunch(lvl, 0.35, 0.5);
  check('a shot that clears the planet does not crash', grazed.outcome !== 'crash');
}

// --- reaching a target = collect ---
{
  const lvl = LEVELS[0];
  // The thrust plan's shot, flown with the thrust policy, collects both
  // targets — flying is the skill, not just aiming.
  const plan = solveLevelThrust(lvl, 1);
  const res = simulateLaunch(lvl, plan.lines[0].angle, plan.lines[0].power, [],
    { record: false, thrustPolicy: thrustPolicyFor(lvl, []) });
  check('level 1 thrust-flown shot collects both targets',
    res.collected.length === 2 && res.outcome === 'collected');
  const already = simulateLaunch(lvl, plan.lines[0].angle, plan.lines[0].power, [0, 1],
    { record: false, thrustPolicy: thrustPolicyFor(lvl, [0, 1]) });
  check('already-collected targets are not collected again', already.collected.length === 0);
}

// --- out of bounds = lost ---
{
  const lvl = { pad: { x: 0, y: 0 }, planets: [], targets: [{ x: 5, y: 20, r: 1 }] };
  const res = simulateLaunch(lvl, Math.PI, 1.0);
  check('flying out of the playfield is a lost shot', res.outcome === 'lost');
}

// --- fixed-step determinism ---
{
  const lvl = LEVELS[5];
  const r1 = simulateLaunch(lvl, 0.7, 0.8);
  const r2 = simulateLaunch(lvl, 0.7, 0.8);
  check('same launch is deterministic', JSON.stringify(r1.points) === JSON.stringify(r2.points));
  check('simulation records trajectory points', r1.points.length > 10);
  check('simulation time stays within the cap', r1.time <= 10.001);
}

// --- black holes + moving planets ---
{
  // planetPosAt: static planets stay put, orbiting planets travel the circle.
  const still = { x: 3, y: 4, r: 2, mu: 100 };
  check('static planet position does not depend on time',
    planetPosAt(still, 0).x === 3 && planetPosAt(still, 9.5).y === 4);
  const mover = { x: 7, y: 0, r: 2, mu: 150, orbit: { cx: 0, cy: 0, radius: 7, speed: 0.45, phase: 0 } };
  const p0 = planetPosAt(mover, 0);
  const p1 = planetPosAt(mover, 1);
  check('orbiting planet starts at its phase position', approx(p0.x, 7) && approx(p0.y, 0));
  check('orbiting planet moves with time', Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.5);
  check('orbiting planet stays on its orbit circle',
    approx(Math.hypot(p1.x, p1.y), 7, 1e-6));
  check('orbiting planet position is deterministic for the same t',
    JSON.stringify(planetPosAt(mover, 3.7)) === JSON.stringify(planetPosAt(mover, 3.7)));
  check('orbiting planet returns after one full period',
    Math.hypot(planetPosAt(mover, 2 * Math.PI / 0.45).x - 7, planetPosAt(mover, 2 * Math.PI / 0.45).y) < 1e-6);

  // Black hole gravity bends the flight toward the hole, harder than a planet.
  const hole = { pad: { x: -10, y: 3 }, planets: [], blackHoles: [{ x: 0, y: 0, r: 1.6, mu: 300 }], targets: [] };
  const s = launchState(hole, 0, 0.6);
  const col = [];
  for (let i = 0; i < 120; i++) stepFlight(s, hole, SUBSTEP, [], col);
  check('black hole gravity pulls the comet toward the hole (y decreases toward 0)',
    s.y < 3 && s.y > -1);
  // A straight shot into the hole is swallowed, not a planet crash.
  const into = { pad: { x: -10, y: 0 }, planets: [], blackHoles: [{ x: 0, y: 0, r: 1.6, mu: 10 }], targets: [] };
  const swallowed = simulateLaunch(into, 0, 0.5);
  check('flying straight into a black hole is swallowed', swallowed.outcome === 'swallowed');
  check('swallowed shot ends near the event horizon',
    Math.hypot(swallowed.end.x, swallowed.end.y) < 2.6);
  const over = simulateLaunch(into, 0.6, 0.5);
  check('a shot that clears the black hole is not swallowed', over.outcome !== 'swallowed');
  const holePrev = previewShot(into, 0, 0.5);
  check('preview of a head-on shot at a black hole predicts swallowed',
    holePrev.outcome === 'swallowed');

  // Moving planets make the same launch time-dependent.
  const lvl5 = LEVELS[4];
  const a = simulateLaunch(lvl5, 0.2, 0.7, [], { record: true, t0: 0 });
  const b = simulateLaunch(lvl5, 0.2, 0.7, [], { record: true, t0: 3 });
  check('same launch at a different level time flies a different path',
    JSON.stringify(a.points) !== JSON.stringify(b.points));
  const a2 = simulateLaunch(lvl5, 0.2, 0.7, [], { record: true, t0: 0 });
  check('same launch at the same level time is deterministic',
    JSON.stringify(a.points) === JSON.stringify(a2.points));
  const pA = previewShot(lvl5, 0.2, 0.7, [], 0);
  const pB = previewShot(lvl5, 0.2, 0.7, [], 3);
  check('preview follows the launch time for moving planets',
    JSON.stringify(pA.points) !== JSON.stringify(pB.points));
}

// --- game feel: feedback tiers + near-miss band (Block 4) ---
{
  // Every feedback kind sits inside its tier's trauma / hit-stop ranges
  // from the game-feel skill (small 0.10-0.20 / no stop, medium
  // 0.30-0.50 / 0.04-0.06s, large 0.70-1.00 / 0.10-0.15s).
  for (const [kind, f] of Object.entries(FEEDBACK)) {
    const tier = FEEDBACK_TIERS[f.tier];
    check(`feedback ${kind} trauma ${f.trauma} is inside its ${f.tier} tier`,
      f.trauma >= tier.traumaMin && f.trauma <= tier.traumaMax);
    check(`feedback ${kind} hit-stop ${f.hitStop}s is inside its ${f.tier} tier`,
      f.hitStop >= tier.stopMin && f.hitStop <= tier.stopMax);
  }
  check('crash is the large tier', FEEDBACK.crash.tier === 'large');
  check('collect and launch are small with no hit-stop',
    FEEDBACK.collect.tier === 'small' && FEEDBACK.collect.hitStop === 0
    && FEEDBACK.launch.tier === 'small' && FEEDBACK.launch.hitStop === 0);
  check('win and swallowed are medium', FEEDBACK.win.tier === 'medium' && FEEDBACK.swallowed.tier === 'medium');
  check('slingshot is a small event', FEEDBACK.slingshot.tier === 'small' && FEEDBACK.slingshot.hitStop === 0);

  // Near-miss band: just outside the crash radius up to 2 units beyond it.
  const r = 2.5;
  check('near-miss band is 2 world units', NEAR_MISS_BAND === 2.0);
  check('touching the surface is a crash, not a near-miss', !isNearMiss(r + COMET_RADIUS, r));
  check('just outside the surface is a near-miss', isNearMiss(r + COMET_RADIUS + 0.1, r));
  check('the far edge of the band is a near-miss', isNearMiss(r + COMET_RADIUS + NEAR_MISS_BAND - 0.01, r));
  check('beyond the band is not a near-miss', !isNearMiss(r + COMET_RADIUS + NEAR_MISS_BAND + 0.1, r));
  check('far away is not a near-miss', !isNearMiss(20, r));

  // The flight state carries the per-shot slingshot ledger.
  const st = launchState(LEVELS[0], 0, 0.5);
  check('launch state starts with an empty slingshot ledger', Array.isArray(st.slingshotPlanets) && st.slingshotPlanets.length === 0);

  // The verified Level 4 line (24deg, power 0.55) grazes the planet
  // inside the band while collecting — the render check's slingshot line.
  {
    const lvl = LEVELS[3];
    const s = launchState(lvl, (24 * Math.PI) / 180, 0.55);
    const collected = [];
    const newly = [];
    let min = Infinity;
    let lastEv = null;
    while (!s.done) {
      newly.length = 0;
      const ev = stepFlight(s, lvl, SUBSTEP, collected, newly);
      const pos = planetPosAt(lvl.planets[0], s.t);
      min = Math.min(min, Math.hypot(s.x - pos.x, s.y - pos.y));
      if (ev) { lastEv = ev.type; if (ev.type !== 'collect') break; }
    }
    check('level 4 graze line collects the target', collected.length === 1);
    check('level 4 graze line passes inside the near-miss band', isNearMiss(min, lvl.planets[0].r));
    check('level 4 graze line does not crash', lastEv !== 'crash');
  }
}

// --- seeded levels: daily / seed links / endless (Block 6) ---
{
  // Seed helpers: the daily seed is the calendar date, so everyone gets
  // the same level; word seeds hash stably; numeric seeds pass through.
  const d1 = new Date(2026, 10, 20);
  const d2 = new Date(2026, 10, 21);
  check('daily seed is YYYYMMDD', dateSeed(d1) === 20261120);
  check('daily seed changes with the date', dateSeed(d1) !== dateSeed(d2));
  check('daily seed is the same for the same date', dateSeed(new Date(2026, 10, 20)) === 20261120);
  check('date key formats YYYY-MM-DD', dateKey(d1) === '2026-11-20');
  check('word seed hashes deterministically', seedFromString('orbit42') === seedFromString('orbit42'));
  check('different word seeds hash differently', seedFromString('orbit42') !== seedFromString('orbit43'));
  check('numeric seed param passes through', parseSeedParam('777') === 777);
  check('word seed param hashes', parseSeedParam('orbit42') === seedFromString('orbit42'));
  check('empty seed param is null', parseSeedParam('') === null && parseSeedParam(null) === null);
  check('whitespace-only seed param is null', parseSeedParam('   ') === null);
  check('daily difficulty rotates 2..4', [0, 1, 2, 3, 4, 5, 6].every((i) => {
    const d = dailyDifficulty(new Date(2026, 0, 1 + i));
    return d >= 2 && d <= 4;
  }));
  check('endless difficulty is the round number', endlessDifficulty(1) === 1 && endlessDifficulty(5) === 5);
  check('endless difficulty never drops below 1', endlessDifficulty(0) === 1);

  // The thrust solver: the shared grid search the bot and the render
  // check use.
  const solved = solveShotThrust(LEVELS[0], [], {});
  check('thrust solver finds a collecting shot on level 1', solved && solved.res.collected.length === 2);
  const plan = solveLevel(LEVELS[5], shotBudget(LEVELS[5]));
  check('ballistic solver completes level 6 within budget', !!plan && plan.shots <= shotBudget(LEVELS[5]));
  check('solver plan lines are valid angles/powers',
    !!plan && plan.lines.every((l) => l.angle >= 0 && l.angle < Math.PI * 2 && l.power >= 0.05 && l.power <= 1));
  const unsolvable = solveLevel(
    // The target sits inside a planet: the crash radius (5.5) is larger
    // than the collect radius (2.1), so the comet can never reach it.
    { pad: { x: -14, y: 0 }, planets: [{ x: 13, y: 0, r: 5, mu: 500 }], targets: [{ x: 13, y: 0, r: 1.6 }] },
    2, { coarse: true },
  );
  check('solver returns null for a level it cannot finish', unsolvable === null);

  // The generator: deterministic, valid, and always solvable.
  const gen = (seed, diff, id) => generateLevel(seed, diff, id);
  const a = gen(20261120, 2, 900);
  const b = gen(20261120, 2, 900);
  check('same seed + difficulty generates the same level', JSON.stringify(a) === JSON.stringify(b));
  check('different seeds generate different levels',
    JSON.stringify(gen(20261120, 2, 900)) !== JSON.stringify(gen(20261121, 2, 900)));
  check('different difficulties generate different levels',
    JSON.stringify(gen(42, 1, 900)) !== JSON.stringify(gen(42, 4, 900)));
  check('generated level registers under its challenge id', registerGeneratedLevel(gen(777, 2, 901)) === levelById(901));
  check('levelById still returns null for unknown ids', levelById(9999) === null);

  const combos = [
    [1, 1], [2, 1], [3, 2], [7, 2], [42, 3], [1337, 3],
    [20261120, 2], [20261121, 3], [777, 4], [424242, 5], [99, 5], [5, 4],
  ];
  for (const [seed, diff] of combos) {
    const lvl = gen(seed, diff, 950);
    const tag = `seed ${seed} d${diff}`;
    check(`generated ${tag}: par is 2..5`, lvl.par >= 2 && lvl.par <= 5);
    check(`generated ${tag}: budget is par + 2`, shotBudget(lvl) === lvl.par + 2);
    check(`generated ${tag}: has 1..3 planets and 1..3 targets`,
      lvl.planets.length >= 1 && lvl.planets.length <= 3 && lvl.targets.length >= 1 && lvl.targets.length <= 3);
    check(`generated ${tag}: pad inside the playfield`,
      lvl.pad.x * lvl.pad.x + lvl.pad.y * lvl.pad.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS);
    check(`generated ${tag}: planets and targets inside the playfield`,
      lvl.planets.every((p) => p.x * p.x + p.y * p.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)
      && lvl.targets.every((t) => t.x * t.x + t.y * t.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS));
    check(`generated ${tag}: no target overlaps a planet`,
      lvl.targets.every((t) => lvl.planets.every((p) =>
        Math.hypot(t.x - p.x, t.y - p.y) > p.r + t.r + 0.5)));
    check(`generated ${tag}: no planet overlaps the pad`,
      lvl.planets.every((p) => Math.hypot(p.x - lvl.pad.x, p.y - lvl.pad.y) > p.r + 2));
    check(`generated ${tag}: difficulty recorded`, lvl.difficulty === diff);
    check(`generated ${tag}: seed recorded`, lvl.seed === (seed >>> 0));
    check(`generated ${tag}: solver completes it within budget`,
      !!solveLevel(lvl, shotBudget(lvl), {
        coarse: true, t0s: levelHasMovingPlanets(lvl) ? [0, 1.5, 3, 4.5] : [0],
      }));
  }
}

// --- save round-trip ---
{
  const save = defaultSave();
  check('default save unlocks only level 1', save.unlocked === 1 && Object.keys(save.stars).length === 0);
  check('default save has no daily best and no seed bests',
    save.daily === null && Object.keys(save.seedBest).length === 0);
  save.stars = { 1: 3, 2: 2 };
  save.unlocked = 3;
  const json = serializeSave(save);
  const back = parseSave(json);
  check('save round-trips stars', back.stars[1] === 3 && back.stars[2] === 2);
  check('save round-trips unlocked level', back.unlocked === 3);
  check('total stars sums correctly', totalStars(back) === 5);
  check('garbage save text falls back to defaults', parseSave('not json').unlocked === 1);
  check('save clamps unlocked into range', parseSave('{"unlocked":99}').unlocked === 6);
  check('save drops stars for unknown levels',
    Object.keys(parseSave('{"stars":{"99":3}}').stars).length === 0);
  check('save drops out-of-range star counts',
    Object.keys(parseSave('{"stars":{"1":9}}').stars).length === 0);
  // Daily + seed bests round-trip and validate on load.
  const withBest = defaultSave();
  withBest.daily = { date: '2026-11-20', stars: 3 };
  withBest.seedBest = { orbit42: 2, '777': 3 };
  const bestBack = parseSave(serializeSave(withBest));
  check('save round-trips the daily best',
    bestBack.daily && bestBack.daily.date === '2026-11-20' && bestBack.daily.stars === 3);
  check('save round-trips seed bests',
    bestBack.seedBest.orbit42 === 2 && bestBack.seedBest['777'] === 3);
  // Endless best (Block 7): rounds cleared in one run, round-trips and
  // validates like the other bests; old saves without it default to 0.
  const withEndless = defaultSave();
  withEndless.endlessBest = 5;
  check('save round-trips the endless best',
    parseSave(serializeSave(withEndless)).endlessBest === 5);
  check('save defaults endless best to 0 for old saves',
    parseSave('{"stars":{},"unlocked":1}').endlessBest === 0);
  check('save clamps an out-of-range endless best',
    parseSave('{"endlessBest":250}').endlessBest === 99);
  check('save drops a non-integer endless best',
    parseSave('{"endlessBest":"many"}').endlessBest === 0);
  // Zen best (Block 15, #21): stars collected in one sandbox session,
  // round-trips and validates like the other bests; old saves default
  // to 0 and an out-of-range value clamps to 999.
  const withZen = defaultSave();
  withZen.zenBest = 7;
  check('save round-trips the zen best',
    parseSave(serializeSave(withZen)).zenBest === 7);
  check('save defaults zen best to 0 for old saves',
    parseSave('{"stars":{},"unlocked":1}').zenBest === 0);
  check('save clamps an out-of-range zen best',
    parseSave('{"zenBest":5000}').zenBest === 999);
  check('save drops a non-integer zen best',
    parseSave('{"zenBest":"many"}').zenBest === 0);
  check('save drops a daily best with a bad date',
    parseSave('{"daily":{"date":"yesterday","stars":3}}').daily === null);
  check('save drops a daily best with out-of-range stars',
    parseSave('{"daily":{"date":"2026-11-20","stars":9}}').daily === null);
  check('save drops out-of-range seed bests',
    Object.keys(parseSave('{"seedBest":{"x":9}}').seedBest).length === 0);
  // Time Attack best (Block 10): { stars 0..15, seconds 0..240 }, null by
  // default and for old saves; invalid values are dropped on load.
  const withTA = defaultSave();
  withTA.timeAttackBest = { stars: 12, seconds: 201 };
  check('save round-trips the time attack best',
    JSON.stringify(parseSave(serializeSave(withTA)).timeAttackBest)
    === JSON.stringify({ stars: 12, seconds: 201 }));
  check('save defaults time attack best to null for old saves',
    parseSave('{"stars":{},"unlocked":1}').timeAttackBest === null);
  check('save drops a time attack best with out-of-range stars',
    parseSave('{"timeAttackBest":{"stars":16,"seconds":200}}').timeAttackBest === null);
  check('save drops a time attack best with out-of-range seconds',
    parseSave('{"timeAttackBest":{"stars":12,"seconds":241}}').timeAttackBest === null);
  check('save drops a time attack best with a non-integer field',
    parseSave('{"timeAttackBest":{"stars":12,"seconds":"fast"}}').timeAttackBest === null);
}

// --- Block 8: camera zoom, tap-to-launch, level-grid roving focus ---
{
  check('zoom bounds are 0.6..2.0', ZOOM_MIN === 0.6 && ZOOM_MAX === 2.0);
  check('clampZoom passes 1 through', clampZoom(1) === 1);
  check('clampZoom keeps 1.5', clampZoom(1.5) === 1.5);
  check('clampZoom floors at 0.6', clampZoom(0.1) === 0.6);
  check('clampZoom caps at 2.0', clampZoom(99) === 2.0);
  check('clampZoom falls back to 1 for NaN', clampZoom(NaN) === 1);
  check('clampZoom falls back to 1 for a non-number', clampZoom('far') === 1);
  check('tap window is 300ms / 14px', TAP_MAX_MS === 300 && TAP_MAX_PX === 14);
  check('a quick still press is a tap', isTapGesture(120, 5) === true);
  check('a tap at the exact limits still counts', isTapGesture(300, 14) === true);
  check('a slow press is not a tap', isTapGesture(301, 5) === false);
  check('a press that moves too far is not a tap', isTapGesture(100, 15) === false);
  check('roving focus starts at the first button going forward', focusStep(-1, 8, 1) === 0);
  check('roving focus starts at the last button going backward', focusStep(-1, 8, -1) === 7);
  check('roving focus wraps forward off the end', focusStep(7, 8, 1) === 0);
  check('roving focus wraps backward off the start', focusStep(0, 8, -1) === 7);
  check('roving focus steps forward inside the grid', focusStep(3, 8, 1) === 4);
  check('roving focus on an empty grid is -1', focusStep(0, 0, 1) === -1);
}

// --- Block 9: portals, bounce pads, shielded targets ---
{
  check('portal, bounce and shieldhit are small feedback events',
    FEEDBACK.portal.tier === 'small' && FEEDBACK.portal.hitStop === 0
    && FEEDBACK.bounce.tier === 'small' && FEEDBACK.bounce.hitStop === 0
    && FEEDBACK.shieldhit.tier === 'small' && FEEDBACK.shieldhit.hitStop === 0);

  // Portal teleport: a comet flying into portal A exits its twin with
  // the entry velocity unchanged.
  const portalLevel = {
    pad: { x: -10, y: 0 }, planets: [],
    portals: [{ x: 0, y: 0, r: 1.6, pair: 0 }, { x: 10, y: 8, r: 1.6, pair: 0 }],
    targets: [{ x: 16, y: 8, r: 1.6 }],
  };
  {
    const s = launchState(portalLevel, 0, 0.6);
    let ev = null;
    for (let i = 0; i < 600 && !ev; i++) ev = stepFlight(s, portalLevel, SUBSTEP, [], []);
    check('flying into a portal fires a portal event', ev && ev.type === 'portal');
    // Exit sits just outside the twin, along the entry direction.
    const twin = portalLevel.portals[1];
    const d = Math.hypot(s.x - twin.x, s.y - twin.y);
    check('portal exit is just outside the twin portal',
      d > twin.r + COMET_RADIUS && d < twin.r + COMET_RADIUS + 1);
    check('portal exit keeps the entry velocity direction',
      s.vx > 0 && Math.abs(s.vy) < 0.5);
    // The hop continues the flight: the same shot reaches the target.
    const full = simulateLaunch(portalLevel, 0, 0.6);
    check('a shot through the portal reaches the far target',
      full.outcome === 'collected' && full.portalUses === 1);
    // The pair cools down: a comet that turns straight back into the
    // twin within 0.6s passes through instead of hopping again.
    const s2 = launchState(portalLevel, 0, 0.6);
    s2.x = 10; s2.y = 8; s2.vx = 13.2; s2.vy = 0; s2.t = 0;
    s2.portalCooldown[0] = 0.6;
    const ev2 = stepFlight(s2, portalLevel, SUBSTEP, [], []);
    check('portal cooldown blocks an instant re-hop', !ev2 || ev2.type !== 'portal');
  }

  // Bounce pad: a comet hitting the top of a pad reflects downward —
  // the vertical velocity flips sign and the shot keeps flying.
  const padLevel = {
    pad: { x: 0, y: 10 }, planets: [],
    bouncePads: [{ x: 0, y: 0, r: 2.2 }],
    targets: [{ x: 8, y: -8, r: 1.6 }],
  };
  {
    const s = launchState(padLevel, -Math.PI / 2, 0.5);
    let ev = null;
    let vyBefore = null;
    for (let i = 0; i < 600 && !ev; i++) {
      vyBefore = s.vy;
      ev = stepFlight(s, padLevel, SUBSTEP, [], []);
    }
    check('hitting a bounce pad fires a bounce event', ev && ev.type === 'bounce');
    check('bounce flips the velocity away from the pad (vy was down, now up)',
      vyBefore < 0 && s.vy > 0);
    const full = simulateLaunch(padLevel, -Math.PI / 2, 0.5);
    check('a bounced shot is counted, not lost', full.bounces === 1 && full.outcome !== 'crash');
    // A pad only fires once per shot: a second contact passes through.
    const s2 = launchState(padLevel, -Math.PI / 2, 0.5);
    s2.bouncedPads.push(0);
    let ev2 = null;
    for (let i = 0; i < 600 && !ev2; i++) ev2 = stepFlight(s2, padLevel, SUBSTEP, [], []);
    check('a used bounce pad does not fire again this shot', !ev2 || ev2.type !== 'bounce');
  }

  // Shielded targets: one shot cracks the shield (no collect), the next
  // shot with the cracked state collects it; a single shot can never
  // collect a shielded target, even flying straight through it.
  const shieldLevel = {
    pad: { x: 0, y: 0 }, planets: [],
    targets: [{ x: 10, y: 0, r: 1.6, hits: 2 }],
  };
  {
    const first = simulateLaunch(shieldLevel, 0, 0.5);
    check('first shot at a shielded target cracks it but collects nothing',
      first.collected.length === 0 && first.shieldCracks === 1);
    check('cracked shield state is returned for the next shot',
      first.shieldHits[0] === 1);
    const second = simulateLaunch(shieldLevel, 0, 0.5, [], { shieldHits: first.shieldHits });
    check('second shot at a cracked shield collects the target',
      second.collected.length === 1 && second.outcome === 'collected');
    const preview = previewShot(shieldLevel, 0, 0.5, [], 0, first.shieldHits);
    check('preview with a cracked shield predicts the collect',
      preview.collected.length === 1);
    const previewFresh = previewShot(shieldLevel, 0, 0.5);
    check('preview with an intact shield predicts no collect',
      previewFresh.collected.length === 0);
  }

  // The thrust solver completes level 6 (portals + shielded target +
  // black hole) within par, and its two shots together collect all four
  // targets — including the shielded one, which takes two hits across
  // the two shots.
  {
    const plan6 = solveLevelThrust(LEVELS[5], LEVELS[5].par);
    check('thrust solver completes level 6 "Grand Tour" within par',
      !!plan6 && plan6.shots <= LEVELS[5].par);
    check('level 6 thrust plan collects all four targets across its shots',
      !!plan6 && plan6.lines.reduce((n, l) => n + l.collected, 0) === 4);
    check('level 6 thrust plan earns 3 stars at par',
      !!plan6 && starsForShots(plan6.shots, LEVELS[5].par) === 3);
  }
}

// --- Block 10: moving targets, time attack, difficulty tuning ---
{
  // targetPosAt: static targets stay put, orbiting targets travel the circle.
  const still = { x: 3, y: 4, r: 1.6 };
  check('static target position does not depend on time',
    targetPosAt(still, 0).x === 3 && targetPosAt(still, 9.5).y === 4);
  const mover = { x: 12, y: 0, r: 1.6, orbit: { cx: 10, cy: 0, radius: 2, speed: 0.5, phase: 0 } };
  check('orbiting target starts at its phase position',
    approx(targetPosAt(mover, 0).x, 12) && approx(targetPosAt(mover, 0).y, 0));
  check('orbiting target is on the far side half a period later',
    approx(targetPosAt(mover, Math.PI / 0.5).x, 8, 1e-6)
    && approx(Math.abs(targetPosAt(mover, Math.PI / 0.5).y), 0, 1e-6));
  check('orbiting target stays on its orbit circle',
    approx(Math.hypot(targetPosAt(mover, 1.7).x - 10, targetPosAt(mover, 1.7).y), 2, 1e-6));
  check('orbiting target position is deterministic for the same t',
    JSON.stringify(targetPosAt(mover, 3.7)) === JSON.stringify(targetPosAt(mover, 3.7)));
  check('level 5 has a moving planet, level 1 has none',
    levelHasMovingPlanets(LEVELS[4]) && !levelHasMovingPlanets(LEVELS[0]));

  // A launch must meet the target where it is, not where it started:
  // the comet (speed 11) reaches x=13 at ~1.18s, and the target is at
  // (13,0) when 2*(t0+1.18) is a multiple of 2*pi (t0 ~= 1.96). Half a
  // period earlier (t0 ~= 0.39) it sits at (7,0), far from the line.
  const movingLevel = {
    pad: { x: 0, y: 0 }, planets: [],
    targets: [{ x: 13, y: 0, r: 1.6, orbit: { cx: 10, cy: 0, radius: 3, speed: 2, phase: 0 } }],
  };
  const onTime = simulateLaunch(movingLevel, 0, 0.5, [], { t0: 1.96 });
  check('a launch timed to meet the moving target collects it',
    onTime.outcome === 'collected' && onTime.collected.length === 1);
  const offTime = simulateLaunch(movingLevel, 0, 0.5, [], { t0: 0.39 });
  check('the same launch half a period early misses the moving target',
    offTime.outcome !== 'collected' && offTime.collected.length === 0);
  const pA = previewShot(movingLevel, 0, 0.5, [], 1.96);
  const pB = previewShot(movingLevel, 0, 0.5, [], 0.39);
  check('preview follows the launch time for moving targets',
    pA.collected.length === 1 && pB.collected.length === 0);

  // The thrust solver completes level 5 (moving planet) within par,
  // timing its launch for when the bend lines up.
  const plan5 = solveLevelThrust(LEVELS[4], LEVELS[4].par);
  check('thrust solver completes level 5 "Carousel" within par',
    !!plan5 && plan5.shots <= LEVELS[4].par);
  if (plan5) {
    check('thrust solver earns 3 stars on level 5',
      starsForShots(plan5.shots, LEVELS[4].par) === 3);
    check('level 5 thrust plan waits for the moving planet (nonzero launch time)',
      plan5.lines.some((l) => l.t0 > 0));
  }

  // Difficulty tuning (v2): par is the thrust solver's shot count — the
  // bot must FLY to clear a level in par, never just aim. Ballistics
  // alone need more shots (see the anti-slop gate in the v2 section).
  // The old slow lob (63deg, power 0.25) collected nothing on level 6:
  // the targets sit in different lob zones now.
  check('v2 pars: L1=1, L2=2, L3=2, L4=2, L5=2, L6=2',
    LEVELS[0].par === 1 && LEVELS[1].par === 2 && LEVELS[2].par === 2
    && LEVELS[3].par === 2 && LEVELS[4].par === 2 && LEVELS[5].par === 2);
  {
    const lob = simulateLaunch(LEVELS[5], (63 * Math.PI) / 180, 0.25);
    check('level 6 slow lob collects nothing (no free multi-collect)', lob.collected.length === 0);
    const plan6 = solveLevelThrust(LEVELS[5], LEVELS[5].par);
    check('level 6 thrust solver clears it in par (2 shots)', !!plan6 && plan6.shots === 2);
  }

  // Time Attack: five levels, one 4:00 clock, M:SS display.
  check('time attack runs levels 1-5 in order',
    JSON.stringify(TIME_ATTACK_LEVEL_IDS) === JSON.stringify([1, 2, 3, 4, 5]));
  check('time attack clock is 240 seconds', TIME_ATTACK_SECONDS === 240);
  check('formatClock shows 4:00 for 240s', formatClock(240) === '4:00');
  check('formatClock shows 3:42 for 222s', formatClock(222) === '3:42');
  check('formatClock pads single-digit seconds', formatClock(7) === '0:07');
  check('formatClock shows 0:00 at zero', formatClock(0) === '0:00');
  check('formatClock clamps negative time to 0:00', formatClock(-5) === '0:00');
  check('formatClock rounds a fractional second up', formatClock(239.2) === '4:00');
  check('time attack levels are all campaign levels',
    TIME_ATTACK_LEVEL_IDS.every((id) => !!levelById(id)));
}

// --- Block 11: state audit + NaN guards (#47) ---
{
  const emptyLevel = { pad: { x: 0, y: 0 }, planets: [], targets: [{ x: 10, y: 0, r: 1.6 }] };

  // launchState sanitises non-finite input instead of seeding NaN.
  const nanLaunch = launchState(emptyLevel, NaN, NaN);
  check('launchState with NaN angle/power gives a finite still comet',
    Number.isFinite(nanLaunch.vx) && Number.isFinite(nanLaunch.vy)
    && nanLaunch.vx === 0 && nanLaunch.vy === 0
    && Number.isFinite(nanLaunch.x) && Number.isFinite(nanLaunch.y));
  const infLaunch = launchState(emptyLevel, 0, Infinity);
  check('launchState clamps infinite power to full speed, finite',
    Number.isFinite(infLaunch.vx) && Math.abs(infLaunch.vx - MAX_SPEED) < 1e-9 && infLaunch.vy === 0);
  const okLaunch = launchState(emptyLevel, Math.PI / 2, 0.5);
  check('launchState with valid input is unchanged',
    Math.abs(okLaunch.vx) < 1e-9 && Math.abs(okLaunch.vy - MAX_SPEED * 0.5) < 1e-9);

  // stepFlight ends a corrupted flight as 'invalid' instead of flying
  // forever on NaN comparisons that never fire.
  for (const corrupt of ['vx', 'vy', 'x', 'y']) {
    const s = launchState(emptyLevel, 0, 0.5);
    s[corrupt] = NaN;
    const ev = stepFlight(s, emptyLevel, SUBSTEP, [], []);
    check(`stepFlight with NaN ${corrupt} returns the invalid event and stops`,
      !!ev && ev.type === 'invalid' && s.done === true && Array.isArray(ev.targets));
  }
  {
    const s = launchState(emptyLevel, 0, 0.5);
    s.y = Infinity;
    const ev = stepFlight(s, emptyLevel, SUBSTEP, [], []);
    check('stepFlight with infinite position returns the invalid event',
      !!ev && ev.type === 'invalid' && s.done === true);
  }
  {
    // A healthy step still advances the comet and returns no event.
    const s = launchState(emptyLevel, 0, 0.5);
    const ev = stepFlight(s, emptyLevel, SUBSTEP, [], []);
    check('stepFlight with finite state still steps normally',
      ev === null && s.done === false && Number.isFinite(s.x) && s.x > 0);
  }

  // A full simulation from NaN input terminates with a known outcome
  // and a finite end position — it never hangs or returns NaN.
  for (const [angle, power] of [[NaN, 0.5], [0, NaN], [NaN, NaN]]) {
    const sim = simulateLaunch(LEVELS[0], angle, power, [], { record: false });
    check(`simulateLaunch with NaN input (${angle}, ${power}) terminates cleanly`,
      ['collected', 'partial', 'crash', 'swallowed', 'lost', 'timeout', 'invalid', 'none'].includes(sim.outcome)
      && Number.isFinite(sim.end.x) && Number.isFinite(sim.end.y)
      && Number.isFinite(sim.time) && sim.steps <= Math.ceil(10 / SUBSTEP) + 3);
  }
  {
    const sim = simulateLaunch(LEVELS[0], 0, 0.5);
    check('simulateLaunch outcome is a known string for a normal launch',
      ['collected', 'partial', 'crash', 'swallowed', 'lost', 'timeout', 'invalid', 'none'].includes(sim.outcome));
  }
}

// --- FPS guard (Block 14, #46) ---
{
  check('perf levels step pixel ratio down and particle scale down',
    PERF_LEVELS.length === 4
    && PERF_LEVELS[0].pixelRatio === 2 && PERF_LEVELS[0].particleScale === 1
    && PERF_LEVELS[3].pixelRatio === 1 && PERF_LEVELS[3].particleScale === 0.35
    && PERF_LEVELS.every((l, i) => i === 0
      || (l.pixelRatio <= PERF_LEVELS[i - 1].pixelRatio && l.particleScale <= PERF_LEVELS[i - 1].particleScale)));
  check('perf thresholds are sane (slow 24ms, fast 14ms)',
    PERF_SLOW_MS === 24 && PERF_FAST_MS === 14 && PERF_FAST_MS < PERF_SLOW_MS);

  const g = createPerfGuard();
  check('perf guard starts at level 0 with no EMA',
    g.level === 0 && g.emaMs === 0 && g.stepsDown === 0 && g.stepsUp === 0);
  check('perf guard pixelRatio/particleScale match level 0',
    g.pixelRatio() === 2 && g.particleScale() === 1);

  // Steady 60fps frames never step down, even over 10 simulated seconds.
  for (let i = 0; i < 600; i++) g.update(16.7);
  check('perf guard stays at level 0 on steady 60fps',
    g.level === 0 && g.stepsDown === 0 && Math.abs(g.emaMs - 16.7) < 0.5);

  // A brief slow spike (under the 1s hold) does not step down.
  const g2 = createPerfGuard();
  for (let i = 0; i < 30; i++) g2.update(16.7);
  for (let i = 0; i < 20; i++) g2.update(40); // 0.8s of slow frames
  check('perf guard does not step down on a brief slow spike',
    g2.level === 0 && g2.stepsDown === 0);

  // Sustained slow frames step down one level per second of slowness.
  for (let i = 0; i < 60; i++) g2.update(40); // another 2.4s slow
  check('perf guard steps down on sustained slow frames',
    g2.level >= 1 && g2.stepsDown >= 1);
  check('perf guard level 1 lowers pixel ratio and particle scale',
    g2.pixelRatio() === PERF_LEVELS[g2.level].pixelRatio
    && g2.particleScale() === PERF_LEVELS[g2.level].particleScale
    && g2.pixelRatio() < 2 && g2.particleScale() < 1);

  // Sustained slow frames bottom out at the last level, never beyond it.
  for (let i = 0; i < 600; i++) g2.update(50);
  check('perf guard clamps at the lowest level',
    g2.level === PERF_LEVELS.length - 1 && g2.pixelRatio() === 1);

  // Sustained fast frames step back up (3s hold per level: 375 frames
  // at 8ms each, plus ~20 frames for the EMA to fall under 14ms).
  const before = g2.level;
  for (let i = 0; i < 500; i++) g2.update(8);
  check('perf guard steps back up on sustained fast frames',
    g2.level < before && g2.stepsUp >= 1);
  for (let i = 0; i < 1500; i++) g2.update(8);
  check('perf guard recovers to level 0 on sustained fast frames',
    g2.level === 0 && g2.pixelRatio() === 2 && g2.particleScale() === 1);

  // Corrupted frame times never move the guard.
  const g3 = createPerfGuard();
  for (let i = 0; i < 10; i++) g3.update(16.7);
  const emaBefore = g3.emaMs;
  g3.update(NaN);
  g3.update(Infinity);
  g3.update(-5);
  g3.update('fast');
  check('perf guard ignores NaN / infinite / negative / non-number frames',
    g3.level === 0 && g3.emaMs === emaBefore && g3.stepsDown === 0);
  // A zero-ms frame is finite and feeds the EMA (a paused tab's first
  // frame); it must not crash or step the guard.
  g3.update(0);
  check('perf guard accepts a 0ms frame without stepping',
    g3.level === 0 && Number.isFinite(g3.emaMs));
}

// --- Block 15: Zen Sandbox (#21) + near-miss slow-mo (#31) ---
{
  const zen = zenLevel();
  check('zen level has challenge id 903 and is flagged zen',
    zen.id === 903 && zen.id === ZEN_ID && zen.zen === true);
  check('zen level has 3 targets, 2 planets (one moving) and a black hole',
    zen.targets.length === 3 && zen.planets.length === 2 && levelHasMovingPlanets(zen)
    && levelBlackHoles(zen).length === 1);
  check('zen level sits inside the playfield',
    zen.pad.x * zen.pad.x + zen.pad.y * zen.pad.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS
    && zen.planets.every((p) => p.x * p.x + p.y * p.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)
    && zen.targets.every((t) => t.x * t.x + t.y * t.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS)
    && zen.blackHoles.every((b) => b.x * b.x + b.y * b.y < PLAYFIELD_RADIUS * PLAYFIELD_RADIUS));
  check('zen targets clear every planet and the black hole',
    zen.targets.every((t) => zen.planets.every((p) => Math.hypot(t.x - p.x, t.y - p.y) > p.r + t.r + 0.5)
      && zen.blackHoles.every((b) => Math.hypot(t.x - b.x, t.y - b.y) > b.r + t.r + 1)));
  check('zen moving planet never sweeps over a target, the pad or the black hole',
    zen.planets.every((p) => {
      if (!p.orbit) return true;
      const clear = (x, y, extra) => {
        const d = Math.hypot(x - p.orbit.cx, y - p.orbit.cy);
        return Math.abs(d - p.orbit.radius) > p.r + extra + 0.5;
      };
      return zen.targets.every((t) => clear(t.x, t.y, t.r))
        && clear(zen.pad.x, zen.pad.y, 1.5)
        && zen.blackHoles.every((b) => clear(b.x, b.y, b.r));
    }));
  check('zen shot budget is infinite', shotBudget(zen) === Infinity);
  check('zen level is solvable within 6 shots',
    (() => { const plan = solveLevel(zen, 6, { coarse: true }); return !!plan && plan.shots <= 6; })());
  registerGeneratedLevel(zenLevel());
  check('zen level registers under its id',
    levelById(ZEN_ID) !== null && levelById(ZEN_ID).zen === true);

  // Near-miss slow-mo: the time scale dips to 0.35 for 450ms of real
  // time after a slingshot, stays 1 outside the window and under reduce
  // motion, and a corrupted clock can never freeze the game slow.
  check('slow-mo scale is 0.35 inside the window',
    slowMoScale(1000, 1450, false) === SLOW_MO_SCALE && SLOW_MO_SCALE === 0.35);
  check('slow-mo scale is 1 once the window ends',
    slowMoScale(1450, 1450, false) === 1 && slowMoScale(2000, 1450, false) === 1);
  check('slow-mo is disabled under reduce motion', slowMoScale(1000, 1450, true) === 1);
  check('slow-mo ignores a corrupted clock',
    slowMoScale(NaN, 1450, false) === 1 && slowMoScale(1000, NaN, false) === 1
    && slowMoScale(1000, Infinity, false) === 1);
  check('slow-mo window is 450ms', SLOW_MO_MS === 450);
}

// --- Block 16: achievements + stats (#48 save versioning, achievements) ---
{
  // The achievement table: 11 entries, unique ids, every entry has a
  // name, a description and an icon. (v2: daily-grind, deep-space and
  // zen-master are gone — those modes are dormant until rebuilt.)
  check('11 achievements defined', ACHIEVEMENTS.length === 11);
  check('achievement ids are unique',
    new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
  check('every achievement has a name, description and icon',
    ACHIEVEMENTS.every((a) => a.name.length > 0 && a.desc.length > 0 && a.icon.length > 0));

  // A fresh save earns nothing and starts at schema version 4 with
  // empty lifetime stats and no achievements.
  check('fresh save unlocks no achievements',
    checkAchievements(defaultSave()).length === 0);
  check('default save is schema version 4', defaultSave().version === SAVE_VERSION && SAVE_VERSION === 4);
  check('default save starts with both ship upgrades off',
    JSON.stringify(defaultSave().upgrades) === JSON.stringify({ thrust: false, tank: false }));
  check('default save has empty lifetime stats',
    JSON.stringify(defaultStats()) === JSON.stringify({ shots: 0, collects: 0, crashes: 0, slingshots: 0, portals: 0, bounces: 0, wins: 0, fails: 0, oneShotClears: 0, lastShotWins: 0, dailyWins: 0 }));
  check('default save has no achievements', defaultSave().achievements.length === 0);

  // Each achievement fires on exactly the save state it describes.
  const earned = (mut) => { const s = defaultSave(); mut(s); return checkAchievements(s); };
  check('first launch fires on 1 shot', earned((s) => { s.stats.shots = 1; }).includes('first-launch'));
  check('first star fires on 1 collect', earned((s) => { s.stats.collects = 1; }).includes('first-star'));
  check('first win fires on 1 win', earned((s) => { s.stats.wins = 1; }).includes('first-win'));
  check('one-shot fires on a 1-shot clear', earned((s) => { s.stats.oneShotClears = 1; }).includes('one-shot'));
  check('triple star fires on a 3-star level', earned((s) => { s.stars = { 1: 3 }; }).includes('triple-star'));
  check('halfway fires at 3 cleared levels',
    earned((s) => { s.stars = { 1: 1, 2: 1, 3: 1 }; }).includes('halfway'));
  check('grand tour fires at 6 cleared levels',
    earned((s) => { s.stars = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }; }).includes('grand-tour'));
  check('constellation fires at 18 stars',
    earned((s) => { s.stars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 }; }).includes('constellation'));
  check('gravity dancer fires at 10 slingshots', earned((s) => { s.stats.slingshots = 10; }).includes('slingshot-10'));
  check('down to the wire fires on a last-shot win', earned((s) => { s.stats.lastShotWins = 1; }).includes('last-shot'));
  check('gate crasher fires on 1 portal hop', earned((s) => { s.stats.portals = 1; }).includes('gate-crasher'));
  // Thresholds are exact: 9 slingshots earn nothing.
  check('slingshot threshold is exact at 10',
    !earned((s) => { s.stats.slingshots = 9; }).includes('slingshot-10'));
  // Already-unlocked achievements never re-fire, and a perfect campaign
  // save earns the whole set at once.
  check('already-unlocked achievements do not re-fire',
    (() => { const s = defaultSave(); s.stats.shots = 1; s.achievements = ['first-launch']; return checkAchievements(s).length === 0; })());
  check('a perfect campaign save earns all 11 achievements',
    (() => {
      const s = defaultSave();
      s.stats = { shots: 5, collects: 12, crashes: 2, slingshots: 10, portals: 1, bounces: 1, wins: 6, fails: 1, oneShotClears: 1, lastShotWins: 1, dailyWins: 0 };
      s.stars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 };
      return checkAchievements(s).length === 11;
    })());
  // checkAchievements is pure: it never mutates the save.
  check('checkAchievements does not mutate the save',
    (() => { const s = defaultSave(); s.stats.shots = 1; const before = JSON.stringify(s); checkAchievements(s); return JSON.stringify(s) === before; })());

  // Save versioning (#48): stats + achievements round-trip, a v1 save
  // (no version/stats/achievements fields) migrates with its stars and
  // unlocks intact, and corrupt values are dropped or clamped.
  const withStats = defaultSave();
  withStats.stats.shots = 42; withStats.stats.slingshots = 7;
  withStats.achievements = ['first-launch', 'first-star'];
  const statsBack = parseSave(serializeSave(withStats));
  check('save round-trips lifetime stats',
    statsBack.stats.shots === 42 && statsBack.stats.slingshots === 7);
  check('save round-trips achievements',
    JSON.stringify(statsBack.achievements) === JSON.stringify(['first-launch', 'first-star']));
  check('save round-trips the schema version', statsBack.version === SAVE_VERSION);
  const v1 = parseSave('{"stars":{"1":3,"2":2},"unlocked":3,"seenHowTo":true,"daily":null,"seedBest":{},"endlessBest":2,"timeAttackBest":null,"zenBest":4}');
  check('v1 save migrates: stars and unlocks kept',
    v1.stars[1] === 3 && v1.stars[2] === 2 && v1.unlocked === 3 && v1.zenBest === 4);
  check('v1 save migrates: stats and achievements start empty',
    v1.version === SAVE_VERSION && v1.stats.shots === 0 && v1.achievements.length === 0);
  check('save drops unknown achievement ids',
    parseSave('{"achievements":["first-launch","nope","first-star"]}').achievements.length === 2);
  check('save dedupes achievement ids',
    parseSave('{"achievements":["first-launch","first-launch"]}').achievements.length === 1);
  check('save clamps negative and huge stat values',
    (() => { const s = parseSave('{"stats":{"shots":-5,"collects":9999999,"wins":"many"}}'); return s.stats.shots === 0 && s.stats.collects === 999999 && s.stats.wins === 0; })());
  check('save drops stats for unknown keys',
    Object.keys(parseSave('{"stats":{"shots":3,"cheat":99}}').stats).length === 11);
}

// --- Block 17: audio settings (#36) + crash flash (#32) + gravity-assist bonus (#4) ---
{
  const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
  check('three music styles with unique ids and names', MUSIC_STYLES.length === 3
    && new Set(MUSIC_STYLES.map((s) => s.id)).size === 3
    && new Set(MUSIC_STYLES.map((s) => s.name)).size === 3);
  check('every music style has 4 roots, 4 arp steps, a 150..400ms step and valid waves',
    MUSIC_STYLES.every((s) => s.roots.length === 4 && s.arp.length === 4
      && s.stepMs >= 150 && s.stepMs <= 400
      && WAVES.includes(s.bass) && WAVES.includes(s.arpType)
      && s.bassVol > 0 && s.bassVol <= 0.1 && s.arpVol > 0 && s.arpVol <= 0.1));
  check('nebula is the original Block 5 sound (roots, arp, 250ms step)',
    (() => {
      const s = musicStyleById('nebula');
      return JSON.stringify(s.roots) === JSON.stringify([55, 43.65, 65.41, 49])
        && JSON.stringify(s.arp) === JSON.stringify([2, 3, 4, 3]) && s.stepMs === 250;
    })());
  check('musicStyleById falls back to nebula for an unknown id',
    musicStyleById('nope').id === 'nebula' && musicStyleById().id === 'nebula');
  check('music style cycler steps nebula -> pulse -> deep -> nebula',
    nextMusicStyleId('nebula') === 'pulse' && nextMusicStyleId('pulse') === 'deep'
    && nextMusicStyleId('deep') === 'nebula' && nextMusicStyleId('nope') === 'nebula');
  check('crash flash allows the first flash and one 333ms later',
    flashAllowed(1000, -Infinity, false) && flashAllowed(1333, 1000, false)
    && FLASH_MIN_INTERVAL_MS === 333);
  check('crash flash blocks a second flash inside 333ms',
    !flashAllowed(1000, 900, false) && !flashAllowed(1332, 1000, false));
  check('crash flash is suppressed under reduce flashing',
    !flashAllowed(1000, -Infinity, true));
  check('crash flash rejects a corrupted now but allows an unknown last flash',
    !flashAllowed(NaN, -Infinity, false) && flashAllowed(1000, NaN, false));
  check('gravity-assist bonus is +100 per slingshot',
    gravityAssistPoints(0) === 0 && gravityAssistPoints(1) === 100
    && gravityAssistPoints(3) === 300 && GRAVITY_ASSIST_POINTS === 100);
  check('gravity-assist bonus clamps bad counts to 0',
    gravityAssistPoints(-2) === 0 && gravityAssistPoints(NaN) === 0
    && gravityAssistPoints(2.7) === 200);
  // Best-bonus save round-trip (#4): per-level bests persist, clamp to
  // 0..9999, drop non-campaign levels, and a v1 save starts empty.
  const withBonus = defaultSave();
  withBonus.bestBonus = { 1: 300, 4: 100 };
  const bonusBack = parseSave(serializeSave(withBonus));
  check('save round-trips best gravity-assist bonus',
    bonusBack.bestBonus[1] === 300 && bonusBack.bestBonus[4] === 100);
  check('save clamps best bonus to 0..9999 and drops non-campaign levels',
    (() => {
      const s = parseSave('{"bestBonus":{"1":99999,"13":100,"2":-50,"3":"many"}}');
      return s.bestBonus[1] === 9999 && !('13' in s.bestBonus)
        && s.bestBonus[2] === 0 && !('3' in s.bestBonus);
    })());
  check('v1 save migrates best bonus to empty',
    Object.keys(parseSave('{"stars":{"1":3}}').bestBonus).length === 0);
}

// --- v2 Block 1: fuel orbs (#12) + mid-flight thrust (the new core) ---
{
  // Orb pricing: 50 by default, custom `points` clamped to 10..500.
  check('orb points default to 50 and clamp custom values to 10..500',
    ORB_POINTS === 50 && orbPoints({}) === 50 && orbPoints({ points: 150 }) === 150
    && orbPoints({ points: 5 }) === 10 && orbPoints({ points: 999 }) === 500
    && orbPoints({ points: NaN }) === 50 && orbPoints(null) === 50);
  check('orb radius defaults to 0.9 and rejects bad values',
    ORB_RADIUS === 0.9 && orbRadius({}) === 0.9 && orbRadius({ r: 1.2 }) === 1.2
    && orbRadius({ r: -1 }) === 0.9 && orbRadius({ r: NaN }) === 0.9);
  // Feedback tiers: orb and thrust are small events (0.10-0.20 trauma,
  // no hit-stop) so a pickup or a burn never shakes the camera like a
  // crash.
  const small = FEEDBACK_TIERS.small;
  check('orb + thrust feedback sits in the small tier with no hit-stop',
    FEEDBACK.orb && FEEDBACK.orb.trauma >= small.traumaMin && FEEDBACK.orb.trauma <= small.traumaMax
    && FEEDBACK.orb.hitStop === 0
    && FEEDBACK.thrust && FEEDBACK.thrust.trauma >= small.traumaMin && FEEDBACK.thrust.trauma <= small.traumaMax
    && FEEDBACK.thrust.hitStop === 0);
  // Level definitions: every campaign level has 1-2 orbs, the zen level
  // has 2, and every orb is inside the playfield and clear of the pad,
  // planets, targets, black holes, portals and bounce pads.
  const orbClear = (level) => levelOrbs(level).every((o) => {
    if (o.x * o.x + o.y * o.y >= PLAYFIELD_RADIUS * PLAYFIELD_RADIUS) return false;
    if (Math.hypot(o.x - level.pad.x, o.y - level.pad.y) < 3) return false;
    if (level.targets.some((t) => Math.hypot(o.x - t.x, o.y - t.y) < t.r + ORB_RADIUS + 0.5)) return false;
    if (level.planets.some((p) => Math.hypot(o.x - p.x, o.y - p.y) < p.r + ORB_RADIUS + 0.5)) return false;
    if (levelBlackHoles(level).some((b) => Math.hypot(o.x - b.x, o.y - b.y) < b.r + ORB_RADIUS + 0.5)) return false;
    if (levelPortals(level).some((p) => Math.hypot(o.x - p.x, o.y - p.y) < p.r + ORB_RADIUS + 0.5)) return false;
    if (levelBouncePads(level).some((p) => Math.hypot(o.x - p.x, o.y - p.y) < p.r + ORB_RADIUS + 0.5)) return false;
    // A moving planet must never sweep over an orb mid-flight.
    if (level.planets.some((p) => p.orbit
      && Math.abs(Math.hypot(o.x, o.y) - p.orbit.radius) < p.r + ORB_RADIUS + 0.5)) return false;
    return true;
  });
  check('every campaign level has 1-3 fuel orbs',
    LEVELS.every((l) => levelOrbs(l).length >= 1 && levelOrbs(l).length <= 3));
  check('every campaign orb is placed clear of everything it could overlap', LEVELS.every(orbClear));
  check('zen sandbox has 2 orbs, both clear', levelOrbs(zenLevel()).length === 2 && orbClear(zenLevel()));
  // launchState carries the attempt's banked orbs (copied, never shared)
  // and a full fuel tank.
  check('launchState copies banked orbs and starts with a full tank',
    (() => {
      const banked = [0];
      const s = launchState(LEVELS[0], 0, 0.5, 0, {}, banked);
      banked.push(1);
      return s.orbsCollected.length === 1 && s.orbsCollected[0] === 0
        && s.fuel === FUEL_MAX && s.fuelUsed === 0 && s.thrustTime === 0;
    })());
  // Orb mechanics on a synthetic level: a straight shot through an orb
  // banks +50 once, and a later shot with it banked never re-collects.
  const orbLevel = {
    id: 999, name: 'Orb Test', par: 2,
    pad: { x: -14, y: 0 },
    planets: [{ x: 0, y: 8, r: 2, mu: 10, color: 0x7c3aed }],
    targets: [{ x: 14, y: 0, r: 1.6 }],
    orbs: [{ x: 0, y: 0 }, { x: 6, y: 0, points: 150 }],
  };
  const collectOrbs = (level, angle, power, banked) => {
    const state = launchState(level, angle, power, 0, {}, banked);
    const collected = [];
    let steps = 0;
    let lastEv = null;
    while (!state.done && steps < 2000) {
      const newly = [];
      const ev = stepFlight(state, level, SUBSTEP, collected, newly);
      steps++;
      if (ev && ev.type === 'orb') lastEv = ev;
      if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout')) break;
    }
    return { state, lastEv, steps };
  };
  check('flying through an orb fires an orb event and banks it',
    (() => {
      const { state, lastEv } = collectOrbs(orbLevel, 0, 0.5, []);
      return lastEv && lastEv.type === 'orb'
        && state.orbsCollected.length === 2;
    })());
  check('an orb banked this attempt never fires again on a later shot',
    (() => {
      const { state, lastEv } = collectOrbs(orbLevel, 0, 0.5, [0, 1]);
      return lastEv === null && state.orbsCollected.length === 2;
    })());
  check('simulateLaunch reports orbs banked and their points',
    (() => {
      const sim = simulateLaunch(orbLevel, 0, 0.5, [], { record: false });
      return sim.orbs.length === 2 && sim.orbPoints === 200
        && sim.orbsCollected.length === 2 && sim.outcome !== 'crash';
    })());
  check('previewShot reports the orbs a shot would bank',
    (() => {
      const prev = previewShot(orbLevel, 0, 0.5, [], 0, {}, []);
      return prev.orbs.length === 2 && prev.orbPoints === 200;
    })());
  check('previewShot with banked orbs reports none left to bank',
    (() => {
      const prev = previewShot(orbLevel, 0, 0.5, [], 0, {}, [0, 1]);
      return prev.orbs.length === 0 && prev.orbPoints === 0;
    })());
  // The thrust solver's first shot on level 1 collects both targets —
  // the level is flyable, not just aimable.
  check('level 1 thrust plan collects both targets in one shot',
    (() => {
      const plan = solveLevelThrust(LEVELS[0], LEVELS[0].par);
      return plan && plan.shots === 1 && plan.lines[0].collected === 2;
    })());
  // Generated levels: at most one orb, placed clear like the handcrafted
  // ones (the generator retries offsets until the clearances hold).
  check('generated levels carry 0-1 orbs, always placed clear',
    (() => {
      for (const seed of [1, 7, 42, 777, 12345, 999999]) {
        const g = generateLevel(seed, 2 + (seed % 3), 901);
        if (levelOrbs(g).length > 1 || !orbClear(g)) return false;
      }
      return true;
    })());
  // Thrust: fuel-limited steering. Constants, cost, availability, the
  // velocity change, the empty-tank refusal, and the orb refill.
  check('fuel constants are 100 tank, 32/s burn, 15 accel, +40 per orb, cruise 9',
    FUEL_MAX === 100 && FUEL_BURN_RATE === 32 && THRUST_ACCEL === 15
    && FUEL_ORB_REFILL === 40 && THRUST_CRUISE_SPEED === 9);
  check('fuelCost charges 32 per second of burn', fuelCost(1) === 32 && fuelCost(0.5) === 16 && fuelCost(0) === 0);
  check('canThrust is true on a fresh flight, false with an empty tank or a finished flight',
    (() => {
      const fresh = launchState(LEVELS[0], 0, 0.5);
      const empty = launchState(LEVELS[0], 0, 0.5);
      empty.fuel = 0;
      const done = launchState(LEVELS[0], 0, 0.5);
      done.done = true;
      return canThrust(fresh) && !canThrust(empty) && !canThrust(done) && !canThrust(null);
    })());
  check('thrust accelerates the comet toward the burn direction and drains fuel',
    (() => {
      const state = launchState(orbLevel, 0, 0.25);
      const collected = [];
      const vx0 = state.vx, vy0 = state.vy;
      // Burn straight up (+y) for 0.5s: vy must rise, fuel must fall by 16.
      for (let step = 0; step < 60; step++) {
        stepFlight(state, orbLevel, SUBSTEP, collected, [], { x: 0, y: 1 });
        if (state.done) break;
      }
      return state.vy > vy0 + 3 && Math.abs(state.vx - vx0) < 2
        && Math.abs(state.fuel - (FUEL_MAX - 16)) < 1 && state.fuelUsed > 0
        && state.thrustTime > 0.4;
    })());
  check('an empty tank burns nothing and changes nothing',
    (() => {
      // Two identical flights, one "burning" with an empty tank: gravity
      // still acts on both, so the velocities must stay exactly equal —
      // the burn adds nothing.
      const run = (thrust) => {
        const state = launchState(orbLevel, 0, 0.25);
        state.fuel = 0;
        stepFlight(state, orbLevel, SUBSTEP, [], [], thrust);
        return state;
      };
      const a = run({ x: 0, y: 1 });
      const b = run(null);
      return a.fuel === 0 && b.fuel === 0
        && Math.abs(a.vx - b.vx) < 1e-12 && Math.abs(a.vy - b.vy) < 1e-12
        && a.fuelUsed === 0 && a.thrustTime === 0;
    })());
  check('flying through an orb refills the tank by 40 (clamped at 100)',
    (() => {
      const { state } = collectOrbs(orbLevel, 0, 0.5, []);
      // The straight shot banks both orbs; the tank started full, so it
      // stays clamped at 100 — prove the refill path instead with a
      // half-empty tank on a second pass through the same level.
      const s2 = launchState(orbLevel, 0, 0.5);
      s2.fuel = 50;
      const collected = [];
      let ev = null;
      for (let step = 0; step < 2000 && !s2.done; step++) {
        const newly = [];
        ev = stepFlight(s2, orbLevel, SUBSTEP, collected, newly);
        if (ev && ev.type === 'orb') break;
        if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout')) break;
      }
      return state.orbsCollected.length === 2 && ev && ev.type === 'orb'
        && Math.abs(s2.fuel - 90) < 1e-6;
    })());
  check('thrust steering pushes the comet measurably off the ballistic arc',
    (() => {
      // Two identical straight shots, one burning up for 0.5s: after 1s
      // of flight the steered comet must be clearly above the plain one.
      const run = (burn) => {
        const state = launchState(orbLevel, 0, 0.25);
        const collected = [];
        for (let step = 0; step < 120; step++) {
          stepFlight(state, orbLevel, SUBSTEP, collected, [],
            burn && step < 60 ? { x: 0, y: 1 } : null);
          if (state.done) break;
        }
        return state.y;
      };
      return run(true) > run(false) + 1;
    })());
  // Anti-slop gate (v2 quality gate): NO level may be cleared in par by
  // pure ballistics — the bot must not one-shot the game by aiming
  // alone — and EVERY level must be clearable in par with thrust.
  // If either side fails, the level is not done.
  check('anti-slop: ballistic solver clears NO level within par',
    LEVELS.every((l) => solveLevel(l, l.par) === null));
  check('anti-slop: thrust solver clears EVERY level within par',
    LEVELS.every((l) => solveLevelThrust(l, l.par) !== null));
}

// --- v2 Block 2: ship upgrades (#1-2) + boost pads (#3) ---
{
  // Upgrade table: two upgrades, Ion Thrusters at 15 stars (+25% burn
  // force), Big Tank at 30 stars (+30% fuel). Unknown ids never unlock.
  check('two ship upgrades: thrust at 15 stars, tank at 30 stars',
    UPGRADES.length === 2
    && upgradeById('thrust').unlockStars === 15
    && upgradeById('tank').unlockStars === 30
    && upgradeById('thrust').name === 'Ion Thrusters'
    && upgradeById('tank').name === 'Big Tank');
  check('upgrade multipliers are +25% thrust and +30% tank',
    THRUST_UPGRADE_MULT === 1.25 && TANK_UPGRADE_MULT === 1.30
    && upgradeById('thrust').thrustMult === 1.25
    && upgradeById('tank').tankMult === 1.30);
  check('upgradeUnlocked gates on total stars and rejects unknown ids',
    upgradeUnlocked('thrust', 15) && !upgradeUnlocked('thrust', 14)
    && upgradeUnlocked('tank', 30) && !upgradeUnlocked('tank', 29)
    && !upgradeUnlocked('warp', 99) && !upgradeUnlocked('thrust', NaN));
  check('loadoutMultipliers sanitizes: null is the base ship, non-booleans and unknown keys ignored',
    JSON.stringify(loadoutMultipliers(null)) === JSON.stringify({ thrust: 1, tank: 1 })
    && JSON.stringify(loadoutMultipliers({ thrust: 'yes', tank: 1, warp: true })) === JSON.stringify({ thrust: 1, tank: 1 })
    && JSON.stringify(loadoutMultipliers({ thrust: true, tank: true })) === JSON.stringify({ thrust: 1.25, tank: 1.3 }));
  // activeLoadout: equipped AND unlocked — a flag above its unlock
  // never flies, so a stale or hand-edited save cannot cheat. The
  // campaign has 6 levels (18 stars max) in Block 2, so the 30-star
  // Big Tank cannot unlock yet — it unlocks when levels 7-12 land in
  // Block 6. The 30-star case below simulates that future campaign
  // with extra star keys (totalStars just sums the save's stars).
  const saveWith = (stars, upgrades) => {
    const s = defaultSave();
    s.stars = stars;
    s.upgrades = upgrades;
    return s;
  };
  check('activeLoadout applies only equipped AND unlocked upgrades',
    JSON.stringify(activeLoadout(saveWith({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 }, { thrust: true, tank: true })))
      === JSON.stringify({ thrust: true, tank: false })
    && JSON.stringify(activeLoadout(saveWith({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 }, { thrust: true, tank: true })))
      === JSON.stringify({ thrust: true, tank: false })
    && JSON.stringify(activeLoadout(saveWith(
      { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3 }, { thrust: true, tank: true })))
      === JSON.stringify({ thrust: true, tank: true })
    && JSON.stringify(activeLoadout(saveWith({ 1: 3, 2: 3, 3: 3, 4: 3 }, { thrust: true, tank: false })))
      === JSON.stringify({ thrust: false, tank: false })
    && JSON.stringify(activeLoadout(defaultSave())) === JSON.stringify({ thrust: false, tank: false }));
  // The tank upgrade changes the flight: a Big Tank launch starts at
  // 130 fuel, the base ship at 100.
  check('Big Tank launch starts with a 130 fuel tank, base ship with 100',
    launchState(LEVELS[0], 0, 0.5, 0, {}, [], { tank: true }).fuel === 130
    && launchState(LEVELS[0], 0, 0.5, 0, {}, [], { tank: true }).fuelMax === 130
    && launchState(LEVELS[0], 0, 0.5).fuel === 100
    && launchState(LEVELS[0], 0, 0.5).fuelMax === 100);
  // The thrust upgrade changes the burn: the same 0.5s hold pushes the
  // upgraded comet 25% further up (15 -> 18.75 accel, no gravity here).
  check('Ion Thrusters burn 25% harder than the base ship',
    (() => {
      const run = (loadout) => {
        // No planets on this arc: use a bare level so gravity cannot
        // muddy the delta-v comparison.
        const bare = { ...LEVELS[0], planets: [], targets: [], orbs: [], boostPads: [] };
        const s2 = launchState(bare, 0, 0, 0, {}, [], loadout);
        for (let step = 0; step < 60; step++) {
          stepFlight(s2, bare, SUBSTEP, [], [], { x: 0, y: 1 });
        }
        return s2.vy;
      };
      const base = run(null);
      const up = run({ thrust: true });
      return Math.abs(base - 7.5) < 0.01 && Math.abs(up - 9.375) < 0.01;
    })());
  // Boost pad constants: +50 fuel, +6 speed along the flight direction.
  check('boost pad constants are +50 fuel and +6 speed, radius 1.4',
    BOOST_PAD_REFILL === 50 && BOOST_PAD_KICK === 6 && BOOST_PAD_RADIUS === 1.4
    && boostPadRadius({}) === 1.4 && boostPadRadius({ r: 2 }) === 2 && boostPadRadius({ r: -1 }) === 1.4);
  check('boost feedback sits in the small tier with no hit-stop',
    FEEDBACK.boost && FEEDBACK.boost.trauma >= FEEDBACK_TIERS.small.traumaMin
    && FEEDBACK.boost.trauma <= FEEDBACK_TIERS.small.traumaMax && FEEDBACK.boost.hitStop === 0);
  // A straight shot through a pad: the pad fires once (event type
  // 'boost'), refills the tank by 50 and kicks the speed by ~6 — and a
  // second pass through the same pad in the same shot does nothing.
  check('flying through a boost pad refills +50 fuel and kicks speed +6, once per shot',
    (() => {
      const padLevel = {
        id: 901, name: 'Pad Test', par: 1, pad: { x: -14, y: 0 },
        planets: [], targets: [{ x: 18, y: 0, r: 1.6 }],
        boostPads: [{ x: 0, y: 0 }],
      };
      const state = launchState(padLevel, 0, 0.5);
      state.fuel = 50;
      const speedBefore = Math.hypot(state.vx, state.vy);
      const collected = [];
      let ev = null;
      let steps = 0;
      while (!state.done && steps < 2000) {
        const newly = [];
        ev = stepFlight(state, padLevel, SUBSTEP, collected, newly);
        steps++;
        if (ev && ev.type === 'boost') break;
        if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout')) break;
      }
      if (!ev || ev.type !== 'boost') return false;
      const speedAfter = Math.hypot(state.vx, state.vy);
      // Refill: 50 + 50 = 100 (clamped at the 100 tank). Kick: 11 -> ~17.
      if (Math.abs(state.fuel - 100) > 1e-6) return false;
      if (Math.abs(speedAfter - speedBefore - BOOST_PAD_KICK) > 0.01) return false;
      // The pad is spent: stepping on through it again fires nothing.
      let secondBoost = false;
      for (let i = 0; i < 600 && !state.done; i++) {
        const newly = [];
        const ev2 = stepFlight(state, padLevel, SUBSTEP, collected, newly);
        if (ev2 && ev2.type === 'boost') secondBoost = true;
        if (ev2 && (ev2.type === 'collect' || ev2.type === 'lost' || ev2.type === 'crash')) break;
      }
      return !secondBoost && state.boostedPads.length === 1;
    })());
  check('simulateLaunch reports boosts taken on the shot',
    (() => {
      const padLevel = {
        id: 901, name: 'Pad Test', par: 1, pad: { x: -14, y: 0 },
        planets: [], targets: [{ x: 18, y: 0, r: 1.6 }],
        boostPads: [{ x: 0, y: 0 }],
      };
      const sim = simulateLaunch(padLevel, 0, 0.5);
      return sim.boosts === 1 && sim.outcome === 'collected';
    })());
  // Placement: exactly one pad per campaign level, inside the
  // playfield, overlapping nothing it could sit on top of — but pads
  // ARE allowed to sit close to a planet or black hole (that is the
  // risk/reward), so the clearance is overlap-only, not the orb margin.
  const padClear = (level) => levelBoostPads(level).every((pad) => {
    if (pad.x * pad.x + pad.y * pad.y >= PLAYFIELD_RADIUS * PLAYFIELD_RADIUS) return false;
    if (Math.hypot(pad.x - level.pad.x, pad.y - level.pad.y) < 3) return false;
    if (level.targets.some((t) => Math.hypot(pad.x - t.x, pad.y - t.y) < t.r + BOOST_PAD_RADIUS)) return false;
    if (level.planets.some((p) => {
      if (p.orbit) {
        // A moving planet must never sweep over the pad: the closest
        // its centre ever gets is |dist(pad, orbit centre) - radius|.
        const d = Math.abs(Math.hypot(pad.x - p.orbit.cx, pad.y - p.orbit.cy) - p.orbit.radius);
        return d < p.r + BOOST_PAD_RADIUS;
      }
      return Math.hypot(pad.x - p.x, pad.y - p.y) < p.r + BOOST_PAD_RADIUS;
    })) return false;
    if (levelBlackHoles(level).some((b) => Math.hypot(pad.x - b.x, pad.y - b.y) < b.r + BOOST_PAD_RADIUS)) return false;
    if (levelPortals(level).some((p) => Math.hypot(pad.x - p.x, pad.y - p.y) < p.r + BOOST_PAD_RADIUS)) return false;
    if (levelBouncePads(level).some((p) => Math.hypot(pad.x - p.x, pad.y - p.y) < p.r + BOOST_PAD_RADIUS)) return false;
    if (levelOrbs(level).some((o) => Math.hypot(pad.x - o.x, pad.y - o.y) < ORB_RADIUS + BOOST_PAD_RADIUS)) return false;
    return true;
  });
  check('every campaign level has exactly one boost pad', LEVELS.every((l) => levelBoostPads(l).length === 1));
  check('every campaign boost pad is placed clear (overlap-free)', LEVELS.every(padClear));
  // Save round-trip: upgrades persist, unknown ids are dropped, and a
  // v3 save (no upgrades field) migrates with both upgrades off.
  check('save round-trips equipped upgrades',
    (() => {
      const s = defaultSave();
      s.stars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 };
      s.upgrades = { thrust: true, tank: false };
      const back = parseSave(serializeSave(s));
      return back.upgrades.thrust === true && back.upgrades.tank === false && back.version === SAVE_VERSION;
    })());
  check('save drops unknown upgrade ids and non-booleans',
    (() => {
      const s = defaultSave();
      s.upgrades = { thrust: true, warp: true, tank: 'yes' };
      const back = parseSave(serializeSave(s));
      return back.upgrades.thrust === true && back.upgrades.tank === false && !('warp' in back.upgrades);
    })());
  check('v3 save migrates with both upgrades off',
    (() => {
      const back = parseSave(JSON.stringify({ version: 3, stars: { 1: 3 }, unlocked: 2 }));
      return back.version === SAVE_VERSION && back.upgrades.thrust === false && back.upgrades.tank === false
        && back.stars[1] === 3 && back.unlocked === 2;
    })());
  // Upgrades never break solvability: the thrust solver still clears
  // every level in par with the full loadout equipped.
  check('thrust solver clears EVERY level within par with full upgrades',
    LEVELS.every((l) => solveLevelThrust(l, l.par, { loadout: { thrust: true, tank: true } }) !== null));
  // Beam search (Block 2, #3): the thrust solver keeps distinct
  // opening lines, so a greedy opener that strands the shielded star
  // falls through to the next-best line instead of failing the level.
  check('thrust solver returns distinct top opening lines for level 6',
    (() => {
      const tops = solveShotThrustTop(LEVELS[5], [], {}, 3);
      if (tops.length < 2) return false;
      const angleDiff = (a, b) => {
        const d = Math.abs(a - b) % (Math.PI * 2);
        return Math.min(d, Math.PI * 2 - d);
      };
      for (let i = 1; i < tops.length; i++) {
        for (let j = 0; j < i; j++) {
          const distinct = angleDiff(tops[i].angle, tops[j].angle) > (6 * Math.PI) / 180
            || Math.abs(tops[i].power - tops[j].power) > 0.1;
          if (!distinct) return false;
        }
      }
      return true;
    })());
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failing checks:', failures.join(' | '));
  process.exit(1);
}
