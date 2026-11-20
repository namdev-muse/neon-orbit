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
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// --- level definitions ---
check('12 levels defined', LEVELS.length === 12);
check('level ids are 1..12 in order', LEVELS.every((l, i) => l.id === i + 1));
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
check('level 7 has a black hole', levelBlackHoles(LEVELS[6]).length === 1);
check('level 8 has a moving planet', levelHasMovingPlanets(LEVELS[7]));
check('level 9 has one portal pair', levelPortals(LEVELS[8]).length === 2
  && (LEVELS[8].portals[0].pair ?? 0) === (LEVELS[8].portals[1].pair ?? 0));
check('level 10 has two shielded targets',
  LEVELS[9].targets.length === 2 && LEVELS[9].targets.every((t) => targetHits(t) === 2));
check('level 11 has one bounce pad', levelBouncePads(LEVELS[10]).length === 1);
check('level 12 has two moving targets',
  LEVELS[11].targets.length === 2 && levelHasMovingTargets(LEVELS[11])
  && levelMovingTargets(LEVELS[11]).length === 2);
check('levels 1-11 have no moving targets',
  LEVELS.slice(0, 11).every((l) => !levelHasMovingTargets(l)));
check('levels 1-8 have no portals, bounce pads or shielded targets',
  LEVELS.slice(0, 8).every((l) => levelPortals(l).length === 0
    && levelBouncePads(l).length === 0
    && l.targets.every((t) => targetHits(t) === 1)));
check('levels 1-6 have no black holes or moving planets',
  LEVELS.slice(0, 6).every((l) => levelBlackHoles(l).length === 0 && !levelHasMovingPlanets(l)));
check('levelById finds level 4', levelById(4) && levelById(4).name === 'The Long Way');
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
  isLevelComplete(LEVELS[2], [0, 1]) === true);
check('level not complete with targets left',
  isLevelComplete(LEVELS[2], [0]) === false);

// --- trajectory preview prediction ---
{
  check('physics version is 0.16.0', VERSION === '0.16.0');
  const lvl = LEVELS[0];
  const hit = previewShot(lvl, 0, 0.55);
  check('preview of the level 1 line predicts a target hit',
    (hit.outcome === 'collected' || hit.outcome === 'partial') && hit.collected.length === 1);
  check('preview records trajectory points starting at the pad',
    hit.points.length > 10 && hit.points[0][0] === lvl.pad.x && hit.points[0][1] === lvl.pad.y);
  check('preview end sits on the collected target',
    Math.hypot(hit.end.x - lvl.targets[0].x, hit.end.y - lvl.targets[0].y) < lvl.targets[0].r + 1);
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
  const res = simulateLaunch(lvl, 0, 0.55);
  check('level 1 near-straight shot collects the target',
    res.collected.length === 1 && (res.outcome === 'collected' || res.outcome === 'partial'));
  const already = simulateLaunch(lvl, 0, 0.55, [0]);
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
  const lvl8 = LEVELS[7];
  const a = simulateLaunch(lvl8, 0.2, 0.7, [], { record: true, t0: 0 });
  const b = simulateLaunch(lvl8, 0.2, 0.7, [], { record: true, t0: 3 });
  check('same launch at a different level time flies a different path',
    JSON.stringify(a.points) !== JSON.stringify(b.points));
  const a2 = simulateLaunch(lvl8, 0.2, 0.7, [], { record: true, t0: 0 });
  check('same launch at the same level time is deterministic',
    JSON.stringify(a.points) === JSON.stringify(a2.points));
  const pA = previewShot(lvl8, 0.2, 0.7, [], 0);
  const pB = previewShot(lvl8, 0.2, 0.7, [], 3);
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

  // The verified Level 4 line (-20deg, power 0.3) grazes the planet
  // inside the band while collecting — the render check's slingshot line.
  {
    const lvl = LEVELS[3];
    const s = launchState(lvl, (-20 * Math.PI) / 180, 0.3);
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

  // The solver: the shared grid search the bot and the generator use.
  const solved = solveShot(LEVELS[0], []);
  check('solver finds a collecting shot on level 1', solved && solved.res.collected.length === 1);
  const plan = solveLevel(LEVELS[5], shotBudget(LEVELS[5]));
  check('solver completes level 6 within budget', !!plan && plan.shots <= shotBudget(LEVELS[5]));
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
  check('save clamps unlocked into range', parseSave('{"unlocked":99}').unlocked === 12);
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

  // The solver completes all three new levels within budget, with the
  // portal and bounce lines actually using the new mechanics.
  for (const level of LEVELS.slice(8)) {
    const plan = solveLevel(level, shotBudget(level));
    check(`solver completes level ${level.id} "${level.name}" within budget`,
      !!plan && plan.shots <= shotBudget(level));
    if (plan) {
      check(`solver earns at least 1 star on level ${level.id}`,
        starsForShots(plan.shots, level.par) >= 1);
    }
  }
  {
    const plan9 = solveLevel(LEVELS[8], shotBudget(LEVELS[8]));
    const usesPortal = plan9 && plan9.lines.some((l) => {
      const res = simulateLaunch(LEVELS[8], l.angle, l.power, [], { record: false, t0: l.t0 });
      return res.portalUses >= 1;
    });
    check('level 9 solver plan uses the portal', !!usesPortal);
    const plan11 = solveLevel(LEVELS[10], shotBudget(LEVELS[10]));
    const usesBounce = plan11 && plan11.lines.some((l) => {
      const res = simulateLaunch(LEVELS[10], l.angle, l.power, [], { record: false, t0: l.t0 });
      return res.bounces >= 1;
    });
    check('level 11 solver plan uses the bounce pad', !!usesBounce);
    // Level 10 needs at least 4 shots: two shielded targets, two hits each.
    const plan10 = solveLevel(LEVELS[9], shotBudget(LEVELS[9]));
    check('level 10 solver plan takes 4 shots (two hits per shielded target)',
      !!plan10 && plan10.shots === 4);
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
  check('level 12 has two moving targets, level 1 has none',
    levelHasMovingTargets(LEVELS[11]) && !levelHasMovingTargets(LEVELS[0]));

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

  // The solver completes level 12 within budget, timing its launches.
  const plan12 = solveLevel(LEVELS[11], shotBudget(LEVELS[11]));
  check('solver completes level 12 "Moving Stars" within budget',
    !!plan12 && plan12.shots <= shotBudget(LEVELS[11]));
  if (plan12) {
    check('solver earns at least 1 star on level 12',
      starsForShots(plan12.shots, LEVELS[11].par) >= 1);
    check('solver plan on level 12 uses a nonzero launch time (waits for the drift)',
      plan12.lines.some((l) => l.t0 > 0));
  }

  // Difficulty tuning: par is the solver's minimal shot count + 1 slack
  // shot (minimum 2), except level 10 whose par 4 is its designed
  // minimum (two hits per shielded target). Level 6's old slow lob
  // (63deg, power 0.25) collected all three targets; the spread-out,
  // smaller targets break it.
  check('retuned pars: L2=2, L4=2, L5=3, L6=3, L7=2, L8=3, L12=2',
    LEVELS[1].par === 2 && LEVELS[3].par === 2 && LEVELS[4].par === 3
    && LEVELS[5].par === 3 && LEVELS[6].par === 2 && LEVELS[7].par === 3
    && LEVELS[11].par === 2);
  check('unchanged pars: L1=2, L3=3, L9=3, L10=4, L11=3',
    LEVELS[0].par === 2 && LEVELS[2].par === 3 && LEVELS[8].par === 3
    && LEVELS[9].par === 4 && LEVELS[10].par === 3);
  check('every level is still 3-starred by the solver at its new par',
    LEVELS.every((l) => {
      const plan = solveLevel(l, shotBudget(l));
      return !!plan && starsForShots(plan.shots, l.par) === 3;
    }));
  {
    const lob = simulateLaunch(LEVELS[5], (63 * Math.PI) / 180, 0.25);
    check('level 6 slow lob no longer collects all three targets', lob.collected.length < 3);
    const plan6 = solveLevel(LEVELS[5], shotBudget(LEVELS[5]));
    check('level 6 solver now needs 2 shots', !!plan6 && plan6.shots === 2);
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
  // The achievement table: 14 entries, unique ids, every entry has a
  // name, a description and an icon.
  check('14 achievements defined', ACHIEVEMENTS.length === 14);
  check('achievement ids are unique',
    new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
  check('every achievement has a name, description and icon',
    ACHIEVEMENTS.every((a) => a.name.length > 0 && a.desc.length > 0 && a.icon.length > 0));

  // A fresh save earns nothing and starts at schema version 2 with
  // empty lifetime stats and no achievements.
  check('fresh save unlocks no achievements',
    checkAchievements(defaultSave()).length === 0);
  check('default save is schema version 2', defaultSave().version === SAVE_VERSION && SAVE_VERSION === 2);
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
  check('halfway fires at 6 cleared levels',
    earned((s) => { s.stars = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }; }).includes('halfway'));
  check('grand tour fires at 12 cleared levels',
    earned((s) => { s.stars = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 }; }).includes('grand-tour'));
  check('constellation fires at 36 stars',
    earned((s) => { s.stars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3 }; }).includes('constellation'));
  check('gravity dancer fires at 10 slingshots', earned((s) => { s.stats.slingshots = 10; }).includes('slingshot-10'));
  check('down to the wire fires on a last-shot win', earned((s) => { s.stats.lastShotWins = 1; }).includes('last-shot'));
  check('gate crasher fires on 1 portal hop', earned((s) => { s.stats.portals = 1; }).includes('gate-crasher'));
  check('daily grind fires on 1 daily win', earned((s) => { s.stats.dailyWins = 1; }).includes('daily-grind'));
  check('deep space fires at endless best 5', earned((s) => { s.endlessBest = 5; }).includes('deep-space'));
  check('zen master fires at zen best 10', earned((s) => { s.zenBest = 10; }).includes('zen-master'));
  // Thresholds are exact: 9 slingshots, endless 4 and zen 9 earn nothing.
  check('slingshot threshold is exact at 10',
    !earned((s) => { s.stats.slingshots = 9; }).includes('slingshot-10'));
  check('deep space threshold is exact at 5',
    !earned((s) => { s.endlessBest = 4; }).includes('deep-space'));
  check('zen master threshold is exact at 10',
    !earned((s) => { s.zenBest = 9; }).includes('zen-master'));
  // Already-unlocked achievements never re-fire, and a perfect campaign
  // save earns the whole set at once.
  check('already-unlocked achievements do not re-fire',
    (() => { const s = defaultSave(); s.stats.shots = 1; s.achievements = ['first-launch']; return checkAchievements(s).length === 0; })());
  check('a perfect campaign save earns all 14 achievements',
    (() => {
      const s = defaultSave();
      s.stats = { shots: 5, collects: 20, crashes: 2, slingshots: 10, portals: 1, bounces: 1, wins: 12, fails: 1, oneShotClears: 1, lastShotWins: 1, dailyWins: 1 };
      s.stars = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3 };
      s.endlessBest = 5; s.zenBest = 10;
      return checkAchievements(s).length === 14;
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

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failing checks:', failures.join(' | '));
  process.exit(1);
}
