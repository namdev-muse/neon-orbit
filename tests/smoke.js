// Neon Orbit — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, LEVELS, MAX_SPEED, PLAYFIELD_RADIUS, SUBSTEP, levelById, shotBudget,
  starsForShots, starThresholds, isLevelComplete, mulberry32, generateDecor,
  launchState, stepFlight, simulateLaunch, previewShot,
  defaultSave, serializeSave, parseSave, totalStars,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// --- level definitions ---
check('6 levels defined', LEVELS.length === 6);
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
check('pars are 2,3,3,3,4,5',
  LEVELS.map((l) => l.par).join(',') === '2,3,3,3,4,5');
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
  check('physics version is 0.2.0', VERSION === '0.2.0');
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

// --- save round-trip ---
{
  const save = defaultSave();
  check('default save unlocks only level 1', save.unlocked === 1 && Object.keys(save.stars).length === 0);
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
    Object.keys(parseSave('{"stars":{"9":3}}').stars).length === 0);
  check('save drops out-of-range star counts',
    Object.keys(parseSave('{"stars":{"1":9}}').stars).length === 0);
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Failing checks:', failures.join(' | '));
  process.exit(1);
}
