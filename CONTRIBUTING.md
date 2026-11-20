# Contributing to Neon Orbit

Neon Orbit is a 3D gravity-slingshot puzzle built with Three.js (pinned
0.160.0 via an import map from jsdelivr), vanilla HTML/CSS/JS and the
Web Audio API. There is no build step — the game deploys as static files
to GitHub Pages from `main`.

## Getting started

```sh
# Serve locally (any static server works)
npm run serve        # http://localhost:8123
# or: python3 -m http.server 8123
```

Open the page, click **Play**, drag back from the comet and release to
launch. `R` retries the level, `P` pauses, `M` mutes.

## Tests — run before every pull request

```sh
npm test             # smoke (physics) + bot harness (solves every level)
npm run render-check # headless Chromium: menu, drag-launch, full campaign sweep
npm run screenshots  # regenerates docs/screenshots/ from the live game
```

All three must pass with zero console errors. The render check serves the
game locally and fulfils the pinned Three.js module from a curl cache when
the sandbox cannot reach the CDN — the repo vendors no copy of Three.js.

## Code layout

- `index.html` / `style.css` — menu, HUD, overlays, responsive layout.
- `game.js` — Three.js scene, rendering, input, audio, UI wiring.
  Exposes `window.__orbit` (state, `aim`/`launch`, `solveShot`,
  `info`, `feedbackState`, `audioState`, `visualState`, `auditState`)
  so the bot harness and the render check can drive the game.
- `physics.js` — pure game logic with no DOM or Three.js imports:
  fixed 1/120s substeps, softened inverse-square gravity, bounding-circle
  collisions, `simulateLaunch` (trajectory preview + bot solver), seeded
  RNG, save serialisation. This is where new mechanics belong.
- `tests/` — `smoke.js` (physics checks), `bot.js` (solver over every
  level), `render-check.js` (browser playtest), `screenshots.js`.
- `docs/` — `devlog.md` (per-block build notes) and `screenshots/`.

## Ground rules

- **One deep core mechanic, real progression, consistent art direction.**
  Deep-space indigo background, cyan comet + trails, magenta targets,
  gold stars, violet planets with emissive rims. No placeholder text,
  no dead buttons, no filler features.
- **Game feel per the tiers:** small events 0.10–0.20 trauma, no
  hit-stop; medium 0.30–0.50 with a 0.04–0.06s stop; large 0.70–1.00
  with a 0.10–0.15s stop. Trauma decays in real time; shake is
  trauma² on a camera offset, never on a physics body.
- **Pool, don't allocate:** particles, projectiles and transient meshes
  are pooled and reused; no per-frame allocation in hot paths.
- **Keep it playable at all times** — every change is verified by the
  smoke tests, the bot harness and the headless render check before it
  lands.
- **No new paid accounts, no credentials in files**, no auto-posting to
  social media, itch.io or forums.

## Reporting bugs / requesting features

Use the issue templates (Bug report / Feature request) and include:

- the version shown on the menu (e.g. `v0.13.0`),
- browser + OS, and whether it reproduces on the live site,
- steps to reproduce, what you expected, and what happened instead.
