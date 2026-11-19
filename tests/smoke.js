// Neon Orbit — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, LEVELS, MAX_SPEED, PLAYFIELD_RADIUS, SUBSTEP, levelById, shotBudget,
  starsForShots, starThresholds, isLevelComplete, mulberry32, generateDecor,
  launchState, stepFlight, simulateLaunch, previewShot, planetPosAt,
  levelHasMovingPlanets, levelBlackHoles, FEEDBACK, FEEDBACK_TIERS,
  NEAR_MISS_BAND, isNearMiss, COMET_RADIUS,
  defaultSave, serializeSave, parseSave, totalStars,
  dateSeed, dateKey, seedFromString, parseSeedParam, dailyDifficulty,
  endlessDifficulty, generateLevel, registerGeneratedLevel, solveShot, solveLevel,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// --- level definitions ---
check('8 levels defined', LEVELS.length === 8);
check('level ids are 1..8 in order', LEVELS.every((l, i) => l.id === i + 1));
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
check('no target overlaps a black hole',
  LEVELS.every((l) => l.targets.every((t) => levelBlackHoles(l).every((b) => {
    const dx = t.x - b.x, dy = t.y - b.y;
    return dx * dx + dy * dy > (b.r + t.r + 1) * (b.r + t.r + 1);
  }))));
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
  check('physics version is 0.6.0', VERSION === '0.6.0');
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
  check('save clamps unlocked into range', parseSave('{"unlocked":99}').unlocked === 8);
  check('save drops stars for unknown levels',
    Object.keys(parseSave('{"stars":{"9":3}}').stars).length === 0);
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
  check('save drops a daily best with a bad date',
    parseSave('{"daily":{"date":"yesterday","stars":3}}').daily === null);
  check('save drops a daily best with out-of-range stars',
    parseSave('{"daily":{"date":"2026-11-20","stars":9}}').daily === null);
  check('save drops out-of-range seed bests',
    Object.keys(parseSave('{"seedBest":{"x":9}}').seedBest).length === 0);
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failing checks:', failures.join(' | '));
  process.exit(1);
}
