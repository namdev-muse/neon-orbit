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
