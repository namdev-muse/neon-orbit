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

## Block 5 — 2026-11-20 03:00 Asia/Bangkok (v0.5.0)

Web Audio synth SFX + music loop + mute, deepened (backlog #33, #34, #35).

- **Complete SFX set (#33):** the set now covers every event — the
  existing launch whoosh, collect chime, crash thud, slingshot sweep and
  win arpeggio, plus a descending minor fail jingle when a level runs out
  of shots, a rising unlock chime when a completion opens the next level
  (it rings 450ms after the win arpeggio), and a two-tone last-shot
  warning when the next shot is the final one. SFX and music run on
  separate gain buses under one master gain, so their balance stays
  independent. Every SFX name is recorded (`lastSfx` on the
  `window.__orbit.audioState()` hook) so the bot harness and render check
  can assert which sound fired without capturing audio.
- **Layered music with intensity (#34):** the loop now has three layers.
  Calm (intensity 0, levels 1–2) is the bass root progression. Mid
  (intensity 1, levels 3+) adds an arpeggio of chord tones on the
  off-beats. Tense (intensity 2, down to the last shot) adds a driving
  pulse on every step. The root progression also rotates by level, so
  later levels sound different. Intensity is recomputed on every music
  step from the live level and shots left, so the tension pulse starts
  the moment the last shot begins.
- **Volume slider + mute, persisted (#35):** a volume slider sits in the
  main menu and in the pause menu; both write one persisted setting
  (`nor-settings.volume`, default 0.6), update the master gain live, and
  stay in sync with each other. Mute still silences the master gain but
  remembers the volume, and the setting survives a reload.
- Tests: the render check now asserts the unlock chime fires after a
  level-1 completion, the music scheduler runs at calm intensity 0 with
  volume 0.6 unmuted, the mute toggle flips state and label and back,
  the pause-menu volume slider sets 0.3 live, persists it and syncs the
  menu slider, three burnt shots on level 1 fire the last-shot warning
  with tense intensity 1, and level 3 starts at mid intensity 1 — all
  with zero console errors.

## Block 6 — 2026-11-20 03:30 Asia/Bangkok (v0.6.0)

Daily-seed levels / challenge mode (backlog #18, #19, #22) — one seeded
generator + one solver shared by all three modes.

- **Seeded generator (#18, #22):** `generateLevel(seed, difficulty, id)`
  in `physics.js` builds a deterministic layout from a mulberry32 seed:
  pad on the left, 1–3 targets on the right, 1–3 planets placed on the
  pad → target corridor with a perpendicular offset, an optional black
  hole at difficulty 3+ and an optional moving planet at 2+ (its orbit
  circle is checked clear of the pad and targets). Every candidate is
  verified solvable by the shared coarse solver before it is offered
  (up to 8 derived-seed retries, then a known-good Level 1-style
  fallback), and par comes from the solver's shot count, clamped 2–5.
  Generated levels register under ids 900–902 so `levelById` /
  `shotBudget` / `starsForShots` work on them like campaign levels, and
  they never touch the campaign unlock chain.
- **Daily Orbit (#18):** the seed is the calendar date (YYYYMMDD), so
  everyone plays the same level; difficulty rotates 2–4 by day of year.
  The menu button shows today's date plus the best stars earned on it;
  the best is stored in the save (`daily: {date, stars}`).
- **Shareable seed links (#22):** `?seed=` accepts a number (`777`) or
  any word (`orbit42`, FNV-1a hashed) and auto-starts that exact level
  (after the first-visit how-to, so a shared link works for new players
  too); the menu seed box is prefilled from the link. Per-seed bests
  persist in the save (`seedBest`, capped at 100 entries). Retry replays
  the same seed, never a different puzzle.
- **Endless Orbit (#19):** a fresh run seed per attempt, one difficulty
  step per round (round n = difficulty n). Completing a round turns the
  Next button into "Next Round →"; failing shows how many rounds were
  cleared. Retry replays the same round.
- **Solver shared with the bot (#45, partial):** the bot harness's grid
  search moved into `physics.js` as `solveShot` / `solveLevel` (fine
  grid for the bot, coarse grid + launch-time sampling for generation
  checks). The bot now also plays today's daily level, seed `orbit42`
  and endless round 3 — all complete with 3 stars.
- **Render-check hook:** `window.__orbit.solveShot()` returns the best
  collecting line with its launch time (searching up to 3s ahead), so
  the check can wait for the level clock to reach a moving planet's
  window and launch. The browser context now runs in Asia/Bangkok —
  the headless shell's UTC clock showed yesterday's daily and the first
  run failed the date assertion. The global keydown handler now ignores
  keystrokes typed in the seed input, so typing "orbit" no longer mutes
  or restarts the game.
- Tests: smoke grew 111 → 259 checks (seed helpers, solver basics,
  generator determinism / geometry / solvability across 12 seed ×
  difficulty combos, daily + seed-best save round-trips). Bot plays 11
  levels (8 campaign + 3 generated), all 3 stars. The render check now
  asserts the daily button date, plays the daily level to completion
  (3 stars, best recorded, menu button shows ★★★), loads `?seed=777`
  and completes it (seed best recorded), and completes endless round 1
  then advances to round 2 at difficulty 2 — all with zero console
  errors.

## Block 7 — 2026-11-20 04:30 Asia/Bangkok (v0.7.0)

UI pass — campaign map, best-stars table, failed-screen stats — backlog
items #23, #43, #38 (features_done 14 → 17/60).

- **Campaign map (#23):** the level select is now a campaign map — a
  progress bar above the grid shows levels cleared (x/8) and stars
  earned (x/24) with a cyan-to-gold fill, and the next uncompleted
  unlocked level gets a gold "NEXT" ring so the player always sees where
  the run continues. The existing cards already showed par + star
  thresholds per level; the map adds the run-level picture.
- **Best-stars table (#43):** a new "My Stats" button opens an overlay
  with one row per campaign level (name, best stars, par), a totals line
  (stars x/24, levels cleared x/8), and the challenge bests — today's
  daily best, the endless run record, and how many shared seeds have a
  recorded best. Locked levels show "Locked" instead of stars.
- **Level-failed screen (#38):** the "Out of Shots" screen now shows the
  attempt stats — shots used vs budget, par, and the best already banked
  on that level (campaign) or in that mode (daily / seed / endless) —
  and gains a third button, "Level Select", which returns to the menu and
  scrolls the campaign map into view. Retry and Main Menu are unchanged.
- **Endless record:** the save gains `endlessBest` (most rounds cleared
  in one run), recorded both when a round is cleared and when a run ends,
  round-tripped and validated like the other bests (0–99, defaults to 0
  for old saves).
- Tests: smoke grew to 263 checks (endless-best round-trip + validation).
  The render check now asserts the campaign progress bar and NEXT ring on
  the fresh menu, opens My Stats (8 rows, 0/24 totals, challenge bests)
  and closes it, burns level 1's last shot to reach the failed screen
  (stats "Shots used: 4 / 4 · Par 2 · Best on this level: ★★★") and
  returns via Level Select — all with zero console errors.

## Block 8 — 2026-11-20 05:00 Asia/Bangkok (v0.8.0)

Touch, keyboard-only play, responsive + camera zoom — backlog items
#40, #41, #42 (features_done 17 → 20/60).

- **Touch controls (#40):** a quick tap (under 300 ms, under 14 px of
  movement) now launches with the current aim instead of doing nothing,
  so touch players can tap to shoot. Drag-aim only starts on the first
  move, so a tap never re-aims before it fires. A second finger cancels
  the aim drag and starts a pinch (see #42); extra fingers are ignored.
  `overscroll-behavior: none` stops pull-to-refresh fighting the game,
  and pointer capture is wrapped in try/catch so synthetic pointer
  events can never break a drag.
- **Keyboard-only play (#41):** Enter does the obvious thing on every
  screen — Play on the menu, launch while aiming, Next on completion,
  Retry on failure, Resume when paused (a focused button still handles
  Enter natively, so nothing double-fires). Arrow keys move focus
  between the enabled level buttons on the menu, wrapping around the
  grid. Escape closes How to Play and My Stats. Every overlay focuses
  its primary button on open, and starting a level blurs the hidden
  menu button so Space always owns the launch. Found while testing:
  the stats overlay never set `state.phase` (it stayed `menu`), so
  Escape/Enter there did nothing — fixed by tracking `stats` as a real
  phase and restoring `menu` on close.
- **Responsive + camera zoom (#42):** the camera zooms 0.6×–2× via the
  mouse wheel, a two-finger pinch, the HUD − / + buttons (with a live
  % label), or the + / − keys; the factor is clamped in `physics.js`
  (`clampZoom`) and persists in `nor-settings`. Small screens get a
  400 px pass (tighter type and buttons) and a short-landscape pass
  (the tagline hides, the panel shrinks so the menu fits).
- Tests: smoke grew to 281 checks (zoom clamp, tap-gesture windows,
  roving-focus wrap). The render check now asserts the whole Block 8
  flow — Enter starts the game, arrows adjust aim, Space launches, P
  pauses with Resume focused, Escape closes My Stats, menu arrows wrap
  focus to Carousel, wheel / buttons / keys zoom with 0.6–2.0 clamping,
  a real touchscreen tap launches, a synthetic pinch-out zooms 1 →
  1.42 without launching, and a 390×844 viewport has no horizontal
  overflow with a 2-column grid — all with zero console errors.

## Block 9 — 2026-11-20 05:30 Asia/Bangkok (v0.9.0)

Portals + shields + bounce mechanics — backlog items #8, #9, #10
(features_done 20 → 23/60). Three new campaign levels (9–11), 33 stars
total.
- **Portals (#8):** portals come in pairs sharing a `pair` index. Flying
  into one teleports the comet out of its twin with the entry velocity
  unchanged, placed just outside the twin's trigger radius along the
  flight direction so it never re-triggers instantly. The pair then cools
  down for 0.6s so a fast return pass is not eaten. Twins share a colour
  (cyan, gold, violet): a torus ring that breathes plus a swirling
  additive disc. The hop fires a small-tier feedback event (trauma 0.15),
  a cyan burst + shockwave, and a rising "portal" shimmer SFX. Level 9
  "Portal Hop" puts a planet on the direct line and a portal pair around
  it — the solver's first line hops the portal to collect the far target.
- **Shielded targets (#9):** a target with `hits: 2` needs two contacts.
  The first cracks the shield (small-tier event, white burst, metallic
  clink SFX, shield ring vanishes); the second collects it. A shield can
  only be hit once per shot, and the crack persists across shots in the
  same attempt — `state.shieldHits` (target → hits remaining) is threaded
  through `launchState`, `simulateLaunch`, the preview, and the solver,
  so the preview and the bot both know a cracked shield is one hit from
  collecting. The solver scores a crack at 4000 (a collect is 10000), so
  it plans crack-then-collect lines. Level 10 "Shielded Stars" has two
  shielded targets: 4 shots at par, 3 stars. The `__orbit.solveShot`
  hook now returns crack-only shots too (with `shieldCracks`), so the
  render check can drive a shielded level through it.
- **Bounce pads (#10):** a circular reflector (lime disc + bright rim)
  reflects the comet's velocity about the radial normal, once per pad per
  shot, and pushes the comet just outside the pad so the same contact
  never fires twice. Small-tier feedback (trauma 0.15), a lime burst +
  shockwave, and a short rubbery "bounce" blip SFX. Level 11 "Bounce
  House" hides a target behind a heavy planet; the bot-verified line
  (37.5°, power 0.59) arcs over the pad's top and reflects down onto it.
- Tests: smoke grew to 321 checks (portal teleport + cooldown, bounce
  reflection + once-per-shot, shield crack/collect/preview, solver plans
  that use the portal and the bounce, level 10 taking exactly 4 shots).
  The bot completes all 14 levels (11 campaign + daily/seed/endless)
  within budget, 3 stars each. The render check now asserts the portal
  hop (portalCount 1, portal SFX) and completion on level 9, the shield
  crack persisting in state (`{"0":1}`, shieldhit SFX) and completion in
  4 shots on level 10, and the bounce (bounceCount 1, bounce SFX) on the
  37.5° line plus completion on level 11 — all with zero console errors.
- Bug found by the render check (fixed before pushing): the
  `__orbit.solveShot` hook returned null for any shot that collected
  nothing, so on a shielded level it could never return the crack shot
  and the render check stalled on level 10. It now returns crack-only
  shots as well.

## Block 10 — 2026-11-20 06:00 Asia/Bangkok (v0.10.0)

Moving targets + timed levels + difficulty balance — backlog items #11,
#20, #24 (features_done 23 → 26/60). One new campaign level (12),
36 stars total.

- **Moving targets (#11):** a target with an `orbit` drifts on a circle
  around a centre point at `speed` rad/s from `phase`, exactly like a
  moving planet — `(x, y)` is its position at t = 0. The collect check
  in `stepFlight` reads `targetPosAt(target, levelTime)`, so a shot must
  meet the target where it is, not where it started; the preview and the
  solver search launch times on moving-target levels the same way they
  already did for moving planets. The meshes, rings and shield rings are
  repositioned every frame, and each drifting target shows its orbit path
  as a faint magenta ring. Level 12 "Moving Stars" has two of them
  orbiting in opposite directions (0.35 and -0.45 rad/s) around one
  planet — the solver's line waits until t0 = 6.0 and lobs slowly to meet
  both.
- **Time Attack (#20):** one shared 4:00 clock across campaign levels
  1–5. Clearing a level banks its stars into the run total and advances
  to the next; the run ends when the clock hits zero, a level runs out
  of shots, or all five are cleared. The HUD shows a gold `⏱ M:SS`
  timer (refreshed once per second while aiming or flying, frozen while
  paused), the complete screen shows banked stars and time left, and a
  full clear records the best (`timeAttackBest`: most stars, then
  fastest) in the save — a partial run never records a best. Retry
  restarts the whole run, since the clock cannot be rewound. The music
  turns tense under 30 seconds on the clock.
- **Difficulty tuning (#24):** par is now the solver's minimal shot
  count + 1 slack shot (minimum 2), except level 10 whose par 4 is its
  designed minimum. Retuned: L2 3→2, L4 3→2, L5 4→3, L7 3→2, L8 4→3.
  Gauntlet (L6) was the worst offender — the bot cleared it in one slow
  lob (63°, power 0.25) against a par of 5. Its targets are now smaller
  (r 1.4) and spread further apart (16,9 / 17,-9 / 8,12), so the lob
  collects one at most and the solver needs 2 shots; par 5→3. Every
  level is still 3-starred by the solver at its new par.
- Tests: smoke grew to 357 checks (moving-target positions and timed
  collect/miss, solver timing on level 12, the broken Gauntlet lob, the
  retuned pars, time attack constants and clock formatting, the
  timeAttackBest save round-trip). The bot completes all 15 levels
  (12 campaign + daily/seed/endless) within budget, 3 stars each, and
  the 5-level Time Attack set in 7 solver shots. The render check now
  asserts level 12 (two moving targets, meshes drift 0.68 units in
  1.2s, completes through the solver hook) and Time Attack (HUD timer
  `⏱ 4:00`, clock 239.9s at start, level 1 banks 3 stars and advances
  to 2/5 with 238.2s left) — all with zero console errors.
- Bug found by the render check (fixed before pushing): the crash-trauma
  assertion read trauma in a separate evaluate after the hit-stop wait,
  and on the slow headless frame it had decayed from 0.85 to 0.37. The
  check now reads trauma atomically with the hit-stop wait (the
  waitForFunction returns the feedback state itself), and the crash reads
  0.85 again.

## Block 11 — 2026-11-20 06:30 Asia/Bangkok (v0.11.0)

Browser playtest + bot harness + bugfix pass 1 — backlog items #45,
#47, #37 (features_done 27 → 30/60). No new levels or mechanics this
block: the whole campaign is now bot-verified inside the live game, and
the game defends itself against corrupted state.

- **Bot harness plays every level (#45):** the headless render check
  now sweeps the six campaign levels no earlier section completed in
  the browser (2, 3, 4, 5, 6, 8) through the live game's public hooks,
  asserting completion and >= 1 star each. Together with the levels
  already played above (1, 7, 9, 10, 11, 12) plus daily / seed /
  endless / Time Attack level 1, all 12 campaign levels are now
  completed in the browser in a single run — and the sweep earned 3
  stars on every one (L2 in 1 shot, L3 in 2, L4 in 1, L5 in 2, L6 in 2,
  L8 in 2). The Node bot still covers all 15 levels (12 campaign +
  daily/seed/endless) within budget, 3 stars each.
- **State audit + NaN guards (#47):** `launchState` sanitises its
  input (NaN angle/power fall back to a still comet, ±Infinity power
  clamps to full), and `stepFlight` ends a flight whose position or
  velocity goes non-finite as a new `'invalid'` event instead of
  letting NaN comparisons silently never fire — a corrupted comet used
  to fly forever and never resolve. On top of that, `game.js` runs a
  1-second audit while a level is running: level clock, flight state,
  comet mesh and shot counters must all be finite and in range. A
  corrupt flight mid-shot is ended as a lost shot; a bad clock or
  counter restarts the level; the audit never throws, and its counts
  are exposed through `__orbit.auditState()`. A test-only
  `__orbit.testCorrupt('flight' | 'time')` hook lets the render check
  exercise both paths.
- **Pause menu (#37):** Restart Level and Quit to Menu already existed
  but were never clicked for real — the render check now launches a
  shot, pauses mid-flight, restarts (fresh aim, 0 shots used), pauses
  again and quits back to the menu.
- Tests: smoke grew to 370 checks (13 new: launchState sanitising,
  stepFlight invalid events for NaN x/y/vx/vy and infinite position,
  a healthy step still advancing, simulateLaunch from NaN input
  terminating with a known outcome and finite end). The render check
  now asserts the sweep (3 stars each), the pause buttons, a corrupted
  flight ending cleanly as a lost shot (aim, 1 shot used), and the
  audit catching a bad level clock and restarting the level (1
  failure, 1 recovery, "levelTime is not finite") — all with zero
  console errors.
- Bug found by the smoke tests (fixed before pushing): the first
  `launchState` guard used `Number.isFinite(power)`, so infinite power
  fell back to a still comet instead of clamping to full speed. It now
  clamps any non-NaN power into 0..1 and only falls back on NaN.

## Block 12 — 2026-11-20 07:00 Asia/Bangkok (v0.12.0)

Theme: visual polish — nebula background, planet glow, trails.

- **Comet trail glow (#28):** the comet's trail is now a fading ribbon,
  not just a line — a triangle strip built from the last 48 flight
  positions, tapering from 0.55 units wide at the head to a point at the
  tail, its vertex colours fading cyan to black so additive blending
  melts it into the dark. The thin cyan line stays as a bright core.
  `updateTrailLine` rebuilds both every frame from `trailHistory`.
- **Planet atmosphere glow + nebula background (#29):** one shader per
  effect. Every planet wears a fresnel halo — a backside sphere 1.45x
  the planet, additive, in the planet's own colour (`glowColor`
  uniform), riding with moving planets. Behind the starfield, a 240-unit
  plane runs a slowly drifting 2-octave value-noise nebula in violet /
  magenta / cyan, its `uTime` uniform advanced every frame. The noise
  hash is a cheap fract hash, not `sin` — the first version used a
  sin-based hash and 3 octaves (see the perf bug below).
- **Level-complete confetti (#30):** a pool of 90 small 3D shards (gold,
  magenta, cyan, violet, white) bursts from every collected target on
  level complete — 25 per target — tumbling under gravity, spinning, and
  shrinking away over ~2s. Pooled and reused, no allocation per win.
  A new `__orbit.visualState()` hook exposes trail length, ribbon
  visibility, the nebula clock, glow count and live confetti for the
  render check.
- Tests: smoke stays 370 checks (physics untouched; only the version
  check bumped to 0.12.0), bot 15/15 levels 3 stars. The render check
  now asserts the nebula clock is running, 1 glow halo on level 1, the
  ribbon visible mid-flight (5 points), and 50 confetti shards live on
  level complete (two 25-shard bursts overlapped — the solver's grid
  search blocks the main thread briefly, freezing the earlier burst's
  decay). Zero console errors.
- Perf bug found by the render check (fixed before pushing): the first
  nebula shader (sin-based hash, 3-octave fbm, fullscreen) doubled the
  frame cost under swiftshader — in-level ~8fps, game time ~0.36x real
  time — and the campaign sweep timed out waiting for a shot to resolve
  (a 10s-max flight takes ~28s of real time there). A frame-rate probe
  (`/tmp/probe-fps.mjs`, kept out of the repo) showed the nebula cost
  ~11fps: without it the same scene runs ~19fps. The fix was a cheap
  fract hash + 2 octaves, and the render check's game-time-bound waits
  moved from 15s to 30s (10s to 20s) with a comment explaining why —
  on a real GPU the game runs at 60fps and these waits resolve in
  seconds. The FPS guard (#46, Block 14) is the proper home for
  slow-device handling.

## Block 13 — 2026-11-20 07:30 Asia/Bangkok (v0.13.0)

Theme: README + screenshots + repo polish.

- **README gameplay screenshots (#55):** three real captures from a
  headless-Chromium run of the live game, now in `docs/screenshots/` and
  embedded in the README's new Gameplay section — `menu.png` (main menu,
  v0.13.0, all modes + campaign progress), `gameplay.png` (Level 1
  mid-flight, comet trail ribbon glowing past the planet toward the
  magenta target), `complete.png` (Level Complete, 3 stars in 1 shot,
  confetti burst). A new `tests/screenshots.js` regenerates them
  (`npm run screenshots`): it serves the game locally, reuses the
  render check's curl-cached Three.js fulfilment, launches Level 1
  through the solver hook, waits for the trail ribbon (`trailPoints
  >= 5`) and the confetti (`confettiActive >= 5`), and fails on any
  console/page error. The three PNGs were eyeballed after capture —
  real frames, not blank screens.
- **Devlog kept updated (#56):** this entry; the devlog now covers
  Blocks 1-13 with the per-block features, test counts and bugs found.
- **Issue templates + contributing guide (#57):** `.github/ISSUE_TEMPLATE/`
  gains a bug report (version, browser/OS, steps, level/mode) and a
  feature request (idea, why it fits the core mechanic, how it could
  work), plus `config.yml` disabling blank issues and linking the live
  game and the guide. New `CONTRIBUTING.md` documents the stack, the
  local setup, the three test commands, the code layout (`physics.js`
  is pure logic, `game.js` owns the scene, `window.__orbit` is the
  public test hook), and the ground rules (one deep mechanic, trauma
  tiers, pooled particles, no credentials, no auto-posting).
- Tests: smoke 370 checks PASS, bot 15/15 levels 3 stars. Render check
  re-run for the version bump (menu v0.13.0, full campaign sweep).

## Block 14 — 2026-11-20 08:00 Asia/Bangkok (v0.14.0)

Theme: GitHub Pages verify + perf + accessibility.

- **FPS guard (#46):** a frame-time EMA in `physics.js`
  (`createPerfGuard`, pure and Node-testable) steps the quality down
  after 1s above a 24ms EMA and back up after 3s under 14ms — four
  levels (pixel ratio 2 → 1.5 → 1.25 → 1, particle scale 1 → 0.75 →
  0.5 → 0.35), with hysteresis so it never flaps. `game.js` feeds it
  every animation frame and applies a level change to the renderer and
  the burst/confetti budgets; `__orbit.perfState()` reports the EMA,
  level, applied pixel ratio and step counts, and `testPerf()` feeds
  synthetic frame times for the render check. Corrupted frame times
  (NaN / infinite / negative) are ignored.
- **Settings toggles, completed (#44):** reduce-motion and music
  checkboxes join the volume slider in the menu and the pause menu —
  one handler per checkbox, all four synced, persisted in
  `nor-settings`. Reduce motion defaults to the OS
  `prefers-reduced-motion` setting on a first visit. It zeroes screen
  shake at the source, skips shockwave rings and confetti, and holds
  the predicted-end marker steady; the sound and the small particle
  burst still fire so every event reads. The music toggle stops the
  scheduler when off (SFX keep playing) and restarts it when on.
- **Accessibility pass (#50):** a visually hidden live region
  (`#sr-status`, `role="status"`, `aria-live="polite"`) announces
  level starts, collects, lost shots, wins and failures, so the game
  is playable by ear. Every interactive element now shows the same
  visible cyan focus outline (`:focus-visible` on buttons, icon
  buttons, level buttons, sliders, checkboxes and inputs), and a
  `prefers-reduced-motion` media query kills CSS transitions. Muted
  text (#9aa7c7 on #070313, 8.5:1) already clears WCAG AA.
- Also fixed: the `game.js` header comment still said v0.11.0 (the
  Block 13 nit) — now v0.14.0 everywhere.
- Tests: smoke 383 checks PASS (13 new: guard thresholds, hold
  behaviour, step down/up, clamping, corrupted frames), bot 15/15
  levels 3 stars. Render check re-run for the version bump (menu
  v0.14.0, live-region announcement, focus/reduced-motion CSS,
  reduce-motion zero-trauma probe, music toggle, FPS guard step
  down/up, full campaign sweep).

## Block 15 — 2026-11-20 08:30 Asia/Bangkok (v0.15.0)

Theme: Extra modes (endless orbit, time attack, zen sandbox).

- **Zen Sandbox (#21):** a free orbit playground — unlimited shots, no
  fail state, collected stars drift back onto the field 1.5s after
  collection. One static planet, one moving planet (radius-7 orbit), one
  black hole and three stars, hand-placed so every clearance rule holds
  and the bot solver clears it in 2 shots. `shotBudget()` returns
  `Infinity` for a zen level, so the HUD shows `Shots n · ∞` and
  `endShot` can never complete or fail the level; the session star count
  is banked live as `save.zenBest` and shown in My Stats. Respawn timers
  carry a generation token, so quitting or restarting can never resurrect
  a target in a later level. Menu button, `__orbit.playZen()` hook, and
  a how-to entry.
- **Near-miss slow-mo (#31):** a slingshot dips the simulation time scale
  to 0.35× for 450ms of real time, so the player can watch the bend. The
  scale is a pure helper (`slowMoScale`, Node-tested: 0.35 inside the
  window, 1 outside it, 1 under reduce motion, 1 on a corrupted clock)
  applied to the simulation dt in the animate loop; trauma decay, the
  nebula and the Time Attack clock stay on real time, so a dip can never
  buy extra seconds or freeze the game slow. Latched in `slowMoCount`
  per shot for the render check.
- Two real bugs found by the render check and fixed in this block: (1)
  the 1s state audit's `shotsLeft` check required a finite integer, so
  Zen's infinite budget tripped it on every launch and the audit killed
  the flight as a lost shot within a second — the audit now allows
  `Infinity` exactly when the budget is infinite. (2) The audit's
  corrupt-flight recovery ended the shot silently — which path fired was
  a race between the audit and the next animation frame, so the recovery
  now gives the same lost-shot feel (sound, burst, "out of bounds"
  announcement) as the physics guard's `invalid` path, with the burst
  position falling back to the pad when the flight itself is NaN.
- Also fixed: the `index.html` version paragraph still said v0.13.0 (the
  Block 14 nit) — now v0.15.0 everywhere.
- Tests: smoke 400 checks PASS (17 new: zen layout/clearances/budget/
  solvability/registration, slow-mo scale/window/reduce-motion/corrupt
  clock, zenBest round-trip/clamp), bot 16/16 levels 3 stars (Zen
  Sandbox in 2 shots). Render check PASS in ~7.1 min, zero console
  errors (menu v0.15.0, slingshot slow-mo dip, Zen solver collect +
  respawn + miss-without-failing + zen best 3 saved, full campaign
  sweep).
