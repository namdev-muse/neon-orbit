# Neon Orbit

A 3D gravity-slingshot puzzle game. Drag back from the comet to aim, release
to launch, and let the planets bend your flight. Collect every magenta star
target before you run out of shots — crash into a planet or fly out of bounds
and the shot is lost. Beat par for 3 stars and unlock the next level.

**Live:** https://namdev-muse.github.io/neon-orbit/
**Version:** v0.4.0

## How to play

- **Drag** back from the comet and **release** to launch — like a slingshot.
  The trajectory preview shows fading gold dots plus a pulsing end marker
  coloured by the predicted outcome (gold = target hit, red = planet crash,
  cyan = flies out), and the readout states the prediction.
- Hold **Shift** while aiming for fine adjustments (quarter-size steps, also
  with the arrow keys). The HUD power meter shows launch power live.
- Planets **bend** your flight with gravity. Use the bend, don't fight it.
- **Black holes** pull much harder and **swallow** any comet that crosses
  their event horizon — arc around them, never through them. A straight shot
  at one is lost.
- **Moving planets** orbit a centre point (the faint ring shows the path).
  The trajectory preview follows them live, so time your launch for when
  the bend lines up.
- Collect **every magenta target** before you run out of shots. Each
  collect fires a magenta shockwave ring and a particle burst; a win
  fires gold rings at every target.
- Skim close past a planet — inside 2 units of its surface without
  touching it — for a **slingshot** flash: a gold burst and a rising
  sweep. Crashing instead freezes the frame for a beat (hit-stop) and
  shakes the camera hard.
- Beat par for **3 stars** (par+1 = 2 stars, within budget = 1 star).
  Finishing a level unlocks the next one. Each level card and the HUD show
  the par and the exact star thresholds.

## Levels

| # | Name | Planets | Targets | Par |
|---|------|---------|---------|-----|
| 1 | First Light | 1 | 1 | 2 |
| 2 | Curveball | 1 | 1 | 3 |
| 3 | Twin Suns | 2 | 2 | 3 |
| 4 | The Long Way | 1 | 1 | 3 |
| 5 | Heavyweight | 1 | 2 | 4 |
| 6 | Gauntlet | 3 | 3 | 5 |
| 7 | Event Horizon | 1 + 1 black hole | 1 | 3 |
| 8 | Carousel | 1 moving | 2 | 4 |

## Controls

- Mouse / touch: drag to aim, release to launch
- Hold Shift while aiming for fine adjustments
- Arrow keys: adjust angle and power (Shift = fine) · Space: launch
- R: retry level · P: pause · M: mute

## Tech

- Three.js **0.160.0**, pinned via import map from jsdelivr — no build step.
- Physics is pure logic in `physics.js` (fixed 1/120s substeps, inverse-square
  gravity with softening, bounding-circle collisions), shared by the game,
  the trajectory preview, and the Node test harness. Black holes use the
  same gravity law with a much larger mu and an event-horizon swallow
  radius; planets with an `orbit` travel a circle around a centre point on
  the level clock, and the preview / flight / visuals all read that clock.
- One antialiased renderer (pixel ratio capped at 2), one PerspectiveCamera
  on a separate rig so screen shake never moves colliders.
- Pooled particles, trauma-based screen shake with hit-stop, Web Audio synth
  SFX and a simple music loop. Every feedback event is pinned to a tier
  in `physics.js` (`FEEDBACK`): small events 0.10–0.20 trauma with no
  stop, medium 0.30–0.50 with a 0.04–0.06s stop, large 0.70–1.00 with a
  0.10–0.15s stop — and only the newest hit-stop owns the restore, so
  overlapping hits never end a freeze early. Shockwave rings are pooled
  (8 slots, reused round-robin) and expand with an ease-out before fading.
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
node tests/smoke.js # physics / levels / save round-trip (111 checks)
node tests/bot.js   # auto-aim solver plays all 8 levels to completion
node tests/render-check.js  # headless Chromium: menu renders, a run starts,
                            # a launch moves the comet, zero console errors
```

## License

MIT — see [LICENSE](LICENSE).
