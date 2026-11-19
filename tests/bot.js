// Neon Orbit — bot harness: auto-aim solver plays every level to completion.
// Grid-searches aim angle/power with simulateLaunch, refines the best aim,
// and plays each level shot by shot until all targets are collected.
import { LEVELS, shotBudget, starsForShots, simulateLaunch, levelHasMovingPlanets } from '../physics.js';

function solveShot(level, collected) {
  let best = null;
  const score = (res) => {
    let s = res.collected.length * 10000;
    if (res.outcome === 'crash') s -= 5000;
    if (res.outcome === 'swallowed') s -= 5000;
    if (res.outcome === 'timeout') s -= 2000;
    if (res.outcome === 'lost') s -= 500;
    s -= res.steps * 0.05; // prefer quicker shots on ties
    return s;
  };
  const consider = (angle, power, t0) => {
    const res = simulateLaunch(level, angle, power, collected, { record: false, t0 });
    const sc = score(res);
    if (!best || sc > best.score) best = { angle, power, t0, score: sc, res };
  };
  // Moving planets make the launch time part of the aim: try a spread of
  // level times (the player waits for the bend to line up). Static levels
  // only need t0 = 0.
  const t0s = levelHasMovingPlanets(level) ? [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25, 6] : [0];
  // Coarse grid: 2-degree angle steps, 0.1 power steps.
  for (const t0 of t0s) {
    for (let deg = 0; deg < 360; deg += 2) {
      for (let p = 0.15; p <= 1.001; p += 0.1) {
        consider((deg * Math.PI) / 180, p, t0);
      }
    }
  }
  // Refine around the best aim: 0.25-degree and 0.02 power steps.
  for (let d = -2; d <= 2; d += 0.25) {
    for (let dp = -0.1; dp <= 0.1001; dp += 0.02) {
      const angle = best.angle + (d * Math.PI) / 180;
      const power = Math.max(0.05, Math.min(1, best.power + dp));
      consider(angle, power, best.t0);
    }
  }
  return best;
}

let failures = 0;
for (const level of LEVELS) {
  const budget = shotBudget(level);
  const collected = [];
  let shots = 0;
  const log = [];
  while (collected.length < level.targets.length && shots < budget) {
    const best = solveShot(level, collected);
    shots++;
    const gained = best.res.collected;
    for (const i of gained) if (!collected.includes(i)) collected.push(i);
    log.push(`shot ${shots}: ${(best.angle * 180 / Math.PI).toFixed(1)}deg p=${best.power.toFixed(2)} t0=${best.t0.toFixed(2)} -> ${best.res.outcome} +${gained.length}`);
    if (gained.length === 0 && best.res.outcome === 'crash') {
      // A crashing shot that gains nothing is a wasted shot; keep trying.
    }
  }
  const complete = collected.length === level.targets.length;
  const stars = complete ? starsForShots(shots, level.par) : 0;
  console.log(`Level ${level.id} "${level.name}": ${complete ? 'COMPLETE' : 'FAILED'} in ${shots} shots (par ${level.par}, budget ${budget}) -> ${stars} star(s)`);
  for (const line of log) console.log('  ' + line);
  if (!complete) { failures++; console.error(`  BOT FAIL: level ${level.id} not completed within budget`); }
  if (complete && stars < 1) { failures++; console.error(`  BOT FAIL: level ${level.id} earned 0 stars`); }
}

if (failures > 0) {
  console.error(`\nbot: FAILED (${failures} level(s))`);
  process.exit(1);
}
console.log(`\nbot: all ${LEVELS.length} levels completed within budget, >= 1 star each`);
