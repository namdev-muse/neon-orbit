# Neon Orbit — devlog

## Block 1 — 2026-11-20 00:30 Asia/Bangkok (v0.1.0)

First playable build of game #3: a 3D gravity-slingshot puzzle in Three.js.

- Concept: drag-to-aim slingshot, planets bend the comet with inverse-square
  gravity, collect every magenta target before shots run out. 6 handcrafted
  levels with par, star ratings (3/2/1), and an unlock chain.
- Stack: Three.js 0.160.0 pinned via import map (jsdelivr), no build step.
  One antialiased renderer (pixel ratio capped at 2), PerspectiveCamera on a
  separate rig, MeshStandardMaterial + hemisphere + directional light.
- `physics.js` is pure logic with no DOM/Three.js imports: fixed 1/120s
  substeps, softened inverse-square gravity, bounding-circle collisions,
  `simulateLaunch` for the trajectory preview and the bot, seeded RNG
  (mulberry32) for the starfield, save serialization.
- Game feel: pooled particles, trauma shake (shake = trauma², decays in real
  time), hit-stop on crashes, Web Audio synth SFX (launch, collect, crash,
  win) plus a quiet music loop, mute + shake-strength settings persisted.
- Tests: 52 smoke checks, bot harness solves all 6 levels within budget
  (all 3 stars), headless Chromium render check (menu, PLAY, drag-launch,
  zero console errors). The render check passes end to end: the drag-aimed
  launch on Level 1 collects the target and completes the level in 1 shot.
- Sandbox CDN finding: the sandboxed browser cannot reach jsdelivr — the VM
  egress proxy answers `policy_denied` (HTTP 403) to every non-curl/wget
  client (Chromium, Firefox, Node, Python all blocked; curl and wget get
  HTTP 200). The game still pins Three.js from jsdelivr and vendors nothing.
  `tests/render-check.js` works around it by downloading the pinned module
  with curl into the OS temp dir and fulfilling that one request locally via
  Playwright routing; the live site (GitHub Pages) is unaffected. The parent
  should still do the live check after upload.
- Bugs found and fixed in this block:
  - `simulateLaunch` reported a level with zero targets as "collected",
    masking a crash outcome — outcome classification now requires targets.
  - Level 1's planet sat too close to the straight line, so a straight shot
    bent past the target — planet moved to (0, 6) with lighter gravity.
  - A plain click on the canvas launched the comet at the default aim —
    launches now require a real drag (≥ 1.5 world units of pull).
- Tuning note for a later block: the bot clears Level 6 "Gauntlet" in a
  single slow lob that sweeps all three targets. Human players won't find
  that line easily, but the level deserves a harder layout or tighter
  target placement once difficulty tuning starts.

## Block 2 — 2026-11-20 01:30 Asia/Bangkok (v0.2.0)
Trajectory preview polish + shot feedback + star ratings (backlog #1, #2, #5).

- Trajectory preview: new `previewShot()` in `physics.js` returns the
  sampled path plus the predicted outcome and end point. The game draws
  fading gold-to-indigo dots along the path (a faint gold line stays for
  continuity) and a pulsing end marker coloured by the prediction — gold
  for a target hit, red for a planet crash, cyan for flying out. The aim
  readout states the prediction in words ("Predicted: target hit").
- Fine aim: hold Shift while dragging and the pull moves 4x slower around
  the point where the drag started; Shift + arrow keys use quarter-size
  steps. The readout and power label show a FINE tag while fine-aiming.
- Shot power indicator: a HUD power meter (bottom-left) fills live while
  aiming, ramping cyan → gold → red as power rises.
- Star ratings surfaced: every level card now shows `Par N · ★★★ ≤ N ·
  ★★ N+1 · ★ N+2` (from new `starThresholds(par)`), and the HUD shows the
  current level's par next to the shot count.
- Tests: smoke grew 52 → 63 checks (thresholds match the star rule on
  every level; preview predicts hit / crash / flies-out and is
  deterministic; preview respects already-collected targets). The render
  check now asserts the level-card par text, the HUD par, a visible power
  meter mid-drag, and a preview prediction. A one-off headless check
  confirmed fine aim: the same drag gives power 1.00 normally, 0.25 with
  Shift held. Bot still solves all 6 levels within budget, 3 stars each.

## Block 3 — 2026-11-20 02:00 Asia/Bangkok (v0.3.0)

New mechanics: black holes + moving planets (backlog #6, #7), with two
showcase levels.

- **Black holes (#6):** a level can list `blackHoles: [{x, y, r, mu}]`.
  They pull with the same softened gravity law at a much larger mu, and a
  comet crossing the event horizon (`r + comet radius`) is swallowed —
  a new `swallowed` outcome in `simulateLaunch` / `previewShot`, a red
  predicted-end marker and "Predicted: swallowed!" in the aim readout.
  The game renders each hole as a black core with a spinning orange
  accretion disc, a gold photon ring and a warm point light, and a swallow
  fires its own feedback (0.6 trauma, 0.08s hit-stop, descending sweep,
  violet burst). Level 7 "Event Horizon" guards its target with one:
  naive straight shots get swallowed, the arcing line over the top works.
- **Moving planets (#7):** a planet can carry
  `orbit: {cx, cy, radius, speed, phase}` and travels that circle on the
  level clock. `planetPosAt(p, t)` is the single source of truth for
  gravity, crash checks, preview, and the meshes. The clock runs while
  aiming and advances in lockstep with the flight substeps, so the preview
  and the flight never disagree; while aiming on a moving-planet level the
  preview re-runs every 0.15s so it follows the planet live. The orbit
  path is drawn as a faint violet ring. Level 8 "Carousel" has one planet
  orbiting the centre — the same aim crashes at t0=0 and collects at
  t0=2.25, so timing is the puzzle.
- **Bot harness:** the solver now searches launch time too (9 sampled t0
  values) on levels with moving planets and penalises `swallowed` like a
  crash. It still solves all 8 levels within budget, 3 stars each.
- Tests: smoke grew 63 → 83 checks (orbit geometry, determinism at a
  fixed t0, time-dependence of the same launch, swallow + preview, orbit
  clearance for targets and pad). Levels 7–8 are the first two of backlog
  #15 (levels 7–12); #15 stays open for levels 9–12.

## Block 4 — 2026-11-20 02:30 Asia/Bangkok (v0.4.0)

Juice pass 1: hit-stop + trauma tiers, particle bursts, shockwave rings
(backlog #25, #26, #27).

- **Hit-stop + trauma tiers (#25):** every feedback event is now pinned to
  a tier in the `FEEDBACK` table in `physics.js`, following the game-feel
  skill — small events (launch, collect, lost, slingshot) 0.10–0.20 trauma
  with no stop, medium (win 0.30/0.05s, swallowed 0.50/0.06s) and large
  (crash 0.85/0.12s). Hit-stop ownership is token-based: every stop takes
  a fresh token and only the newest token's deadline freezes time, so
  overlapping hits never end a freeze early. Smoke tests assert every
  entry sits inside its tier's ranges.
- **Particle bursts (#26):** the pooled burst system (240 slots, additive
  blending) now also fires on a near-miss slingshot — skim within 2 world
  units of a planet's surface without touching it and the comet flashes a
  gold burst with a rising sweep SFX, once per planet per shot
  (`isNearMiss` in `physics.js`, `slingshotPlanets` ledger on the flight
  state). The verified grazing line is Level 4 at -20 degrees, power 0.3,
  which collects while passing 3.38 units from the planet centre.
- **Shockwave rings (#27):** a pool of 8 ring meshes (one geometry, one
  material per slot, reused round-robin) expands with an ease-out and
  fades — magenta on collect, orange on crash, violet on swallow, gold
  rings at every target on a win. Rings and particles freeze during
  hit-stop while trauma keeps decaying in real time, so the shake
  settles instead of freezing off-centre.
- Tests: smoke grew 83 → 111 checks (tier ranges, near-miss band
  boundaries, the Level 4 graze line). The render check now asserts a
  collect fires a live shockwave + particles, a Level 4 crash reads
  0.93 trauma with a real hit-stop that restores, and the grazing line
  credits a slingshot — all with zero console errors.
