# Neon Orbit

A 3D gravity-slingshot puzzle game. Drag back from the comet to aim, release
to launch, and let the planets bend your flight. Collect every magenta star
target before you run out of shots — crash into a planet or fly out of bounds
and the shot is lost. Beat par for 3 stars and unlock the next level.

**Live:** https://namdev-muse.github.io/neon-orbit/
**Version:** v0.1.0

## How to play

- **Drag** back from the comet and **release** to launch — like a slingshot.
  The gold line previews your trajectory.
- Planets **bend** your flight with gravity. Use the bend, don't fight it.
- Collect **every magenta target** before you run out of shots.
- Beat par for **3 stars** (par+1 = 2 stars, within budget = 1 star).
  Finishing a level unlocks the next one.

## Levels

| # | Name | Planets | Targets | Par |
|---|------|---------|---------|-----|
| 1 | First Light | 1 | 1 | 2 |
| 2 | Curveball | 1 | 1 | 3 |
| 3 | Twin Suns | 2 | 2 | 3 |
| 4 | The Long Way | 1 | 1 | 3 |
| 5 | Heavyweight | 1 | 2 | 4 |
| 6 | Gauntlet | 3 | 3 | 5 |

## Controls

- Mouse / touch: drag to aim, release to launch
- Arrow keys: adjust angle and power · Space: launch
- R: retry level · P: pause · M: mute

## Tech

- Three.js **0.160.0**, pinned via import map from jsdelivr — no build step.
- Physics is pure logic in `physics.js` (fixed 1/120s substeps, inverse-square
  gravity with softening, bounding-circle collisions), shared by the game,
  the trajectory preview, and the Node test harness.
- One antialiased renderer (pixel ratio capped at 2), one PerspectiveCamera
  on a separate rig so screen shake never moves colliders.
- Pooled particles, trauma-based screen shake with hit-stop, Web Audio synth
  SFX and a simple music loop.
- Best stars per level and settings persist in localStorage (`nor-stars`,
  `nor-settings`).

## Run locally

```sh
python3 -m http.server 8123
# open http://localhost:8123/
```

## Run tests

```sh
npm test            # smoke tests + bot harness
node tests/smoke.js # physics / levels / save round-trip (52 checks)
node tests/bot.js   # auto-aim solver plays all 6 levels to completion
node tests/render-check.js  # headless Chromium: menu renders, a run starts,
                            # a launch moves the comet, zero console errors
```

## License

MIT — see [LICENSE](LICENSE).
