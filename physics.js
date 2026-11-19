// Neon Orbit — pure physics + level logic.
// No DOM, no Three.js imports: importable from Node (tests) and from game.js.
export const VERSION = '0.4.0';

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
  win: { tier: 'medium', trauma: 0.30, hitStop: 0.05 },
  swallowed: { tier: 'medium', trauma: 0.50, hitStop: 0.06 },
  crash: { tier: 'large', trauma: 0.85, hitStop: 0.12 },
};

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
    id: 2, name: 'Curveball', par: 3,
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
    id: 4, name: 'The Long Way', par: 3,
    hint: 'The target hides behind the planet. Slingshot around it — never through it.',
    pad: { x: -14, y: 0 },
    planets: [{ x: 2, y: 0, r: 2.5, mu: 200, color: 0x8b5cf6 }],
    targets: [{ x: 13, y: 0, r: 1.6 }],
  },
  {
    id: 5, name: 'Heavyweight', par: 4,
    hint: 'A massive planet dominates the field. Use its pull, respect its surface.',
    pad: { x: -15, y: -8 },
    planets: [{ x: 0, y: 0, r: 3.5, mu: 320, color: 0x5b21b6 }],
    targets: [{ x: 12, y: 8, r: 1.6 }, { x: 13, y: -7, r: 1.6 }],
  },
  {
    id: 6, name: 'Gauntlet', par: 5,
    hint: 'Three planets, three targets, a tight shot budget. Chain the bends.',
    pad: { x: -16, y: 0 },
    planets: [
      { x: -4, y: 5, r: 2, mu: 140, color: 0x7c3aed },
      { x: 4, y: -5, r: 2, mu: 140, color: 0x6d28d9 },
      { x: 10, y: 4, r: 2, mu: 140, color: 0x8b5cf6 },
    ],
    targets: [{ x: 15, y: 7, r: 1.6 }, { x: 16, y: -6, r: 1.6 }, { x: 6, y: 10, r: 1.6 }],
  },
  {
    id: 7, name: 'Event Horizon', par: 3,
    hint: 'A black hole guards the target — it pulls hard and swallows comets. Arc over the top and let the planet bend you home.',
    pad: { x: -14, y: 0 },
    planets: [{ x: -2, y: 8, r: 2, mu: 140, color: 0x7c3aed }],
    blackHoles: [{ x: 2, y: 0, r: 1.6, mu: 300 }],
    targets: [{ x: 13, y: 0, r: 1.6 }],
  },
  {
    id: 8, name: 'Carousel', par: 4,
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
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

export function shotBudget(level) {
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

export function launchState(level, angle, power, t0 = 0) {
  const speed = Math.max(0, Math.min(1, power)) * MAX_SPEED;
  return {
    x: level.pad.x, y: level.pad.y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    t: 0, t0, done: false,
    slingshotPlanets: [], // planet indices already credited this shot
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
  // Target collect.
  for (let i = 0; i < level.targets.length; i++) {
    if (collected.includes(i)) continue;
    const t = level.targets[i];
    const dx = state.x - t.x, dy = state.y - t.y;
    const rr = t.r + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      collected.push(i);
      newlyCollected.push(i);
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
  const state = launchState(level, angle, power, opts.t0 || 0);
  const points = record ? [[state.x, state.y]] : [];
  let steps = 0;
  let lastEvent = null;
  const newly = [];
  while (!state.done) {
    newly.length = 0;
    const ev = stepFlight(state, level, SUBSTEP, collected, newly);
    steps++;
    if (record && steps % 4 === 0 && points.length < 600) points.push([state.x, state.y]);
    if (ev) {
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
  };
}

// Predict one launch for the trajectory preview. Returns the sampled
// trajectory points plus the predicted outcome and end position, so the
// preview can show fading dots and a coloured end marker (gold = target
// hit, red = crash into a planet / swallowed by a black hole, cyan = flies
// out / runs out of steam).
// `outcome` here is the simulateLaunch outcome: 'collected' | 'partial' |
// 'crash' | 'swallowed' | 'lost' | 'timeout' | 'none'.
// `t0` is the level time at launch — moving-planet previews depend on it.
export function previewShot(level, angle, power, alreadyCollected = [], t0 = 0) {
  const sim = simulateLaunch(level, angle, power, alreadyCollected, { record: true, t0 });
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
  return { stars: {}, unlocked: 1, seenHowTo: false };
}

// stars: { levelId: 0..3 }, unlocked: highest unlocked level id.
export function serializeSave(save) {
  return JSON.stringify({
    stars: save.stars || {},
    unlocked: Math.max(1, Math.min(LEVELS.length, save.unlocked || 1)),
    seenHowTo: !!save.seenHowTo,
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
    return save;
  } catch {
    return defaultSave();
  }
}

export function totalStars(save) {
  return Object.values(save.stars).reduce((a, b) => a + b, 0);
}
