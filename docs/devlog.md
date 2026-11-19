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
