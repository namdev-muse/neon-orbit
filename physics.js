// Neon Orbit v2 — pure physics + level logic.
// No DOM, no Three.js imports: importable from Node (tests) and from game.js.
// v2 rebuild: mid-flight thrust is the core mechanic (steer the comet with
// limited fuel), the prediction oracle is dead, and every level is dense
// and hand-crafted so a ballistic (no-thrust) solver cannot clear it in par.
export const VERSION = '2.1.0';

export const MAX_SPEED = 22; // comet launch speed at full power (units / s)
export const PLAYFIELD_RADIUS = 26; // out of bounds beyond this distance
export const COMET_RADIUS = 0.5;
export const SUBSTEP = 1 / 120; // fixed integration step (s)
export const MAX_SIM_TIME = 10; // a shot that is still flying is lost
export const GRAVITY_SOFTEN = 1.0; // softening scale, multiplied by planet radius

// ---------------------------------------------------------------- thrust (v2 core)
// Mid-flight thrust: hold to burn, steer the comet while it flies. Fuel is
// a per-shot tank — every launch starts full, burning drains it, and gold
// fuel orbs refill it mid-flight. Thrust accel is strong enough to bend a
// flight around a planet or climb out of a bad arc, but the tank only
// holds ~3 seconds of burn, so every burn is a decision.
export const FUEL_MAX = 100;
export const FUEL_BURN_RATE = 32; // fuel per second of full burn
export const THRUST_ACCEL = 15; // thrust acceleration (units / s^2)
export const FUEL_ORB_REFILL = 40; // fuel a gold orb restores mid-flight

// ---------------------------------------------------------------- ship upgrades (Block 2, #1-2)
// Two ship upgrades, earned with campaign stars and toggled in Level
// Select — they make the ship fly better, never the levels easier to
// aim: thrust power (+25% burn force) and fuel capacity (+30% tank).
// An upgrade only flies when it is BOTH equipped AND unlocked at the
// save's total stars, so a stale or hand-edited flag can never equip
// above its unlock. Loadouts are plain { thrust, tank } booleans so
// tests, the solver and the preview all drive the same ship.
export const THRUST_UPGRADE_MULT = 1.25; // Ion Thrusters: +25% burn force
export const TANK_UPGRADE_MULT = 1.30; // Big Tank: +30% fuel capacity
export const UPGRADES = [
  { id: 'thrust', name: 'Ion Thrusters', desc: '+25% thrust power', unlockStars: 15, thrustMult: THRUST_UPGRADE_MULT, tankMult: 1 },
  { id: 'tank', name: 'Big Tank', desc: '+30% fuel capacity', unlockStars: 30, thrustMult: 1, tankMult: TANK_UPGRADE_MULT },
];
export function upgradeById(id) {
  return UPGRADES.find((u) => u.id === id) || null;
}
export function upgradeUnlocked(id, total) {
  const u = upgradeById(id);
  if (!u) return false;
  return typeof total === 'number' && Number.isFinite(total) && total >= u.unlockStars;
}
// Multipliers for a loadout. Unknown keys and non-booleans are ignored;
// a missing loadout is the base ship (1, 1).
export function loadoutMultipliers(loadout) {
  const l = loadout && typeof loadout === 'object' ? loadout : {};
  return {
    thrust: l.thrust === true ? THRUST_UPGRADE_MULT : 1,
    tank: l.tank === true ? TANK_UPGRADE_MULT : 1,
  };
}
// The loadout a save actually flies with: equipped AND unlocked at its
// total stars. totalStars is defined below (function declaration, so it
// is hoisted and callable here).
export function activeLoadout(save) {
  const total = save ? totalStars(save) : 0;
  const up = save && save.upgrades && typeof save.upgrades === 'object' ? save.upgrades : {};
  return {
    thrust: up.thrust === true && upgradeUnlocked('thrust', total),
    tank: up.tank === true && upgradeUnlocked('tank', total),
  };
}

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
  // Trail pickup orb: a soft gold ping — small tier, no hit-stop.
  orb: { tier: 'small', trauma: 0.10, hitStop: 0 },
  // Thrust burn start (v2): a small kick — small tier, no hit-stop.
  thrust: { tier: 'small', trauma: 0.12, hitStop: 0 },
  // Boost pad (Block 2, #3): a teal kick through a pad — small tier, no
  // hit-stop, the same weight as an orb pickup.
  boost: { tier: 'small', trauma: 0.15, hitStop: 0 },
  win: { tier: 'medium', trauma: 0.30, hitStop: 0.05 },
  swallowed: { tier: 'medium', trauma: 0.50, hitStop: 0.06 },
  crash: { tier: 'large', trauma: 0.85, hitStop: 0.12 },
};

// Music styles (Block 17, #36): three scheduler presets for the audio
// settings panel's style cycler. 'nebula' is the original Block 5 sound
// (same roots, arp and 250ms step), so the default style changes nothing
// for existing players; 'pulse' is faster and punchier (square bass,
// 200ms step), 'deep' is slower and lower (sine bass, 333ms step).
// Pure data + lookup helpers so Node tests can drive the cycler.
export const MUSIC_STYLES = [
  { id: 'nebula', name: 'Nebula', roots: [55, 43.65, 65.41, 49], arp: [2, 3, 4, 3], stepMs: 250, bass: 'triangle', arpType: 'sine', bassVol: 0.045, arpVol: 0.02 },
  { id: 'pulse', name: 'Pulse', roots: [49, 55, 65.41, 58.27], arp: [3, 4, 2, 4], stepMs: 200, bass: 'square', arpType: 'triangle', bassVol: 0.03, arpVol: 0.018 },
  { id: 'deep', name: 'Deep Field', roots: [36.71, 43.65, 32.7, 49], arp: [2, 2, 3, 5], stepMs: 333, bass: 'sine', arpType: 'sine', bassVol: 0.06, arpVol: 0.022 },
];
export function musicStyleById(id) {
  return MUSIC_STYLES.find((s) => s.id === id) || MUSIC_STYLES[0];
}
export function nextMusicStyleId(id) {
  const i = MUSIC_STYLES.findIndex((s) => s.id === id);
  return MUSIC_STYLES[(i + 1) % MUSIC_STYLES.length].id;
}

// Crash flash (Block 17, #32): a fullscreen red flash on a planet crash,
// rate-limited to 3 per second (the game-feel skill caps large flashes
// there) and suppressed entirely under reduce-flashing / reduce-motion.
// Pure helper so Node tests can drive the limiter.
export const FLASH_MIN_INTERVAL_MS = 333;
export function flashAllowed(nowMs, lastFlashMs, reduceFlashing) {
  if (reduceFlashing) return false;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;
  if (typeof lastFlashMs !== 'number' || !Number.isFinite(lastFlashMs)) return true;
  return nowMs - lastFlashMs >= FLASH_MIN_INTERVAL_MS;
}

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

// Gravity-assist bonus (Block 17, #4): every slingshot near-miss pays
// GRAVITY_ASSIST_POINTS, banked per level attempt and shown in the HUD
// and on the level-complete screen; the best per campaign level is saved.
export const GRAVITY_ASSIST_POINTS = 100;
export function gravityAssistPoints(slingshots) {
  if (typeof slingshots !== 'number' || !Number.isFinite(slingshots)) return 0;
  return Math.max(0, Math.floor(slingshots)) * GRAVITY_ASSIST_POINTS;
}

// Fuel orbs (v2): small gold orbs placed along flight paths. Flying
// through one banks ORB_POINTS into the attempt bonus (+50 each by
// default) AND refills FUEL_ORB_REFILL fuel mid-flight, so a good route
// through orbs extends the burn. Orbs stay collected for the whole
// attempt, so a later shot cannot farm the same orb twice. `points`
// overrides the default (clamped 10..500); `r` overrides the trigger
// radius.
export const ORB_POINTS = 50;
export const ORB_RADIUS = 0.9;
export function orbPoints(orb) {
  if (!orb || typeof orb.points !== 'number' || !Number.isFinite(orb.points)) return ORB_POINTS;
  return Math.max(10, Math.min(500, Math.floor(orb.points)));
}
export function orbRadius(orb) {
  if (!orb || typeof orb.r !== 'number' || !Number.isFinite(orb.r) || orb.r <= 0) return ORB_RADIUS;
  return orb.r;
}
export function levelOrbs(level) {
  return level.orbs || [];
}

// Boost pads (Block 2, #3): teal rings on risk/reward lines. Flying
// through one refills BOOST_PAD_REFILL fuel (up to the tank — the
// upgraded tank included) AND kicks the comet faster along its current
// flight direction, so a pad is a route choice, not a pickup: the fast
// line runs close to a planet, a black hole or a moving planet. One
// trigger per pad per shot — a comet cannot sit on a pad and farm it.
// `r` overrides the trigger radius like orbs do.
export const BOOST_PAD_REFILL = 50;
export const BOOST_PAD_KICK = 6; // speed added along the flight direction
export const BOOST_PAD_RADIUS = 1.4;
export function levelBoostPads(level) {
  return level.boostPads || [];
}
export function boostPadRadius(pad) {
  if (!pad || typeof pad.r !== 'number' || !Number.isFinite(pad.r) || pad.r <= 0) return BOOST_PAD_RADIUS;
  return pad.r;
}

// Thrust burn helper (v2): how much fuel a burn of `seconds` costs, and
// whether a flight state can still burn. Pure helpers so Node tests can
// drive the fuel economy without stepping a flight.
export function fuelCost(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * FUEL_BURN_RATE;
}
export function canThrust(state) {
  return !!state && !state.done && typeof state.fuel === 'number'
    && Number.isFinite(state.fuel) && state.fuel > 0;
}

// ---------------------------------------------------------------- levels
// One palette, one art direction: violet planets, magenta targets, cyan comet.
// v2 campaign: 6 dense hand-crafted levels. Every level has its own identity
// (theme: disc colour + nebula tint + a distinct planet palette) and is
// designed so a ballistic (no-thrust) solver CANNOT finish it in par —
// thrust must chain targets in a single shot (par is one less than the
// target count on most levels). The smoke tests assert both halves of
// that gate, so a level that the bot clears ballistically is not done.
// `theme.disc` tints the playfield disc; `theme.tint` tints the nebula.
export const LEVELS = [
  {
    id: 1, name: 'First Burn', par: 1,
    hint: 'Launch toward the upper star, then HOLD to burn — steer the comet down to the second star in the same shot. One shot, two stars.',
    theme: { disc: '#0d0826', tint: '#ffffff' },
    pad: { x: -14, y: 0 },
    planets: [
      { x: 0, y: 4, r: 2, mu: 130, color: 0x7c3aed },
      { x: -1, y: -6, r: 1.8, mu: 110, color: 0x4f46e5 },
    ],
    targets: [{ x: 11, y: 6, r: 1.7 }, { x: 13, y: -6, r: 1.7 }],
    orbs: [{ x: -5, y: -2 }, { x: 6, y: 0 }],
    // Boost pad (Block 2, #3): below the two-target line, in the lower
    // planet's gravity well — the fast route to the second star dives
    // past it, and the pad's kick carries the comet on to the star.
    boostPads: [{ x: 4, y: -3 }],
  },
  {
    id: 2, name: 'Slingshot Turn', par: 2,
    hint: 'A heavyweight blocks the straight line. Bend around it, then burn to swing between the three stars.',
    theme: { disc: '#160a04', tint: '#ffd9b0' },
    pad: { x: -15, y: 0 },
    planets: [
      { x: 0, y: 0, r: 2.5, mu: 220, color: 0xea580c },
      { x: 8, y: 7, r: 1.8, mu: 120, color: 0xf97316 },
    ],
    targets: [{ x: 14, y: 9, r: 1.6 }, { x: 14, y: -8, r: 1.6 }, { x: -9, y: -10, r: 1.6 }],
    orbs: [{ x: -7, y: 4 }, { x: 4, y: -3 }],
    // Boost pad (Block 2, #3): 4 units off the heavyweight's surface —
    // a near-miss corridor. Thread it and the kick bends you between
    // the three stars; miss the line and the planet eats the shot.
    boostPads: [{ x: 4, y: 0 }],
  },
  {
    id: 3, name: 'Twin Gates', par: 2,
    hint: 'Three ice giants, three stars. Chain the bends — burn between gates to catch two stars on one flight.',
    theme: { disc: '#04121a', tint: '#bfe9ff' },
    pad: { x: -15, y: -6 },
    planets: [
      { x: -3, y: 5, r: 2, mu: 150, color: 0x38bdf8 },
      { x: 5, y: -4, r: 2, mu: 150, color: 0x0ea5e9 },
      { x: 10, y: 6, r: 1.8, mu: 120, color: 0x14b8a6 },
    ],
    targets: [{ x: 14, y: 8, r: 1.6 }, { x: 14, y: -9, r: 1.6 }, { x: -8, y: 11, r: 1.6 }],
    orbs: [{ x: -8, y: 0 }, { x: 7, y: 2 }],
    // Boost pad (Block 2, #3): dead centre between the three ice
    // giants — the gate-to-gate line runs straight through it, so a
    // chained flight refuels and accelerates mid-tour.
    boostPads: [{ x: 1, y: 0 }],
  },
  {
    id: 4, name: 'Event Horizon', par: 2,
    hint: 'A black hole guards the middle star. Arc over it and burn hard to escape its pull — never fly through it.',
    theme: { disc: '#140419', tint: '#ffc2ec' },
    pad: { x: -14, y: 0 },
    planets: [
      { x: -3, y: 8, r: 2, mu: 140, color: 0xc026d3 },
      // Second planet sits on the right-side descent of the big top lob,
      // so no single ballistic arc can sweep the top star down to the
      // lower two — the arc crashes into it instead.
      { x: 14, y: 5, r: 2.2, mu: 180, color: 0x9333ea },
      // Third planet guards the right-side rise of the slow bottom
      // U-lob: the sweep that collects the left-low star and climbs to
      // the top star crashes into it instead.
      { x: 16, y: 2, r: 2, mu: 150, color: 0x7e22ce },
    ],
    blackHoles: [{ x: 3, y: 0, r: 1.6, mu: 320 }],
    targets: [{ x: 11, y: -1, r: 1.6 }, { x: 15, y: 11, r: 1.6 }, { x: -10, y: -10, r: 1.6 }],
    orbs: [{ x: -7, y: -5 }, { x: 0, y: -8 }],
    // Boost pad (Block 2, #3): on the descent to the middle star, in
    // the black hole's pull — the pad refuels the escape burn, but the
    // line that reaches it skims the event horizon.
    boostPads: [{ x: 7, y: -4 }],
  },
  {
    id: 5, name: 'Carousel', par: 2,
    hint: 'The big planet never sits still — it orbits the centre. Time your launch, then burn to chase the stars as the bend moves.',
    theme: { disc: '#04160c', tint: '#c8ffd9' },
    pad: { x: -15, y: 0 },
    planets: [
      {
        x: 7, y: 0, r: 2, mu: 150, color: 0xd97706,
        orbit: { cx: 0, cy: 0, radius: 7, speed: 0.45, phase: 0 },
      },
      { x: -4, y: -7, r: 1.8, mu: 110, color: 0x16a34a },
    ],
    targets: [{ x: 13, y: 3, r: 1.6 }, { x: 13, y: -8, r: 1.6 }, { x: -11, y: 9, r: 1.6 }],
    orbs: [{ x: -10, y: 5 }, { x: 11, y: -4 }],
    // Boost pad (Block 2, #3): the exact centre of the moving planet's
    // orbit — the planet sweeps through it, so the pad is only safe to
    // take when the bend is on the far side. Timing is the price.
    boostPads: [{ x: 0, y: 0 }],
  },
  {
    id: 6, name: 'Grand Tour', par: 2,
    hint: 'Everything at once: three planets, a black hole, a portal pair — and one shielded star that takes two hits. Fly the whole tour.',
    theme: { disc: '#180512', tint: '#ffc9c9' },
    pad: { x: -16, y: 0 },
    planets: [
      { x: -4, y: 6, r: 2, mu: 140, color: 0xdc2626 },
      { x: 4, y: -6, r: 2, mu: 140, color: 0x7c3aed },
      { x: 10, y: 7, r: 1.8, mu: 130, color: 0xdb2777 },
      // Fourth planet sits on the descent from the top star to the
      // right-mid star, so no single ballistic arc can sweep both.
      { x: 14, y: 10, r: 1.8, mu: 140, color: 0x0ea5e9 },
    ],
    blackHoles: [{ x: 0, y: -1, r: 1.3, mu: 220 }],
    portals: [
      { x: -9, y: -8, r: 1.6, pair: 0 },
      { x: 18, y: 11, r: 1.6, pair: 0 },
    ],
    targets: [
      { x: 15, y: -3, r: 1.6 }, { x: 17, y: 4, r: 1.6 },
      { x: 9, y: 12, r: 1.6 }, { x: -13, y: 8, r: 1.6, hits: 2 },
    ],
    orbs: [{ x: -11, y: 5 }, { x: 2, y: 9 }, { x: 9, y: -2 }],
    // Boost pad (Block 2, #3): between the two mid-field planets on the
    // tour's long diagonal — the line from the portal exit to the
    // right-mid star runs through it, with the black hole below. It is
    // a trap line too: one shot can collect three stars off it and
    // strand the shielded star — the thrust solver now tries the next
    // best opening shot when the greedy one dead-ends (beam search),
    // the way a player learns from a bad line instead of giving up.
    boostPads: [{ x: 6, y: 2 }],
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

// ---------------------------------------------------------------- thrust solver (v2)
// The thrust-aware solver: the same grid search as solveShot, but every
// candidate launch is flown WITH a steering policy, so it finds shots
// that chain targets by burning mid-flight. This is the bot harness's
// real solver — and the anti-slop gate's other half: solveLevel (pure
// ballistic) must FAIL a v2 level within par while solveLevelThrust
// SUCCEEDS within par, proving the level needs flying, not just aiming.
//
// The policy is a greedy pursuit: steer toward the nearest uncollected
// target at a cruise speed, burning only when the velocity error is big
// enough to matter. It does not know the level layout — it just flies —
// so a level it clears is clearable by a skilled player, not by a lookup.
// `collected` is the LIVE list for the flight (it grows as targets are
// collected mid-shot), so the policy re-targets after every collect and
// chains targets instead of hovering on one it already caught.
export const THRUST_CRUISE_SPEED = 9;
export function thrustPolicyFor(level, collected) {
  return (state, _level, liveCollected) => {
    const done = Array.isArray(liveCollected) ? liveCollected : collected;
    const remaining = level.targets
      .map((t, i) => i)
      .filter((i) => !done.includes(i));
    if (!remaining.length || !canThrust(state)) return null;
    // Nearest remaining target, at its current position (moving targets
    // are led by their live position, not where they started).
    const t = (state.t0 || 0) + state.t;
    let bestI = remaining[0];
    let bestD = Infinity;
    for (const i of remaining) {
      const pos = targetPosAt(level.targets[i], t);
      const d = (pos.x - state.x) ** 2 + (pos.y - state.y) ** 2;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const pos = targetPosAt(level.targets[bestI], t);
    const dx = pos.x - state.x, dy = pos.y - state.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Desired velocity: cruise toward the target. Steer only when the
    // error is worth fuel — a comet already on line coasts for free.
    const dvx = (dx / dist) * THRUST_CRUISE_SPEED - state.vx;
    const dvy = (dy / dist) * THRUST_CRUISE_SPEED - state.vy;
    const err = Math.hypot(dvx, dvy);
    if (err < 1.0) return null;
    return { x: dvx / err, y: dvy / err };
  };
}

export function solveShotThrust(level, collected = [], opts = {}) {
  const tops = solveShotThrustTop(level, collected, opts, 1);
  return tops.length ? tops[0] : null;
}

// Top-N thrust shots (Block 2, #3): the same grid search as
// solveShotThrust, but it keeps the best N DISTINCT lines — distinct
// means a different launch, not the same arc ±2° (angle > 6° apart, or
// power > 0.1 apart, or a different launch time). A boost pad can make
// a greedy opening shot look best while stranding the level (three
// stars collected, the shielded star left for a single shot that can
// only crack it) — solveLevelThrust tries the next-best openings when
// the best one dead-ends, so the solver plays like a player who learns
// from a trap line instead of a bot that only ever tries one idea.
export function solveShotThrustTop(level, collected = [], opts = {}, n = 3) {
  const angleStep = 6;
  const powerStep = 0.1;
  const t0s = opts.t0s || (levelHasMovingPlanets(level) || levelHasMovingTargets(level)
    ? [0, 0.75, 1.5, 2.25, 3] : [0]);
  const tops = [];
  const score = (res) => {
    let s = res.collected.length * 10000;
    s += (res.shieldCracks || 0) * 4000;
    if (res.outcome === 'crash') s -= 5000;
    if (res.outcome === 'swallowed') s -= 5000;
    if (res.outcome === 'timeout') s -= 2000;
    if (res.outcome === 'lost') s -= 500;
    // Fuel is a cost: two plans that collect the same stars should
    // prefer the one that burned less, so the bot's plan stays human.
    s -= (res.fuelUsed || 0) * 2;
    s -= res.steps * 0.05;
    return s;
  };
  const angleDiff = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(d, Math.PI * 2 - d);
  };
  const consider = (angle, power, t0, res) => {
    const sc = score(res);
    const cand = { angle, power, t0, score: sc, res };
    for (const kept of tops) {
      if (angleDiff(angle, kept.angle) <= (6 * Math.PI) / 180
        && Math.abs(power - kept.power) <= 0.1
        && Math.abs(t0 - kept.t0) <= 0.75) return; // near-duplicate of a better line
    }
    tops.push(cand);
    tops.sort((a, b) => b.score - a.score);
    if (tops.length > n) tops.length = n;
  };
  for (const t0 of t0s) {
    for (let deg = 0; deg < 360; deg += angleStep) {
      for (let p = 0.15; p <= 1.001; p += powerStep) {
        const policy = thrustPolicyFor(level, collected);
        const res = simulateLaunch(level, (deg * Math.PI) / 180, p, collected, {
          record: false, t0, shieldHits: opts.shieldHits || {}, thrustPolicy: policy,
          loadout: opts.loadout,
        });
        consider((deg * Math.PI) / 180, p, t0, res);
      }
    }
  }
  return tops;
}

// Plays a level shot by shot with the thrust solver. Returns { shots,
// lines } on completion within `budget`, or null when even thrust cannot
// finish it. Lines carry the launch per shot; the policy itself is
// re-derived per shot from the remaining targets.
// Beam (Block 2, #3): the opening shot is tried from the top 3 distinct
// lines in order — a greedy opener that strands the level (the boost-pad
// trap: three stars, shield uncracked) falls through to the next-best
// opening instead of failing the level. Later shots stay greedy: only
// the opener branches, so the search stays cheap.
export function solveLevelThrust(level, budget, opts = {}) {
  const openers = solveShotThrustTop(level, [], opts, 3);
  for (const opener of openers) {
    const collected = [];
    let shieldHits = opts.shieldHits ? { ...opts.shieldHits } : {};
    let orbsCollected = [];
    const lines = [];
    let shots = 0;
    let first = opener;
    while (collected.length < level.targets.length && shots < budget) {
      const best = first || solveShotThrust(level, collected, { ...opts, shieldHits });
      first = null;
      if (!best) break;
      shots++;
      lines.push({
        angle: best.angle, power: best.power, t0: best.t0,
        collected: best.res.collected.length, fuelUsed: best.res.fuelUsed,
      });
      shieldHits = best.res.shieldHits || shieldHits;
      orbsCollected = best.res.orbsCollected || orbsCollected;
      for (const i of best.res.collected) {
        if (!collected.includes(i)) collected.push(i);
      }
    }
    if (collected.length === level.targets.length) return { shots, lines };
  }
  return null;
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
  // Trail orb (#12): one gold pickup near the pad -> target corridor, on
  // a perpendicular offset so it rewards a bend rather than a straight
  // line. Only placed when it clears every planet, target, black hole
  // and the pad — orbs are a bonus, never a blocker.
  const orbs = [];
  const orbClear = (x, y) => {
    if (x * x + y * y > (PLAYFIELD_RADIUS - 2) * (PLAYFIELD_RADIUS - 2)) return false;
    if (Math.hypot(x - pad.x, y - pad.y) < 3) return false;
    if (targets.some((t) => Math.hypot(x - t.x, y - t.y) < t.r + ORB_RADIUS + 0.5)) return false;
    if (planets.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + ORB_RADIUS + 0.5)) return false;
    if (blackHoles.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + ORB_RADIUS + 0.5)) return false;
    // A moving planet sweeps its whole orbit circle (centred on the
    // origin), so the orb must stay clear of that path, not just of the
    // planet's current spot.
    if (planets.some((p) => p.orbit
      && Math.abs(Math.hypot(x, y) - p.orbit.radius) < p.r + ORB_RADIUS + 0.5)) return false;
    return true;
  };
  for (let tries = 0; tries < 12 && orbs.length === 0; tries++) {
    const t = 0.35 + rand() * 0.35;
    const off = (rand() < 0.5 ? -1 : 1) * (2.5 + rand() * 3);
    const x = pad.x + dx * t + px * off;
    const y = pad.y + dy * t + py * off;
    if (orbClear(x, y)) orbs.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return { pad, planets, targets, blackHoles, orbs };
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
    orbs: [{ x: 0, y: -3 }],
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
    // Zen orbs (#12): outside the moving planet's orbit path (radius 7),
    // so the planet never sweeps over them.
    orbs: [{ x: -11, y: -6 }, { x: 5, y: 11 }],
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

export function launchState(level, angle, power, t0 = 0, shieldHits = {}, orbsCollected = [], loadout) {
  // A non-finite angle or power (bad input, a corrupted save) must never
  // seed NaN into the flight: NaN falls back to a still comet, while an
  // out-of-range power (±Infinity) clamps to the 0..1 range.
  const a = Number.isFinite(angle) ? angle : 0;
  const p = (typeof power === 'number' && !Number.isNaN(power))
    ? Math.max(0, Math.min(1, power)) : 0;
  const speed = p * MAX_SPEED;
  // Ship upgrades (Block 2, #1-2): the loadout scales this shot's tank
  // and burn force. The multipliers live on the flight state so the
  // step, the orb refill cap and the HUD all read the same numbers.
  const mult = loadoutMultipliers(loadout);
  const fuelMax = FUEL_MAX * mult.tank;
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
    // Fuel orbs (v2): indices already banked this attempt, copied in so
    // a later shot cannot farm the same orb twice. The result carries the
    // updated list back (game.js merges it into the attempt state).
    orbsCollected: Array.isArray(orbsCollected) ? orbsCollected.slice() : [],
    // Mid-flight thrust (v2 core): a per-shot fuel tank. Every launch
    // starts full; burning drains it; gold orbs refill it mid-flight.
    // fuelMax / thrustAccel (Block 2, #1-2): the equipped loadout's
    // tank and burn force for this shot — the base ship is 100 / 15.
    fuel: fuelMax,
    fuelMax,
    thrustAccel: THRUST_ACCEL * mult.thrust,
    fuelUsed: 0,
    thrustTime: 0,
    // Boost pads (Block 2, #3): indices already triggered this shot —
    // one trigger per pad per shot, so a pad cannot be farmed by
    // sitting on it. The list resets on the next launch.
    boostedPads: [],
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
// `thrust` (v2) is a { x, y } steering direction for this substep (or null):
// a unit-ish vector the player (or the thrust bot) holds to burn fuel and
// accelerate the comet. Fuel burns at FUEL_BURN_RATE while thrusting; an
// empty tank means no thrust, and a zero/NaN thrust vector is ignored.
export function stepFlight(state, level, dt, collected, newlyCollected, thrust) {
  if (state.done) return null;
  const t = (state.t0 || 0) + state.t; // planet positions follow level time
  const { ax, ay } = gravityAt(state.x, state.y, level, t);
  state.vx += ax * dt;
  state.vy += ay * dt;
  // Mid-flight thrust (v2): burn fuel to accelerate along `thrust`.
  // thrustAccel (Block 2, #1) is the loadout's burn force — the Ion
  // Thrusters upgrade makes the same hold push 25% harder.
  if (thrust && typeof thrust.x === 'number' && typeof thrust.y === 'number'
    && Number.isFinite(thrust.x) && Number.isFinite(thrust.y)
    && typeof state.fuel === 'number' && Number.isFinite(state.fuel) && state.fuel > 0) {
    const len = Math.hypot(thrust.x, thrust.y);
    if (len > 0.01) {
      const burn = Math.min(state.fuel, FUEL_BURN_RATE * dt);
      const accel = (typeof state.thrustAccel === 'number' && Number.isFinite(state.thrustAccel) && state.thrustAccel > 0)
        ? state.thrustAccel : THRUST_ACCEL;
      const scale = (accel * dt * (burn / (FUEL_BURN_RATE * dt))) / len;
      state.vx += thrust.x * scale;
      state.vy += thrust.y * scale;
      state.fuel -= burn;
      state.fuelUsed += burn;
      state.thrustTime += dt;
    }
  }
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
  // Fuel orbs (v2): flying through one banks its points for the attempt
  // AND refills the fuel tank mid-flight, so a good route through orbs
  // extends the burn. Non-terminating like a shield crack — the comet
  // keeps flying, and the event carries the points so the game can bank
  // them.
  const newlyOrbs = [];
  let orbPointsGained = 0;
  for (let i = 0; i < levelOrbs(level).length; i++) {
    if (state.orbsCollected.includes(i)) continue;
    const orb = levelOrbs(level)[i];
    const dx = state.x - orb.x, dy = state.y - orb.y;
    const rr = orbRadius(orb) + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      state.orbsCollected.push(i);
      newlyOrbs.push(i);
      orbPointsGained += orbPoints(orb);
      // Orb refill caps at the flight's own tank (Block 2, #2): a Big
      // Tank ship refills up to 130, the base ship up to 100.
      const cap = (typeof state.fuelMax === 'number' && Number.isFinite(state.fuelMax))
        ? state.fuelMax : FUEL_MAX;
      state.fuel = Math.min(cap, (state.fuel || 0) + FUEL_ORB_REFILL);
    }
  }
  // Boost pads (Block 2, #3): a pass-through refills BOOST_PAD_REFILL
  // fuel (same tank cap) and kicks the comet faster along its current
  // flight direction. Non-terminating like an orb — the comet keeps
  // flying, and the event carries the pad index so the game can hide
  // the mesh. A near-stationary comet gets fuel but no kick (there is
  // no direction to kick along).
  const newlyBoosts = [];
  const boosted = Array.isArray(state.boostedPads) ? state.boostedPads : (state.boostedPads = []);
  for (let i = 0; i < levelBoostPads(level).length; i++) {
    if (boosted.includes(i)) continue;
    const pad = levelBoostPads(level)[i];
    const dx = state.x - pad.x, dy = state.y - pad.y;
    const rr = boostPadRadius(pad) + COMET_RADIUS;
    if (dx * dx + dy * dy < rr * rr) {
      boosted.push(i);
      newlyBoosts.push(i);
      const cap = (typeof state.fuelMax === 'number' && Number.isFinite(state.fuelMax))
        ? state.fuelMax : FUEL_MAX;
      state.fuel = Math.min(cap, (state.fuel || 0) + BOOST_PAD_REFILL);
      const sp = Math.hypot(state.vx, state.vy);
      if (sp > 0.5) {
        state.vx += (state.vx / sp) * BOOST_PAD_KICK;
        state.vy += (state.vy / sp) * BOOST_PAD_KICK;
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
  if (newlyOrbs.length > 0) {
    return { type: 'orb', targets: newlyOrbs.slice(), points: orbPointsGained };
  }
  if (newlyBoosts.length > 0) {
    return { type: 'boost', targets: newlyBoosts.slice() };
  }
  return null;
}

// Simulate one full launch. Pure: does not mutate the level.
// Returns { outcome, collected, points, steps, time, end }.
// outcome: 'collected' (all targets gone) | 'partial' (some collected, shot ended)
//          | 'crash' | 'swallowed' | 'lost' | 'timeout' | 'none' (flew and ended with nothing)
// opts.t0: level time at launch — matters for moving planets.
// opts.thrustPolicy (v2): a function (state, level, collected) => { x, y } | null,
// called every substep — the bot's steering brain, or a recorded player
// input. Without it the shot is purely ballistic.
// opts.loadout (Block 2, #1-2): the ship's equipped upgrades for this
// shot — the preview, the solver and the live game all fly the same
// loadout, so what the player sees is what the comet does.
export function simulateLaunch(level, angle, power, alreadyCollected = [], opts = {}) {
  const record = opts.record !== false;
  const collected = alreadyCollected.slice();
  const startOrbs = Array.isArray(opts.orbsCollected) ? opts.orbsCollected.slice() : [];
  const state = launchState(level, angle, power, opts.t0 || 0, opts.shieldHits || {}, startOrbs, opts.loadout);
  const thrustPolicy = typeof opts.thrustPolicy === 'function' ? opts.thrustPolicy : null;
  const points = record ? [[state.x, state.y]] : [];
  let steps = 0;
  let lastEvent = null;
  let shieldCracks = 0;
  let portalUses = 0;
  let bounces = 0;
  let boosts = 0;
  const newly = [];
  while (!state.done) {
    newly.length = 0;
    const thrust = thrustPolicy ? thrustPolicy(state, level, collected) : null;
    const ev = stepFlight(state, level, SUBSTEP, collected, newly, thrust);
    steps++;
    if (record && steps % 4 === 0 && points.length < 600) points.push([state.x, state.y]);
    if (ev) {
      // Portal hops, bounces, shield cracks and orb pickups never end
      // the shot — the comet keeps flying, so the simulation continues
      // past them.
      if (ev.type === 'portal') { portalUses++; lastEvent = ev; continue; }
      if (ev.type === 'bounce') { bounces++; lastEvent = ev; continue; }
      if (ev.type === 'shieldhit') { shieldCracks += ev.targets.length; lastEvent = ev; continue; }
      if (ev.type === 'orb') { lastEvent = ev; continue; }
      if (ev.type === 'boost') { boosts += ev.targets.length; lastEvent = ev; continue; }
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
  // Orbs banked by this shot: read from the flight state, not the event
  // stream — an orb flown through on the same substep as the final
  // collect (or a crash) is in the state even when its event never fired.
  const orbs = state.orbsCollected.filter((i) => !startOrbs.includes(i));
  const orbPointsTotal = orbs.reduce((s, i) => s + orbPoints(levelOrbs(level)[i]), 0);
  return {
    outcome, collected: gained, points, steps,
    time: state.t, end: { x: state.x, y: state.y },
    shieldHits: { ...state.shieldHits },
    shieldCracks, portalUses, bounces, boosts,
    orbs, orbPoints: orbPointsTotal, orbsCollected: state.orbsCollected.slice(),
    fuelUsed: state.fuelUsed, fuelLeft: state.fuel, thrustTime: state.thrustTime,
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
// `loadout` (Block 2, #1-2) is the ship the preview flies: an upgraded
// tank or stronger burn changes the stub, so the preview never lies.
export function previewShot(level, angle, power, alreadyCollected = [], t0 = 0, shieldHits = {}, orbsCollected = [], loadout) {
  const sim = simulateLaunch(level, angle, power, alreadyCollected, { record: true, t0, shieldHits, orbsCollected, loadout });
  return {
    points: sim.points,
    outcome: sim.outcome,
    collected: sim.collected,
    end: sim.end,
    time: sim.time,
    orbs: sim.orbs,
    orbPoints: sim.orbPoints,
  };
}

// ---------------------------------------------------------------- save data
// Save schema version (Block 16, #48): v1 saves (no version field, no
// stats/achievements) migrate forward on load — their stars, unlocks and
// bests are kept, the new fields start empty. Bump this when the schema
// changes and add a migration branch in parseSave.
// v4 (Block 2, #1-2): adds `upgrades` — the equipped ship upgrades.
export const SAVE_VERSION = 4;

// Lifetime counters (Block 16): every shot, collect, lost shot and trick
// the player ever pulls, so achievements and My Stats can read them.
// All counters are integers clamped to 0..999999 on load and on write.
export function defaultStats() {
  return {
    shots: 0, collects: 0, crashes: 0, slingshots: 0, portals: 0,
    bounces: 0, wins: 0, fails: 0, oneShotClears: 0, lastShotWins: 0,
    dailyWins: 0,
  };
}
const STAT_KEYS = Object.keys(defaultStats());
const STAT_MAX = 999999;

export function defaultSave() {
  return {
    version: SAVE_VERSION, stars: {}, unlocked: 1, seenHowTo: false,
    daily: null, seedBest: {}, endlessBest: 0, timeAttackBest: null,
    zenBest: 0, stats: defaultStats(), achievements: [], bestBonus: {},
    // Ship upgrades (Block 2, #1-2): equipped flags. Both start off —
    // a new player flies the base ship until the stars unlock them.
    upgrades: { thrust: false, tank: false },
  };
}

// Achievements (v2): 11 goals across the campaign. Mode achievements
// (daily / endless / zen) are dormant until those modes return in later
// blocks — no unearnable goals on the list. `check` reads the save
// (stars, bests, lifetime stats) and returns true when the goal is met;
// checkAchievements returns the newly earned ids — the ones met but not
// yet recorded in save.achievements. Pure: it never mutates.
export const ACHIEVEMENTS = [
  { id: 'first-launch', icon: '☄', name: 'First Launch', desc: 'Launch your first comet.' },
  { id: 'first-star', icon: '★', name: 'Star Catcher', desc: 'Collect your first target.' },
  { id: 'first-win', icon: '✦', name: 'Orbit Cleared', desc: 'Complete your first level.' },
  { id: 'one-shot', icon: '◎', name: 'Hole in One', desc: 'Complete a level in a single shot.' },
  { id: 'triple-star', icon: '✪', name: 'Triple Star', desc: 'Earn 3 stars on any level.' },
  { id: 'halfway', icon: '◐', name: 'Halfway Home', desc: 'Clear 3 campaign levels.' },
  { id: 'grand-tour', icon: '◉', name: 'Grand Tour', desc: 'Clear all 6 campaign levels.' },
  { id: 'constellation', icon: '✧', name: 'Constellation', desc: 'Earn all 18 campaign stars.' },
  { id: 'slingshot-10', icon: '↻', name: 'Gravity Dancer', desc: 'Skim 10 slingshot near-misses.' },
  { id: 'last-shot', icon: '♦', name: 'Down to the Wire', desc: 'Complete a level on your last shot.' },
  { id: 'gate-crasher', icon: '◍', name: 'Gate Crasher', desc: 'Fly through a portal.' },
];
const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

function achievementMet(id, save) {
  const stats = (save.stats && typeof save.stats === 'object') ? save.stats : {};
  const num = (k) => (Number.isInteger(stats[k]) && stats[k] > 0 ? stats[k] : 0);
  const cleared = LEVELS.filter((l) => (save.stars[l.id] || 0) > 0).length;
  switch (id) {
    case 'first-launch': return num('shots') >= 1;
    case 'first-star': return num('collects') >= 1;
    case 'first-win': return num('wins') >= 1;
    case 'one-shot': return num('oneShotClears') >= 1;
    case 'triple-star': return Object.values(save.stars || {}).some((s) => s === 3);
    case 'halfway': return cleared >= 3;
    case 'grand-tour': return cleared >= LEVELS.length;
    case 'constellation': return totalStars(save) >= LEVELS.length * 3;
    case 'slingshot-10': return num('slingshots') >= 10;
    case 'last-shot': return num('lastShotWins') >= 1;
    case 'gate-crasher': return num('portals') >= 1;
    default: return false;
  }
}

export function checkAchievements(save) {
  const unlocked = Array.isArray(save.achievements) ? save.achievements : [];
  const have = new Set(unlocked.filter((id) => ACHIEVEMENT_IDS.has(id)));
  return ACHIEVEMENTS
    .filter((a) => !have.has(a.id) && achievementMet(a.id, save))
    .map((a) => a.id);
}

function sanitizeStats(raw) {
  const stats = defaultStats();
  if (raw && typeof raw === 'object') {
    for (const k of STAT_KEYS) {
      if (Number.isInteger(raw[k])) stats[k] = Math.max(0, Math.min(STAT_MAX, raw[k]));
    }
  }
  return stats;
}

function sanitizeAchievements(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const id of raw) {
    if (typeof id === 'string' && ACHIEVEMENT_IDS.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// Gravity-assist bests (Block 17, #4): { levelId: best bonus points } —
// campaign levels only, integers clamped to 0..9999, anything else dropped.
function sanitizeBestBonus(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const id = Number(k);
      if (LEVELS.some((l) => l.id === id) && Number.isInteger(v)) {
        out[id] = Math.max(0, Math.min(9999, v));
      }
    }
  }
  return out;
}

// Ship upgrades (Block 2, #1-2): equipped flags, one boolean per known
// upgrade id. Unknown ids and non-booleans are dropped, so a hand-edited
// save cannot smuggle in an upgrade that does not exist.
function sanitizeUpgrades(raw) {
  const out = { thrust: false, tank: false };
  if (raw && typeof raw === 'object') {
    for (const u of UPGRADES) {
      if (raw[u.id] === true) out[u.id] = true;
    }
  }
  return out;
}

// stars: { levelId: 0..3 }, unlocked: highest unlocked level id.
// daily: { date: 'YYYY-MM-DD', stars: 0..3 } — best on today's daily level.
// seedBest: { seedLabel: 0..3 } — best stars per shared seed (capped at 100).
// endlessBest: most endless rounds cleared in one run (0..99).
// timeAttackBest: { stars: 0..15, seconds: 0..240 } — best full clear of
// Time Attack (most stars, then fastest); null until the first full clear.
// zenBest: most stars collected in one Zen Sandbox session (0..999).
// version: save schema version (SAVE_VERSION); v1 saves have no field and
// migrate on load. stats: lifetime counters (defaultStats). achievements:
// unlocked achievement ids, validated against ACHIEVEMENTS on load/write.
// bestBonus: best gravity-assist bonus points per campaign level (#4).
// upgrades: equipped ship upgrades (Block 2, #1-2) — { thrust, tank }
// booleans, sanitized to known ids. A v3 save has no field and migrates
// with both upgrades off; the unlock gate in activeLoadout still applies.
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
    version: SAVE_VERSION,
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
    stats: sanitizeStats(save.stats),
    achievements: sanitizeAchievements(save.achievements),
    bestBonus: sanitizeBestBonus(save.bestBonus),
    upgrades: sanitizeUpgrades(save.upgrades),
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
    // Save versioning (#48): a v1 save has no version field — its stars,
    // unlocks and bests are kept above and the new fields start at their
    // defaults. Whatever version was stored, the parsed save is the
    // current schema, so the next write stamps SAVE_VERSION.
    // v4 (Block 2, #1-2): a save without `upgrades` migrates with both
    // upgrades off — nothing is ever auto-equipped by a migration.
    save.version = SAVE_VERSION;
    save.stats = sanitizeStats(raw.stats);
    save.achievements = sanitizeAchievements(raw.achievements);
    save.bestBonus = sanitizeBestBonus(raw.bestBonus);
    save.upgrades = sanitizeUpgrades(raw.upgrades);
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
