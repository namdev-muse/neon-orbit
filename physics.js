// Neon Orbit — pure physics + level logic.
// No DOM, no Three.js imports: importable from Node (tests) and from game.js.
export const VERSION = '0.15.0';

export const MAX_SPEED = 22; // comet launch speed at full power (units / s)
export const PLAYFIELD_RADIUS = 26; // out of bounds beyond this distance
export const COMET_RADIUS = 0.5;
export const SUBSTEP = 1 / 120; // fixed integration step (s)
export const MAX_SIM_TIME = 10; // a shot that is still flying is lost
export const GRAVITY_SOFTEN = 1.0; // softening scale, multiplied by planet radius

// ---------------------------------------------------------------- game feel
// Feedback tiers from the game-feel skill: small events get 0.10-0.20
// trauma with no hit-stop, medium events 0.30-0.50 trauma with a
// 0.04-0.06s stop, large events 0.70-1.00 trauma with a 0.10-0.15s stop.
// FEEDBACK pins every event kind to its tier so the game stays
// proportional; game.js reads this table, smoke.js asserts the ranges.
export const FEEDBACK_TIERS = {
  small: { traumaMin: 0.10, traumaMax: 0.20, stopMin: 0, stopMax: 0 },
  medium: { traumaMin: 0.30, traumaMax: 0.50, stopMin: 0.04, stopMax: 0.06 },
  large: { traumaMin: 0.70, traumaMax: 1.00, stopMin: 0.10, stopMax: 0.15 },
};
export const FEEDBACK = {
  launch: { tier: 'small', trauma: 0.12, hitStop: 0 },
  collect: { tier: 'small', trauma: 0.18, hitStop: 0 },
  lost: { tier: 'small', trauma: 0.15, hitStop: 0 },
  slingshot: { tier: 'small', trauma: 0.15, hitStop: 0 },
  portal: { tier: 'small', trauma: 0.15, hitStop: 0 },
  bounce: { tier: 'small', trauma: 0.15, hitStop: 0 },
  shieldhit: { tier: 'small', trauma: 0.18, hitStop: 0 },
  win: { tier: 'medium', trauma: 0.30, hitStop: 0.05 },
  swallowed: { tier: 'medium', trauma: 0.50, hitStop: 0.06 },
  crash: { tier: 'large', trauma: 0.85, hitStop: 0.12 },
};

// Near-miss slow-mo (Block 15, #31): a close slingshot dips the time
// scale to SLOW_MO_SCALE for SLOW_MO_MS of real time, so the player can
// watch the bend. Pure helper so Node tests can drive it: 1 outside the
// window, 0.35 inside it, and always 1 under reduce motion or on a
// corrupted clock (a bad timestamp must never freeze the game).
export const SLOW_MO_SCALE = 0.35;
export const SLOW_MO_MS = 450;
export function slowMoScale(nowMs, untilMs, reduceMotion) {
  if (reduceMotion) return 1;
  if (typeof nowMs !== 'number' || typeof untilMs !== 'number'
    || !Number.isFinite(nowMs) || !Number.isFinite(untilMs)) return 1;
  return nowMs < untilMs ? SLOW_MO_SCALE : 1;
}

// Near-miss (slingshot) band: a comet passing within NEAR_MISS_BAND of a
// planet's surface — close enough to feel the bend, far enough to live —
// counts as a slingshot. The crash radius is planet radius + COMET_RADIUS.
export const NEAR_MISS_BAND = 2.0;
export function isNearMiss(dist, planetRadius) {
  const surface = planetRadius + COMET_RADIUS;
  return dist > surface && dist < surface + NEAR_MISS_BAND;
}

// ---------------------------------------------------------------- levels
// One palette, one art direction: violet planets, magenta targets, cyan comet.
export const LEVELS = [
  {
    id: 1, name: 'First Light', par: 2,
    hint: 'Drag back from the comet and release to launch. Bend gently around the planet.',
    pad: { x: -14, y: 0 },
    planets: [{ x: 0, y: 6, r: 2, mu: 80, color: 0x7c3aed }],
    targets: [{ x: 12, y: 0, r: 1.6 }],
  },
  {
    id: 2, name: 'Curveball', par: 2,
    hint: 'The planet sits on the straight line. Aim wide and let gravity bend the shot home.',
    pad: { x: -14, y: -6 },
    planets: [{ x: 0, y: 0, r: 2.5, mu: 170, color: 0x8b5cf6 }],
    targets: [{ x: 12, y: 6, r: 1.6 }],
  },
  {
    id: 3, name: 'Twin Suns', par: 3,
    hint: 'Two planets, two targets. One good slingshot can catch both.',
    pad: { x: -15, y: 0 },
    planets: [
      { x: -2, y: 4, r: 2, mu: 130, color: 0x7c3aed },
      { x: 4, y: -4, r: 2, mu: 130, color: 0x6d28d9 },
    ],
    targets: [{ x: 10, y: 5, r: 1.6 }, { x: 12, y: -6, r: 1.6 }],
  },
  {
    id: 4, name: 'The Long Way', par: 2,
    hint: 'The target hides behind the planet. Slingshot around it — never through it.',
    pad: { x: -14, y: 0 },
    planets: [{ x: 2, y: 0, r: 2.5, mu: 200, color: 0x8b5cf6 }],
    targets: [{ x: 13, y: 0, r: 1.6 }],
  },
  {
    id: 5, name: 'Heavyweight', par: 3,
    hint: 'A massive planet dominates the field. Use its pull, respect its surface.',
    pad: { x: -15, y: -8 },
    planets: [{ x: 0, y: 0, r: 3.5, mu: 320, color: 0x5b21b6 }],
    targets: [{ x: 12, y: 8, r: 1.6 }, { x: 13, y: -7, r: 1.6 }],
  },
  {
    id: 6, name: 'Gauntlet', par: 3,
    hint: 'Three planets, three small targets, a tight shot budget. Chain the bends.',
    pad: { x: -16, y: 0 },
    planets: [
      { x: -4, y: 5, r: 2, mu: 140, color: 0x7c3aed },
      { x: 4, y: -5, r: 2, mu: 140, color: 0x6d28d9 },
      { x: 10, y: 4, r: 2, mu: 140, color: 0x8b5cf6 },
    ],
    // Block 10 difficulty tuning: the old targets sat on one slow lob
    // (63deg, power 0.25 collected all three). The targets are now
    // smaller (r 1.4) and spread further apart, so the lob collects one
    // at most and the solver needs 2 shots.
    targets: [{ x: 16, y: 9, r: 1.4 }, { x: 17, y: -9, r: 1.4 }, { x: 8, y: 12, r: 1.4 }],
  },
  {
    id: 7, name: 'Event Horizon', par: 2,
    hint: 'A black hole guards the target — it pulls hard and swallows comets. Arc over the top and let the planet bend you home.',
    pad: { x: -14, y: 0 },
    planets: [{ x: -2, y: 8, r: 2, mu: 140, color: 0x7c3aed }],
    blackHoles: [{ x: 2, y: 0, r: 1.6, mu: 300 }],
    targets: [{ x: 13, y: 0, r: 1.6 }],
  },
  {
    id: 8, name: 'Carousel', par: 3,
    hint: 'The planet never sits still — it orbits the centre. Time your launch for when the bend lines up.',
    pad: { x: -15, y: 0 },
    planets: [
      {
        x: 7, y: 0, r: 2, mu: 150, color: 0x8b5cf6,
        orbit: { cx: 0, cy: 0, radius: 7, speed: 0.45, phase: 0 },
      },
    ],
    targets: [{ x: 12, y: 7, r: 1.6 }, { x: 13, y: -7, r: 1.6 }],
  },
  {
    id: 9, name: 'Portal Hop', par: 3,
    hint: 'Portals come in pairs — fly into one and you exit the other with the same speed. Use the shortcut to slip past the planet.',
    pad: { x: -15, y: 0 },
    planets: [{ x: 0, y: 0, r: 2.5, mu: 200, color: 0x8b5cf6 }],
    portals: [
      { x: -8, y: -7, r: 1.6, pair: 0 },
      { x: 7, y: 7, r: 1.6, pair: 0 },
    ],
    targets: [{ x: 13, y: -1, r: 1.6 }, { x: 11, y: 9, r: 1.6 }],
  },
  {
    id: 10, name: 'Shielded Stars', par: 4,
    hint: 'Shielded targets take two hits — the first cracks the shield, the second collects the star. Budget your shots.',
    pad: { x: -15, y: 0 },
    planets: [
      { x: -2, y: 5, r: 2, mu: 130, color: 0x7c3aed },
      { x: 3, y: -5, r: 2, mu: 130, color: 0x6d28d9 },
    ],
    targets: [{ x: 12, y: 6, r: 1.6, hits: 2 }, { x: 13, y: -6, r: 1.6, hits: 2 }],
  },
  {
    id: 11, name: 'Bounce House', par: 3,
    hint: 'Bounce pads reflect the comet like a mirror — hit one at an angle and it throws you around the planet.',
    pad: { x: -15, y: -6 },
    planets: [{ x: 0, y: 0, r: 3, mu: 280, color: 0x5b21b6 }],
    bouncePads: [{ x: 4, y: 8, r: 2.2 }],
    targets: [{ x: 13, y: -7, r: 1.6 }, { x: 12, y: 7, r: 1.6 }],
  },
  {
    id: 12, name: 'Moving Stars', par: 2,
    hint: 'The targets drift on small orbits — the faint rings show their paths. Lead your shot so the comet meets the target, not where it was.',
    pad: { x: -15, y: 0 },
    planets: [{ x: 0, y: 0, r: 2.5, mu: 200, color: 0x8b5cf6 }],
    targets: [
      // (x, y) is the position at t = 0: cx + radius * cos(phase).
      { x: 12.5, y: 6, r: 1.6, orbit: { cx: 10, cy: 6, radius: 2.5, speed: 0.35, phase: 0 } },
      { x: 10, y: -6, r: 1.6, orbit: { cx: 12, cy: -6, radius: 2, speed: -0.45, phase: Math.PI } },
    ],
  },
];

// Target position at level time t. Static targets sit at (t.x, t.y);
// a target with `orbit` drifts on a circle around (cx, cy) at `speed`
// rad/s from `phase`. (t.x, t.y) is its position at t = 0.
export function targetPosAt(target, t) {
  if (!target.orbit) return { x: target.x, y: target.y };
  const o = target.orbit;
  const a = o.phase + o.speed * t;
  return { x: o.cx + o.radius * Math.cos(a), y: o.cy + o.radius * Math.sin(a) };
}

export function levelHasMovingTargets(level) {
  return (level.targets || []).some((t) => !!t.orbit);
}

export function levelMovingTargets(level) {
  return (level.targets || []).filter((t) => !!t.orbit);
}

// ---------------------------------------------------------------- time attack
// Time Attack: clear campaign levels 1-5 against one shared clock.
// TIME_ATTACK_SECONDS is the whole run's budget, not per level.
export const TIME_ATTACK_LEVEL_IDS = [1, 2, 3, 4, 5];
export const TIME_ATTACK_SECONDS = 240;

// Clock display: 240 -> "4:00", 222 -> "3:42", 7 -> "0:07".
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- seeded levels
// Challenge modes (daily / seed / endless) all run on generated levels:
// one deterministic generator + one solver, so the same seed always makes
// the same level for everyone, and every generated level is verified
// solvable before it is offered. Generated levels live in a registry so
// levelById / shotBudget / starsForShots work on them exactly like the
// handcrafted campaign levels; they never touch the campaign unlock chain.
const generatedLevels = new Map();

export function registerGeneratedLevel(level) {
  generatedLevels.set(level.id, level);
  return level;
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || generatedLevels.get(id) || null;
}

// Daily seed: YYYYMMDD as a number (20261120) — the same level for
// everyone, every day, and a new one at midnight.
export function dateSeed(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function dateKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

// FNV-1a hash so ?seed=orbit42 is stable, shareable and short.
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A seed parameter accepts a plain number ("777") or any word ("orbit42").
// Returns a uint32 seed, or null for an empty/invalid value.
export function parseSeedParam(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 32);
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return seedFromString(s);
}

// Daily difficulty rotates 2..4 by day of year so the daily puzzle varies.
export function dailyDifficulty(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((date - start) / 86400000);
  return 2 + (doy % 3);
}

// Endless rounds escalate one difficulty step per round.
export function endlessDifficulty(round) {
  return Math.max(1, round);
}

// Auto-aim solver: grid-searches angle/power (and launch times on moving
// levels) for the shot that collects the most, then refines around it.
// `coarse` uses a wide grid for a fast solvability check; the fine grid
// is the bot harness's full search. Returns the best shot found.
export function solveShot(level, collected = [], opts = {}) {
  const coarse = !!opts.coarse;
  const angleStep = coarse ? 8 : 2;
  const powerStep = coarse ? 0.25 : 0.1;
  const powerMin = coarse ? 0.25 : 0.15;
  const t0s = opts.t0s || (levelHasMovingPlanets(level) || levelHasMovingTargets(level)
    ? [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25, 6] : [0]);
  let best = null;
  const score = (res) => {
    let s = res.collected.length * 10000;
    // Cracking a shield is real progress: a shot that cracks but
    // collects nothing still scores above a clean miss, so the solver
    // plans the crack shot first and the collect shot after it.
    s += (res.shieldCracks || 0) * 4000;
    if (res.outcome === 'crash') s -= 5000;
    if (res.outcome === 'swallowed') s -= 5000;
    if (res.outcome === 'timeout') s -= 2000;
    if (res.outcome === 'lost') s -= 500;
    s -= res.steps * 0.05;
    return s;
  };
  const consider = (angle, power, t0) => {
    const res = simulateLaunch(level, angle, power, collected, {
      record: false, t0, shieldHits: opts.shieldHits || {},
    });
    const sc = score(res);
    if (!best || sc > best.score) best = { angle, power, t0, score: sc, res };
  };
  for (const t0 of t0s) {
    for (let deg = 0; deg < 360; deg += angleStep) {
      for (let p = powerMin; p <= 1.001; p += powerStep) {
        consider((deg * Math.PI) / 180, p, t0);
      }
    }
  }
  if (!coarse) {
    for (let d = -2; d <= 2; d += 0.25) {
      for (let dp = -0.1; dp <= 0.1001; dp += 0.02) {
        const angle = best.angle + (d * Math.PI) / 180;
        const power = Math.max(0.05, Math.min(1, best.power + dp));
        consider(angle, power, best.t0);
      }
    }
  }
  return best;
}

// Plays a level shot by shot with the solver. Returns { shots, lines } on
// completion within `budget`, or null when the solver cannot finish it.
// `lines` is the plan (angle/power/t0 per shot) the bot and the generator
// both use; `coarse` keeps the search cheap for generation checks.
export function solveLevel(level, budget, opts = {}) {
  const collected = [];
  // Shield cracks persist across shots: the map the solver threads from
  // one shot to the next is the same one the game keeps in state.
  let shieldHits = opts.shieldHits ? { ...opts.shieldHits } : {};
  const lines = [];
  let shots = 0;
  while (collected.length < level.targets.length && shots < budget) {
    const best = solveShot(level, collected, { ...opts, shieldHits });
    if (!best) return null;
    shots++;
    lines.push({ angle: best.angle, power: best.power, t0: best.t0 });
    shieldHits = best.res.shieldHits || shieldHits;
    for (const i of best.res.collected) {
      if (!collected.includes(i)) collected.push(i);
    }
  }
  if (collected.length < level.targets.length) return null;
  return { shots, lines };
}

const GENERATED_NAMES = [
  'Stardust Drift', 'Nebula Pass', 'Gravity Well', 'Comet Run',
  'Slingshot Alley', 'Void Crossing', 'Starlight Bend', 'Orbit Dance',
  'Deep Field', 'Perihelion',
];

// One candidate layout from a seeded RNG. Planets sit on the pad -> target
// corridor with a perpendicular offset, so most candidates are bendable
// and the solver usually passes on the first try.
function genCandidate(rand, difficulty) {
  const targetCount = Math.min(3, 1 + Math.floor(difficulty / 2) + (rand() < 0.3 ? 1 : 0));
  const planetCount = Math.min(3, 1 + Math.floor(difficulty / 2));
  const pad = { x: -16 + rand() * 2, y: (rand() * 2 - 1) * 8 };
  const targets = [];
  const xs = [];
  for (let i = 0; i < targetCount; i++) xs.push(10 + rand() * 6);
  if (targetCount === 1) {
    targets.push({ x: xs[0], y: (rand() * 2 - 1) * 9, r: 1.6 });
  } else if (targetCount === 2) {
    targets.push({ x: xs[0], y: 3 + rand() * 7, r: 1.6 });
    targets.push({ x: xs[1], y: -3 - rand() * 7, r: 1.6 });
  } else {
    const ys = [7 + rand() * 4, -1 + rand() * 2, -7 - rand() * 4];
    for (let i = 0; i < 3; i++) targets.push({ x: xs[i], y: ys[i], r: 1.6 });
  }
  const cx = targets.reduce((a, t) => a + t.x, 0) / targets.length;
  const cy = targets.reduce((a, t) => a + t.y, 0) / targets.length;
  const dx = cx - pad.x, dy = cy - pad.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // perpendicular to the corridor
  const colors = [0x7c3aed, 0x8b5cf6, 0x6d28d9, 0x5b21b6];
  const planets = [];
  for (let i = 0; i < planetCount; i++) {
    const r = 1.8 + rand() * 1.2;
    const mu = 100 + rand() * 180 + difficulty * 10;
    let placed = null;
    for (let tries = 0; tries < 25 && !placed; tries++) {
      const t = 0.3 + rand() * 0.4;
      const off = (rand() * 2 - 1) * 7;
      const x = pad.x + dx * t + px * off;
      const y = pad.y + dy * t + py * off;
      if (x * x + y * y > (PLAYFIELD_RADIUS - 2) * (PLAYFIELD_RADIUS - 2)) continue;
      if (Math.hypot(x - pad.x, y - pad.y) < r + 2.5) continue;
      if (targets.some((tg) => Math.hypot(x - tg.x, y - tg.y) < r + tg.r + 1.2)) continue;
      if (planets.some((q) => Math.hypot(x - q.x, y - q.y) < r + q.r + 1.5)) continue;
      placed = { x, y, r, mu, color: colors[i % colors.length] };
    }
    if (placed) planets.push(placed);
  }
  const blackHoles = [];
  if (difficulty >= 3 && rand() < 0.5) {
    const tg = targets[Math.floor(rand() * targets.length)];
    for (let tries = 0; tries < 20; tries++) {
      const a = rand() * Math.PI * 2;
      const d = 4.5 + rand() * 2;
      const x = tg.x + Math.cos(a) * d, y = tg.y + Math.sin(a) * d;
      if (x * x + y * y > (PLAYFIELD_RADIUS - 2) * (PLAYFIELD_RADIUS - 2)) continue;
      if (Math.hypot(x - pad.x, y - pad.y) < 4) continue;
      if (planets.some((q) => Math.hypot(x - q.x, y - q.y) < q.r + 3)) continue;
      if (targets.some((t) => Math.hypot(x - t.x, y - t.y) < t.r + 3)) continue;
      blackHoles.push({ x, y, r: 1.4 + rand() * 0.4, mu: 260 + rand() * 90 });
      break;
    }
  }
  if (difficulty >= 2 && rand() < 0.45 && planets.length > 0) {
    const p = planets[Math.floor(rand() * planets.length)];
    const radius = Math.min(18, Math.max(4, Math.hypot(p.x, p.y)));
    // The orbit circle must stay clear of the pad and every target, or
    // the planet would sweep over them mid-flight.
    const clear = (x, y, extra) => Math.abs(Math.hypot(x, y) - radius) > p.r + extra + 0.5;
    if (clear(pad.x, pad.y, 1.5) && targets.every((t) => clear(t.x, t.y, t.r))) {
      p.orbit = { cx: 0, cy: 0, radius, speed: 0.3 + rand() * 0.35, phase: Math.atan2(p.y, p.x) };
    }
  }
  return { pad, planets, targets, blackHoles };
}

// Builds a deterministic generated level for a seed + difficulty, verified
// solvable by the coarse solver (retries with derived seeds; falls back to
// a known-good layout so a challenge mode never has an impossible level).
// `id` is the registered challenge id (900 daily, 901 seed, 902 endless).
// Par comes from the solver's shot count, clamped to 2..5.
export function generateLevel(seed, difficulty, id) {
  const name = GENERATED_NAMES[(seed >>> 0) % GENERATED_NAMES.length];
  for (let attempt = 0; attempt < 8; attempt++) {
    const rand = mulberry32((seed + attempt * 2654435761) >>> 0);
    const level = genCandidate(rand, difficulty);
    level.id = id;
    level.name = name;
    level.seed = seed >>> 0;
    level.difficulty = difficulty;
    const budget = level.targets.length * 2 + 2;
    const plan = solveLevel(level, budget, {
      coarse: true,
      t0s: levelHasMovingPlanets(level) ? [0, 1.5, 3, 4.5] : [0],
    });
    if (plan) {
      level.par = Math.max(2, Math.min(5, plan.shots));
      level.hint = `Seeded orbit — difficulty ${difficulty}. Bend around the planets and collect every target.`;
      return level;
    }
  }
  // Fallback: the Level 1 line (angle 0, power 0.55) completes this layout.
  return {
    id, name, seed: seed >>> 0, difficulty,
    par: 2,
    hint: `Seeded orbit — difficulty ${difficulty}. Bend around the planet and collect the target.`,
    pad: { x: -14, y: 0 },
    planets: [{ x: 0, y: 6, r: 2, mu: 80, color: 0x7c3aed }],
    targets: [{ x: 12, y: 0, r: 1.6 }],
  };
}

// ---------------------------------------------------------------- zen sandbox
// Zen Sandbox (Block 15, #21): a free orbit playground — unlimited shots,
// no fail state, collected targets drift back onto the field after a
// short delay (the respawn lives in game.js). One static planet, one
// moving planet, one black hole and three targets, hand-placed so the
// bot solver clears it and every clearance rule in smoke.js holds:
// the moving planet's orbit (radius 7) stays 4.6+ clear of every target
// and 4.7 clear of the black hole's centre. `par` is nominal (3) — only
// the bot's star math reads it; the mode never completes a level.
export const ZEN_ID = 903;
export function zenLevel() {
  return {
    id: ZEN_ID,
    name: 'Zen Sandbox',
    zen: true,
    par: 3,
    hint: 'Free orbit playground — unlimited shots. Collect stars, they drift back. No fail state, just flow.',
    pad: { x: -14, y: 0 },
    planets: [
      { x: -2, y: 6, r: 2, mu: 140, color: 0x7c3aed },
      {
        x: 0, y: 7, r: 2.5, mu: 180, color: 0x8b5cf6,
        orbit: { cx: 0, cy: 0, radius: 7, speed: 0.3, phase: Math.PI / 2 },
      },
    ],
    blackHoles: [{ x: 11, y: 4, r: 1.4, mu: 240 }],
    targets: [{ x: 13, y: 0, r: 1.6 }, { x: 10, y: 9, r: 1.6 }, { x: 13, y: -8, r: 1.6 }],
  };
}

export function shotBudget(level) {
  // Zen never runs out of shots: the budget is infinite, so endShot can
  // never fail the level and the HUD shows ∞ instead of a count.
  if (level.zen) return Infinity;
  return level.par + 2;
}

// Stars: par or fewer = 3, par+1 = 2, within budget = 1, otherwise 0.
export function starsForShots(shotsUsed, par) {
  if (shotsUsed <= par) return 3;
  if (shotsUsed === par + 1) return 2;
  if (shotsUsed <= par + 2) return 1;
  return 0;
}

// Star thresholds for a level's par, for level cards and the HUD:
// 3 stars at par or fewer, 2 stars at par+1, 1 star at par+2 (the budget).
export function starThresholds(par) {
  return { three: par, two: par + 1, one: par + 2 };
}

export function isLevelComplete(level, collected) {
  return collected.length >= level.targets.length;
}

// ---------------------------------------------------------------- RNG
// mulberry32: small deterministic PRNG for seeded layouts / starfields.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic decorative scatter (background stars / dust) for a seed.
export function generateDecor(seed, count, radius) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * radius;
    out.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      z: -2 - rand() * 6,
      size: 0.15 + rand() * 0.5,
    });
  }
  return out;
}

// ---------------------------------------------------------------- flight
// Planet position at level time t. Static planets sit at (p.x, p.y);
// a planet with `orbit` travels a circle around (cx, cy) at `speed`
// rad/s from `phase`. (p.x, p.y) is its position at t = 0.
export function planetPosAt(p, t) {
  if (!p.orbit) return { x: p.x, y: p.y };
  const o = p.orbit;
  const a = o.phase + o.speed * t;
  return { x: o.cx + o.radius * Math.cos(a), y: o.cy + o.radius * Math.sin(a) };
}

export function levelHasMovingPlanets(level) {
  return (level.planets || []).some((p) => !!p.orbit);
}

export function levelBlackHoles(level) {
  return level.blackHoles || [];
}

// Portals come in pairs (same `pair` index): entering one teleports the
// comet out of its twin with the entry velocity unchanged.
export function levelPortals(level) {
  return level.portals || [];
}

// Bounce pads are circular reflectors: the comet reflects off the pad's
// surface once per pad per shot, like a mirror.
export function levelBouncePads(level) {
  return level.bouncePads || [];
}

// Hits a target needs before it collects: 1 normally, 2 for a shielded
// target (the first hit only cracks the shield).
export function targetHits(target) {
  return Number.isInteger(target.hits) && target.hits >= 1 ? target.hits : 1;
}

export function launchState(level, angle, power, t0 = 0, shieldHits = {}) {
  // A non-finite angle or power (bad input, a corrupted save) must never
  // seed NaN into the flight: NaN falls back to a still comet, while an
  // out-of-range power (±Infinity) clamps to the 0..1 range.
  const a = Number.isFinite(angle) ? angle : 0;
  const p = (typeof power === 'number' && !Number.isNaN(power))
    ? Math.max(0, Math.min(1, power)) : 0;
  const speed = p * MAX_SPEED;
  return {
    x: level.pad.x, y: level.pad.y,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    t: 0, t0, done: false,
    slingshotPlanets: [], // planet indices already credited this shot
    // Shield state at launch: target index -> hits remaining. Copied so a
    // simulation never mutates the caller's map; the result carries the
    // updated map back for the next shot (shield cracks persist).
    shieldHits: { ...shieldHits },
    shieldHitThisShot: [], // shielded targets already hit this shot (immune)
    portalCooldown: {}, // portal pair -> level time until re-entry is allowed
    bouncedPads: [], // bounce pad indices already used this shot
  };
}

function gravityAt(x, y, level, t) {
  let ax = 0, ay = 0;
  for (const p of level.planets) {
    const pos = planetPosAt(p, t);
    const dx = pos.x - x, dy = pos.y - y;
    const d2 = dx * dx + dy * dy;
    const soft = p.r * GRAVITY_SOFTEN;
    const denom = Math.pow(d2 + soft * soft, 1.5);
    const s = p.mu / denom;
    ax += dx * s;
    ay += dy * s;
  }
  // Black holes pull with the same softened law, only much stronger.
  for (const bh of levelBlackHoles(level)) {
    const dx = bh.x - x, dy = bh.y - y;
    const d2 = dx * dx + dy * dy;
    const soft = bh.r * GRAVITY_SOFTEN;
    const denom = Math.pow(d2 + soft * soft, 1.5);
    const s = bh.mu / denom;
    ax += dx * s;
    ay += dy * s;
  }
  return { ax, ay };
}

// Advance one fixed substep. Returns an event or null. Mutates state.
// `collected` is the list of target indices already collected this attempt;
// newly collected indices are appended to `newlyCollected`.
export function stepFlight(state, level, dt, collected, newlyCollected) {
  if (state.done) return null;
  const t = (state.t0 || 0) + state.t; // planet positions follow level time
  const { ax, ay } = gravityAt(state.x, state.y, level, t);
  state.vx += ax * dt;
  state.vy += ay * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.t += dt;

  // NaN guard (Block 11, #47): a non-finite position or velocity (bad
  // input, a corrupted level) ends the shot as 'invalid' instead of
  // poisoning every later check — NaN comparisons never fire, so without
  // this a corrupted comet would fly forever and never resolve.
  if (![state.x, state.y, state.vx, state.vy].every(Number.isFinite)) {
    state.done = true;
    return { type: 'invalid', targets: newlyCollected.slice() };
  }

  // Portal teleport: entering one portal exits its twin with the entry
  // velocity unchanged, placed just outside the twin's trigger radius
  // along the flight direction so it never re-triggers instantly. The
  // pair then cools down for 0.6s so a fast return pass is not eaten.
  for (const portal of levelPortals(level)) {
    const dx = state.x - portal.x, dy = state.y - portal.y;
    const rr = portal.r + COMET_RADIUS;
    if (dx * dx + dy * dy >= rr * rr) continue;
    const pair = portal.pair ?? 0;
    if ((state.portalCooldown[pair] || 0) > state.t) continue;
    const twin = levelPortals(level).find((p) => p !== portal && (p.pair ?? 0) === pair);
    if (!twin) continue;
    const sp = Math.hypot(state.vx, state.vy) || 1;
    const nx = state.vx / sp, ny = state.vy / sp;
    state.x = twin.x + nx * (twin.r + COMET_RADIUS + 0.2);
    state.y = twin.y + ny * (twin.r + COMET_RADIUS + 0.2);
    state.portalCooldown[pair] = state.t + 0.6;
    return { type: 'portal', targets: [] };
  }
  // Bounce pad: reflect the velocity about the radial normal (mirror
  // bounce), once per pad per shot, and push the comet just outside the
  // pad so the same contact does not fire twice.
  for (let i = 0; i < levelBouncePads(level).length; i++) {
    if (state.bouncedPads.includes(i)) continue;
    const pad = levelBouncePads(level)[i];
    const dx = state.x - pad.x, dy = state.y - pad.y;
    const dist = Math.hypot(dx, dy);
    const rr = pad.r + COMET_RADIUS;
    if (dist >= rr || dist === 0) continue;
    const nx = dx / dist, ny = dy / dist;
    const dot = state.vx * nx + state.vy * ny;
    state.vx -= 2 * dot * nx;
    state.vy -= 2 * dot * ny;
    state.x = pad.x + nx * (rr + 0.1);
    state.y = pad.y + ny * (rr + 0.1);
    state.bouncedPads.push(i);
    return { type: 'bounce', targets: [] };
  }
  // Black hole swallow (event horizon): the comet is gone, shot lost.
  for (const bh of levelBlackHoles(level)) {
    const dx = state.x - bh.x, dy = state.y - bh.y;
    const rr = bh.r + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      state.done = true;
      return { type: 'swallowed', targets: [] };
    }
  }
  // Planet crash (bounding-circle check, at the planet's current position).
  for (const p of level.planets) {
    const pos = planetPosAt(p, t);
    const dx = state.x - pos.x, dy = state.y - pos.y;
    const rr = p.r + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      state.done = true;
      return { type: 'crash', targets: [] };
    }
  }
  // Target collect. A moving target is checked at its current position
  // (level time), so a shot must meet the target where it is, not where
  // it started. A shielded target needs `hits` contacts: each contact
  // cracks one shield layer (once per shot — the same shot cannot crack
  // the same target twice), and only the final hit collects it.
  const newlyShieldHit = [];
  for (let i = 0; i < level.targets.length; i++) {
    if (collected.includes(i)) continue;
    if (state.shieldHitThisShot.includes(i)) continue;
    const tgt = level.targets[i];
    const pos = targetPosAt(tgt, t);
    const dx = state.x - pos.x, dy = state.y - pos.y;
    const rr = tgt.r + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      const remaining = state.shieldHits[i] ?? targetHits(tgt);
      if (remaining > 1) {
        state.shieldHits[i] = remaining - 1;
        state.shieldHitThisShot.push(i);
        newlyShieldHit.push(i);
      } else {
        collected.push(i);
        newlyCollected.push(i);
      }
    }
  }
  // Out of bounds.
  if (state.x * state.x + state.y * state.y > PLAYFIELD_RADIUS * PLAYFIELD_RADIUS) {
    state.done = true;
    return { type: 'lost', targets: newlyCollected.slice() };
  }
  if (state.t >= MAX_SIM_TIME) {
    state.done = true;
    return { type: 'timeout', targets: newlyCollected.slice() };
  }
  if (newlyCollected.length > 0) {
    return { type: 'collect', targets: newlyCollected.slice() };
  }
  if (newlyShieldHit.length > 0) {
    return { type: 'shieldhit', targets: newlyShieldHit.slice() };
  }
  return null;
}

// Simulate one full launch. Pure: does not mutate the level.
// Returns { outcome, collected, points, steps, time, end }.
// outcome: 'collected' (all targets gone) | 'partial' (some collected, shot ended)
//          | 'crash' | 'swallowed' | 'lost' | 'timeout' | 'none' (flew and ended with nothing)
// opts.t0: level time at launch — matters for moving planets.
export function simulateLaunch(level, angle, power, alreadyCollected = [], opts = {}) {
  const record = opts.record !== false;
  const collected = alreadyCollected.slice();
  const state = launchState(level, angle, power, opts.t0 || 0, opts.shieldHits || {});
  const points = record ? [[state.x, state.y]] : [];
  let steps = 0;
  let lastEvent = null;
  let shieldCracks = 0;
  let portalUses = 0;
  let bounces = 0;
  const newly = [];
  while (!state.done) {
    newly.length = 0;
    const ev = stepFlight(state, level, SUBSTEP, collected, newly);
    steps++;
    if (record && steps % 4 === 0 && points.length < 600) points.push([state.x, state.y]);
    if (ev) {
      // Portal hops, bounces and shield cracks never end the shot — the
      // comet keeps flying, so the simulation continues past them.
      if (ev.type === 'portal') { portalUses++; lastEvent = ev; continue; }
      if (ev.type === 'bounce') { bounces++; lastEvent = ev; continue; }
      if (ev.type === 'shieldhit') { shieldCracks += ev.targets.length; lastEvent = ev; continue; }
      lastEvent = ev;
      if (ev.type === 'collect') {
        if (isLevelComplete(level, collected)) {
          state.done = true;
          lastEvent = { type: 'collected', targets: newly.slice() };
          break;
        }
        // Keep flying: one shot can sweep up several targets.
        continue;
      }
      break;
    }
    if (steps > Math.ceil(MAX_SIM_TIME / SUBSTEP) + 2) break;
  }
  const gained = collected.filter((i) => !alreadyCollected.includes(i));
  const allCollected = level.targets.length > 0 && isLevelComplete(level, collected);
  let outcome;
  if (allCollected) outcome = 'collected';
  else if (lastEvent && lastEvent.type === 'invalid') outcome = 'invalid';
  else if (lastEvent && lastEvent.type === 'crash') outcome = 'crash';
  else if (lastEvent && lastEvent.type === 'swallowed') outcome = 'swallowed';
  else if (lastEvent && lastEvent.type === 'timeout') outcome = 'timeout';
  else if (gained.length > 0) outcome = 'partial';
  else if (lastEvent && lastEvent.type === 'lost') outcome = 'lost';
  else outcome = 'none';
  if (record) points.push([state.x, state.y]);
  return {
    outcome, collected: gained, points, steps,
    time: state.t, end: { x: state.x, y: state.y },
    shieldHits: { ...state.shieldHits },
    shieldCracks, portalUses, bounces,
  };
}

// Predict one launch for the trajectory preview. Returns the sampled
// trajectory points plus the predicted outcome and end position, so the
// preview can show fading dots and a coloured end marker (gold = target
// hit, red = crash into a planet / swallowed by a black hole, cyan = flies
// out / runs out of steam).
// `outcome` here is the simulateLaunch outcome: 'collected' | 'partial' |
// 'crash' | 'swallowed' | 'lost' | 'timeout' | 'invalid' | 'none'.
// `t0` is the level time at launch — moving-planet previews depend on it.
export function previewShot(level, angle, power, alreadyCollected = [], t0 = 0, shieldHits = {}) {
  const sim = simulateLaunch(level, angle, power, alreadyCollected, { record: true, t0, shieldHits });
  return {
    points: sim.points,
    outcome: sim.outcome,
    collected: sim.collected,
    end: sim.end,
    time: sim.time,
  };
}

// ---------------------------------------------------------------- save data
export function defaultSave() {
  return { stars: {}, unlocked: 1, seenHowTo: false, daily: null, seedBest: {}, endlessBest: 0, timeAttackBest: null, zenBest: 0 };
}

// stars: { levelId: 0..3 }, unlocked: highest unlocked level id.
// daily: { date: 'YYYY-MM-DD', stars: 0..3 } — best on today's daily level.
// seedBest: { seedLabel: 0..3 } — best stars per shared seed (capped at 100).
// endlessBest: most endless rounds cleared in one run (0..99).
// timeAttackBest: { stars: 0..15, seconds: 0..240 } — best full clear of
// Time Attack (most stars, then fastest); null until the first full clear.
// zenBest: most stars collected in one Zen Sandbox session (0..999).
export function serializeSave(save) {
  const daily = save.daily && typeof save.daily.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(save.daily.date)
    && Number.isInteger(save.daily.stars)
    ? { date: save.daily.date, stars: Math.max(0, Math.min(3, save.daily.stars)) }
    : null;
  const timeAttackBest = save.timeAttackBest && typeof save.timeAttackBest === 'object'
    && Number.isInteger(save.timeAttackBest.stars)
    && save.timeAttackBest.stars >= 0 && save.timeAttackBest.stars <= 15
    && Number.isInteger(save.timeAttackBest.seconds)
    && save.timeAttackBest.seconds >= 0 && save.timeAttackBest.seconds <= TIME_ATTACK_SECONDS
    ? { stars: save.timeAttackBest.stars, seconds: save.timeAttackBest.seconds }
    : null;
  const seedBest = {};
  if (save.seedBest && typeof save.seedBest === 'object') {
    for (const [k, v] of Object.entries(save.seedBest).slice(0, 100)) {
      if (Number.isInteger(v) && v >= 0 && v <= 3) seedBest[String(k).slice(0, 32)] = v;
    }
  }
  return JSON.stringify({
    stars: save.stars || {},
    unlocked: Math.max(1, Math.min(LEVELS.length, save.unlocked || 1)),
    seenHowTo: !!save.seenHowTo,
    daily,
    seedBest,
    endlessBest: Number.isInteger(save.endlessBest)
      ? Math.max(0, Math.min(99, save.endlessBest)) : 0,
    timeAttackBest,
    zenBest: Number.isInteger(save.zenBest)
      ? Math.max(0, Math.min(999, save.zenBest)) : 0,
  });
}

export function parseSave(json) {
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object') return defaultSave();
    const save = defaultSave();
    if (raw.stars && typeof raw.stars === 'object') {
      for (const [k, v] of Object.entries(raw.stars)) {
        const id = Number(k);
        if (LEVELS.some((l) => l.id === id) && Number.isInteger(v) && v >= 0 && v <= 3) {
          save.stars[id] = v;
        }
      }
    }
    if (Number.isInteger(raw.unlocked)) {
      save.unlocked = Math.max(1, Math.min(LEVELS.length, raw.unlocked));
    }
    save.seenHowTo = !!raw.seenHowTo;
    if (raw.daily && typeof raw.daily === 'object'
      && typeof raw.daily.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(raw.daily.date)
      && Number.isInteger(raw.daily.stars)
      && raw.daily.stars >= 0 && raw.daily.stars <= 3) {
      save.daily = { date: raw.daily.date, stars: raw.daily.stars };
    }
    if (raw.seedBest && typeof raw.seedBest === 'object') {
      for (const [k, v] of Object.entries(raw.seedBest).slice(0, 100)) {
        if (Number.isInteger(v) && v >= 0 && v <= 3) save.seedBest[String(k).slice(0, 32)] = v;
      }
    }
    if (Number.isInteger(raw.endlessBest)) {
      save.endlessBest = Math.max(0, Math.min(99, raw.endlessBest));
    }
    if (Number.isInteger(raw.zenBest)) {
      save.zenBest = Math.max(0, Math.min(999, raw.zenBest));
    }
    if (raw.timeAttackBest && typeof raw.timeAttackBest === 'object'
      && Number.isInteger(raw.timeAttackBest.stars)
      && raw.timeAttackBest.stars >= 0 && raw.timeAttackBest.stars <= 15
      && Number.isInteger(raw.timeAttackBest.seconds)
      && raw.timeAttackBest.seconds >= 0 && raw.timeAttackBest.seconds <= TIME_ATTACK_SECONDS) {
      save.timeAttackBest = { stars: raw.timeAttackBest.stars, seconds: raw.timeAttackBest.seconds };
    }
    return save;
  } catch {
    return defaultSave();
  }
}

export function totalStars(save) {
  return Object.values(save.stars).reduce((a, b) => a + b, 0);
}

// --- camera zoom + touch / keyboard input helpers (Block 8) ---
// Zoom is a multiplier on the fitted camera distance: 1 = whole playfield
// fits, 2 = twice as close, 0.6 = pulled right back. Clamped so the
// playfield can never be zoomed out of view or into a single planet.
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.0;
export function clampZoom(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
}

// Tap-to-launch: a press that lifts within 300ms having moved under 14
// screen pixels is a tap, not a drag — it launches with the current aim
// instead of re-aiming. Anything slower or further is a drag-aim.
export const TAP_MAX_MS = 300;
export const TAP_MAX_PX = 14;
export function isTapGesture(durationMs, movedPx) {
  return durationMs <= TAP_MAX_MS && movedPx <= TAP_MAX_PX;
}

// Roving focus for the level grid: arrow keys move between enabled level
// buttons and wrap around the ends. From "no focus" (-1) a forward step
// lands on the first button, a backward step on the last.
export function focusStep(current, count, delta) {
  if (count <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

// --- FPS guard (Block 14, #46) ---
// Frame-time EMA with hysteresis: a sustained slow EMA steps the quality
// level down (lower pixel ratio, fewer particles); a sustained fast EMA
// steps it back up. Levels are pure data so game.js applies them to the
// renderer and the particle spawners; the guard itself never touches the
// DOM, so Node smoke tests can drive it with synthetic frame times.
export const PERF_LEVELS = [
  { pixelRatio: 2, particleScale: 1 },
  { pixelRatio: 1.5, particleScale: 0.75 },
  { pixelRatio: 1.25, particleScale: 0.5 },
  { pixelRatio: 1, particleScale: 0.35 },
];
export const PERF_SLOW_MS = 24; // EMA above this means the frame budget is blown
export const PERF_FAST_MS = 14; // EMA below this means headroom to step back up
export const PERF_SLOW_HOLD_MS = 1000; // slow for a full second before stepping down
export const PERF_FAST_HOLD_MS = 3000; // fast for three seconds before stepping up
export function createPerfGuard() {
  const guard = {
    emaMs: 0,
    level: 0,
    slowTime: 0,
    fastTime: 0,
    stepsDown: 0,
    stepsUp: 0,
    // Feed one frame time (ms). Returns the current level after applying
    // the step rules; NaN / infinite / negative frames are ignored so a
    // corrupted clock can never drive the quality to the floor.
    update(dtMs) {
      if (typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs < 0) return this.level;
      this.emaMs = this.emaMs === 0 ? dtMs : this.emaMs * 0.9 + dtMs * 0.1;
      if (this.emaMs > PERF_SLOW_MS) {
        this.slowTime += dtMs;
        this.fastTime = 0;
        if (this.slowTime >= PERF_SLOW_HOLD_MS && this.level < PERF_LEVELS.length - 1) {
          this.level++;
          this.stepsDown++;
          this.slowTime = 0;
        }
      } else if (this.emaMs < PERF_FAST_MS) {
        this.fastTime += dtMs;
        this.slowTime = 0;
        if (this.fastTime >= PERF_FAST_HOLD_MS && this.level > 0) {
          this.level--;
          this.stepsUp++;
          this.fastTime = 0;
        }
      } else {
        this.slowTime = 0;
        this.fastTime = 0;
      }
      return this.level;
    },
    pixelRatio() { return PERF_LEVELS[this.level].pixelRatio; },
    particleScale() { return PERF_LEVELS[this.level].particleScale; },
  };
  return guard;
}
