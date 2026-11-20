// Neon Orbit v2 — bot harness: the thrust solver plays every campaign
// level to completion within par (3 stars), and the anti-slop gate
// asserts pure ballistics CANNOT clear any level within par — if the bot
// could one-shot a level by aiming alone, the level would not be done.
// Generated challenge levels (daily / seed / endless / zen / time
// attack) are dormant modes in v2 Block 1, but the generator still has
// to offer playable levels, so the bot still plays them ballistically
// within budget.
import {
  LEVELS, shotBudget, starsForShots, solveLevel, solveLevelThrust,
  levelById, dateSeed, dailyDifficulty, parseSeedParam, generateLevel,
  TIME_ATTACK_LEVEL_IDS, zenLevel,
} from '../physics.js';

let failures = 0;
function playLevelThrust(level) {
  const plan = solveLevelThrust(level, level.par);
  const complete = !!plan;
  const shots = complete ? plan.shots : level.par;
  const stars = complete ? starsForShots(shots, level.par) : 0;
  console.log(`Level ${level.id} "${level.name}": ${complete ? 'COMPLETE' : 'FAILED'} in ${shots} shot(s) with thrust (par ${level.par}) -> ${stars} star(s)`);
  if (plan) {
    for (const [i, line] of plan.lines.entries()) {
      console.log(`  shot ${i + 1}: ${(line.angle * 180 / Math.PI).toFixed(1)}deg p=${line.power.toFixed(2)} t0=${line.t0.toFixed(2)} fuel=${line.fuelUsed.toFixed(0)}`);
    }
  }
  if (!complete) { failures++; console.error(`  BOT FAIL: level ${level.id} not completed within par with thrust`); }
  if (complete && stars < 3) { failures++; console.error(`  BOT FAIL: level ${level.id} earned ${stars} stars, expected 3 at par`); }
  // Anti-slop gate: ballistics alone must NOT clear this level in par.
  if (solveLevel(level, level.par) !== null) {
    failures++;
    console.error(`  BOT FAIL: level ${level.id} is clearable in par WITHOUT thrust — tighten par or add hazards`);
  }
}

for (const level of LEVELS) {
  playLevelThrust(level);
}

function playLevel(level, budget, opts) {
  const plan = solveLevel(level, budget, opts);
  const complete = !!plan;
  const shots = complete ? plan.shots : budget;
  const stars = complete ? starsForShots(shots, level.par) : 0;
  console.log(`Level ${level.id} "${level.name}": ${complete ? 'COMPLETE' : 'FAILED'} in ${shots} shots (par ${level.par}, budget ${budget}) -> ${stars} star(s)`);
  if (!complete) { failures++; console.error(`  BOT FAIL: level ${level.id} not completed within budget`); }
  if (complete && stars < 1) { failures++; console.error(`  BOT FAIL: level ${level.id} earned 0 stars`); }
}

// Generated challenge levels (coarse grid — the same check the generator
// runs before offering a level, so this asserts the offer is playable).
const today = new Date(2026, 10, 20);
const daily = generateLevel(dateSeed(today), dailyDifficulty(today), 900);
daily.name = `Daily — 2026-11-20`;
playLevel(daily, shotBudget(daily), { coarse: true, t0s: [0, 1.5, 3, 4.5] });

const seed = parseSeedParam('orbit42');
const seeded = generateLevel(seed, 2 + (seed % 3), 901);
seeded.name = 'Seed orbit42';
playLevel(seeded, shotBudget(seeded), { coarse: true, t0s: [0, 1.5, 3, 4.5] });

const endless = generateLevel((424242 + 3 * 7919) >>> 0, 3, 902);
endless.name = 'Endless Round 3';
playLevel(endless, shotBudget(endless), { coarse: true, t0s: [0, 1.5, 3, 4.5] });

// Zen Sandbox: the handcrafted playground must be solvable like any
// level — the bot plays it on a 6-shot budget (its par is nominal; the
// mode itself never runs out of shots).
const zen = zenLevel();
playLevel(zen, 6, { coarse: true });

// Time Attack set: the five timed levels must all complete within
// budget — a run that cannot be finished is not a mode.
let taShots = 0;
for (const id of TIME_ATTACK_LEVEL_IDS) {
  const level = levelById(id);
  const plan = solveLevel(level, shotBudget(level));
  if (!plan) {
    failures++;
    console.error(`  BOT FAIL: time attack level ${id} not completed within budget`);
  } else {
    taShots += plan.shots;
    console.log(`Time Attack level ${id} "${level.name}": COMPLETE in ${plan.shots} shots (par ${level.par})`);
  }
}
console.log(`Time Attack set: ${taShots} solver shots across 5 levels`);

if (failures > 0) {
  console.error(`\nbot: FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log(`\nbot: all ${LEVELS.length} campaign levels cleared in par with thrust (3 stars), anti-slop gate holds, + 4 generated levels within budget`);
