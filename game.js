// Neon Orbit — Three.js 3D gravity-slingshot puzzle (v0.9.0).
// Drag back from the comet to aim, release to launch. Planets bend the
// flight with gravity; collect every magenta target before shots run out.
import * as THREE from 'three';
import {
  LEVELS, PLAYFIELD_RADIUS, SUBSTEP,
  levelById, shotBudget, starsForShots, starThresholds, isLevelComplete,
  generateDecor, launchState, stepFlight, previewShot, planetPosAt,
  levelHasMovingPlanets, levelBlackHoles, levelPortals, levelBouncePads,
  targetHits, FEEDBACK, isNearMiss,
  defaultSave, serializeSave, parseSave, totalStars,
  dateSeed, dateKey, dailyDifficulty, endlessDifficulty, parseSeedParam,
  generateLevel, registerGeneratedLevel, solveShot,
  clampZoom, isTapGesture, focusStep,
} from './physics.js';

export const VERSION = '0.9.0';
const THREE_VERSION = '0.160.0';
const SAVE_KEY = 'nor-stars';
const SETTINGS_KEY = 'nor-settings';
const MAX_DRAG = 12; // world units of pull for full launch power
const PREVIEW_MAX = 240;
const PREVIEW_DOTS = 96; // fading trajectory dots sampled from the preview
const FINE_AIM_SCALE = 0.25; // Shift-held drag moves the aim 4x slower
const TRAIL_MAX = 48;
const PARTICLE_MAX = 240;

// ---------------------------------------------------------------- state
// Challenge-mode ids: generated levels register under these ids and
// never touch the campaign unlock chain (campaign levels are 1..8).
const DAILY_ID = 900;
const SEED_ID = 901;
const ENDLESS_ID = 902;

const state = {
  version: VERSION,
  phase: 'menu', // menu | howto | aim | fly | complete | failed | paused
  mode: 'campaign', // campaign | daily | seed | endless
  levelId: 1,
  levelName: '',
  shotsUsed: 0,
  shotsLeft: 0,
  targetsRemaining: 0,
  collected: [],
  // Shield state for this attempt: target index -> hits remaining on a
  // shielded target (2 at level start, 1 once cracked). Persists across
  // shots until the level restarts; the preview and solver read it so a
  // cracked shield shows as one hit from collecting.
  shieldHits: {},
  aimAngle: 0,
  aimPower: 0.6,
  fineAim: false,
  previewOutcome: 'none', // collect | crash | lost | none (predicted shot end)
  previewEnd: null, // { x, y } predicted end of the previewed shot
  stars: 0,
  unlocked: 1,
  phaseBeforePause: 'aim',
  challengeSeed: 0,
  seedLabel: '',
  endlessRound: 0,
  endlessBaseSeed: 0,
  dailyDate: '',
};

function loadSave() {
  try {
    return parseSave(window.localStorage.getItem(SAVE_KEY) || '');
  } catch {
    return defaultSave();
  }
}
function persistSave() {
  try { window.localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* storage unavailable */ }
}
function loadSettings() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      muted: !!raw.muted,
      volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : 0.6,
      shake: typeof raw.shake === 'number' ? Math.max(0, Math.min(1, raw.shake)) : 1,
      zoom: clampZoom(raw.zoom),
    };
  } catch {
    return { muted: false, shake: 1, zoom: 1 };
  }
}
function persistSettings() {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

let save = loadSave();
let settings = loadSettings();
state.unlocked = save.unlocked;

// Camera zoom (Block 8): 1 = the whole playfield fits, >1 zooms in, <1
// pulls back. Persisted with the other settings; fitCamera applies it.
let cameraZoom = settings.zoom;
function setZoom(v) {
  cameraZoom = clampZoom(v);
  settings.zoom = cameraZoom;
  persistSettings();
  fitCamera();
  updateZoomLabel();
}
function updateZoomLabel() {
  const el = $('zoom-label');
  if (el) el.textContent = `${Math.round(cameraZoom * 100)}%`;
}

// ---------------------------------------------------------------- audio
// Two buses under one master gain: SFX (short, punchy) and music (quiet,
// layered). Volume scales the master; mute silences it but remembers the
// volume. Every SFX name is recorded in lastSfx so the bot harness and
// render check can assert which sound fired, without capturing audio.
let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let musicTimer = null;
let musicStep = 0;
let nextNoteTime = 0;
let lastSfx = null;
let lastSfxAt = 0;
const MUSIC_ROOTS = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
const ARP_STEPS = [2, 3, 4, 3]; // chord-tone multipliers for the arp layer

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = settings.muted ? 0 : settings.volume;
    masterGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(masterGain);
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.7;
    musicGain.connect(masterGain);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function applyVolume() {
  if (masterGain) masterGain.gain.value = settings.muted ? 0 : settings.volume;
}

function setVolume(v) {
  settings.volume = Math.max(0, Math.min(1, v));
  persistSettings();
  applyVolume();
  updateVolumeLabels();
}

function toneAt(freq, at, dur, type, vol, slideTo, bus) {
  if (!audioCtx || !bus) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(bus);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function tone(freq, dur, type, vol, slideTo, delay) {
  if (!audioCtx) return;
  toneAt(freq, audioCtx.currentTime + (delay || 0), dur, type, vol, slideTo || null, sfxGain);
}

function noiseBurst(dur, vol, cutoff) {
  if (!audioCtx || !sfxGain) return;
  const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = audioCtx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(sfxGain);
  src.start();
}

function recordSfx(name) {
  lastSfx = name;
  lastSfxAt = Date.now();
}

const sfx = {
  click() { recordSfx('click'); tone(660, 0.06, 'square', 0.05); },
  launch() {
    recordSfx('launch');
    tone(180, 0.3, 'sawtooth', 0.1, 720);
    noiseBurst(0.25, 0.07, 1200);
  },
  collect() {
    recordSfx('collect');
    tone(880, 0.12, 'sine', 0.16);
    tone(1318, 0.18, 'sine', 0.16, null, 0.07);
  },
  crash() {
    recordSfx('crash');
    tone(90, 0.35, 'sine', 0.28, 40);
    noiseBurst(0.3, 0.22, 500);
  },
  lost() { recordSfx('lost'); tone(320, 0.4, 'sine', 0.1, 140); },
  swallow() {
    recordSfx('swallow');
    tone(320, 0.5, 'sine', 0.2, 40);
    noiseBurst(0.3, 0.1, 400);
  },
  slingshot() {
    recordSfx('slingshot');
    tone(240, 0.35, 'sine', 0.12, 960);
    tone(480, 0.2, 'triangle', 0.06, 1440, 0.05);
  },
  // Portal hop: a rising shimmer as the comet exits the twin portal.
  portal() {
    recordSfx('portal');
    tone(300, 0.25, 'sine', 0.12, 1200);
    tone(600, 0.2, 'sine', 0.08, 1800, 0.04);
  },
  // Bounce pad: a short rubbery blip, low then high.
  bounce() {
    recordSfx('bounce');
    tone(520, 0.1, 'square', 0.08, 260);
    tone(780, 0.08, 'square', 0.05, null, 0.06);
  },
  // Shield crack: a metallic clink — two detuned highs plus a tick.
  shieldhit() {
    recordSfx('shieldhit');
    tone(1180, 0.1, 'square', 0.07);
    tone(1240, 0.1, 'square', 0.06, null, 0.02);
    noiseBurst(0.06, 0.06, 4000);
  },
  win() {
    recordSfx('win');
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'sine', 0.15, null, i * 0.09));
  },
  // Descending minor jingle when a level is failed (out of shots).
  fail() {
    recordSfx('fail');
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, null, i * 0.12));
  },
  // Rising chime when a level completion unlocks the next level.
  unlock() {
    recordSfx('unlock');
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.2, 'sine', 0.13, null, i * 0.08));
  },
  // Two-tone warning when the next shot is the last one.
  lastShot() {
    recordSfx('lastShot');
    tone(1046, 0.09, 'square', 0.07);
    tone(784, 0.14, 'square', 0.07, null, 0.12);
  },
};

// Music intensity: 0 = calm (bass layer only), 1 = mid (bass + arpeggio,
// levels 3+), 2 = tense (adds a driving pulse on the last shot). The root
// progression rotates by level so later levels sound different.
function musicIntensity() {
  let intensity = state.levelId >= 3 ? 1 : 0;
  if ((state.phase === 'aim' || state.phase === 'fly') && state.shotsLeft <= 1) intensity += 1;
  return Math.min(2, intensity);
}

function scheduleMusicStep(step, at) {
  const bar = Math.floor(step / 8) % MUSIC_ROOTS.length;
  const root = MUSIC_ROOTS[(state.levelId - 1 + bar) % MUSIC_ROOTS.length];
  const intensity = musicIntensity();
  // Layer 1 — bass, always on.
  if (step % 2 === 0) toneAt(root, at, 0.5, 'triangle', 0.045, null, musicGain);
  if (step % 8 === 4) toneAt(root * 2, at, 0.4, 'sine', 0.035, null, musicGain);
  if (step % 16 === 14) toneAt(880, at, 0.3, 'sine', 0.022, null, musicGain);
  // Layer 2 — arpeggio, levels 3+ (intensity >= 1): chord tones on the
  // off-beats, cycling root*2 / *3 / *4 / *3.
  if (intensity >= 1 && step % 2 === 1) {
    const mult = ARP_STEPS[Math.floor(step / 2) % ARP_STEPS.length];
    toneAt(root * mult, at, 0.22, 'sine', 0.02, null, musicGain);
  }
  // Layer 3 — tension pulse, last shot only (intensity 2): a short, fast
  // tick on every step that pushes the tempo of the moment.
  if (intensity >= 2) {
    toneAt(root * 4, at, 0.08, 'triangle', 0.02, null, musicGain);
  }
}

function startMusic() {
  if (musicTimer || !audioCtx) return;
  nextNoteTime = audioCtx.currentTime + 0.1;
  musicStep = 0;
  musicTimer = window.setInterval(() => {
    if (!audioCtx) return;
    while (nextNoteTime < audioCtx.currentTime + 0.5) {
      scheduleMusicStep(musicStep, nextNoteTime);
      musicStep++;
      nextNoteTime += 0.25;
    }
  }, 200);
}

function toggleMute() {
  settings.muted = !settings.muted;
  persistSettings();
  applyVolume();
  updateMuteLabels();
}

function updateMuteLabels() {
  const label = settings.muted ? 'Sound: Off' : 'Sound: On';
  for (const id of ['btn-mute-menu', 'btn-mute-hud', 'btn-mute-pause']) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

function updateVolumeLabels() {
  for (const suffix of ['menu', 'pause']) {
    const range = document.getElementById(`volume-range-${suffix}`);
    const value = document.getElementById(`volume-value-${suffix}`);
    if (range) range.value = String(Math.round(settings.volume * 100));
    if (value) value.textContent = `${Math.round(settings.volume * 100)}%`;
  }
}

// ---------------------------------------------------------------- three setup
const container = document.getElementById('game-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070313);

// Camera rig: shake moves the rig only, never gameplay objects or colliders.
const cameraRig = new THREE.Group();
scene.add(cameraRig);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 0, 54);
cameraRig.add(camera);
camera.lookAt(0, 0, 0);

const hemi = new THREE.HemisphereLight(0x8b7cf6, 0x0b0620, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(10, 15, 20);
scene.add(sun);

// Shared geometries / materials (reused, never rebuilt per frame).
const planetGeo = new THREE.SphereGeometry(1, 40, 28);
const targetGeo = new THREE.OctahedronGeometry(1, 0);
const cometGeo = new THREE.SphereGeometry(0.5, 24, 18);
const planetRingGeo = new THREE.TorusGeometry(1, 0.035, 8, 64);
const targetRingGeo = new THREE.TorusGeometry(1.9, 0.045, 8, 64);
const targetMat = new THREE.MeshStandardMaterial({
  color: 0xff2d95, emissive: 0xff2d95, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.1,
});
const targetRingMat = new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.55 });
const planetRingMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.5 });
const cometMat = new THREE.MeshStandardMaterial({
  color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1,
});
// Black hole materials: a light-swallowing core, a hot accretion disc and
// a thin gold photon ring so the hole reads on the dark background.
const bhGeo = new THREE.SphereGeometry(1, 32, 24);
const bhMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const bhDiscGeo = new THREE.TorusGeometry(1, 0.14, 8, 64);
const bhDiscMat = new THREE.MeshBasicMaterial({
  color: 0xff8c1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
});
const bhRingGeo = new THREE.TorusGeometry(1, 0.035, 8, 64);
const bhRingMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 });
// Portal materials: one colour per pair (cyan, gold, violet) so twins
// always match — a torus ring plus a swirling additive disc.
const PORTAL_COLORS = [0x22d3ee, 0xffd166, 0xa855f7];
const portalRingGeo = new THREE.TorusGeometry(1, 0.07, 8, 48);
const portalDiscGeo = new THREE.CircleGeometry(1, 32);
const portalRingMats = PORTAL_COLORS.map((c) => new THREE.MeshBasicMaterial({
  color: c, transparent: true, opacity: 0.95,
}));
const portalDiscMats = PORTAL_COLORS.map((c) => new THREE.MeshBasicMaterial({
  color: c, transparent: true, opacity: 0.3,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
}));
// Bounce pads: a lime disc with a bright ring, flat on the playfield.
const bouncePadGeo = new THREE.CircleGeometry(1, 48);
const bouncePadMat = new THREE.MeshStandardMaterial({
  color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1,
});
const bouncePadRingGeo = new THREE.RingGeometry(0.92, 1, 48);
const bouncePadRingMat = new THREE.MeshBasicMaterial({
  color: 0xbbf7d0, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
});
// Shield rings: a white ring around a shielded target; it vanishes when
// the shield cracks, so the remaining hit reads at a glance.
const shieldRingGeo = new THREE.TorusGeometry(1, 0.07, 8, 48);
const shieldRingMat = new THREE.MeshBasicMaterial({
  color: 0xe2e8f0, transparent: true, opacity: 0.85,
});

// Playfield disc + boundary ring.
const disc = new THREE.Mesh(
  new THREE.CircleGeometry(PLAYFIELD_RADIUS, 72),
  new THREE.MeshBasicMaterial({ color: 0x0d0826 }),
);
disc.position.z = -0.6;
scene.add(disc);
const boundary = new THREE.Mesh(
  new THREE.RingGeometry(PLAYFIELD_RADIUS - 0.15, PLAYFIELD_RADIUS, 96),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
);
boundary.position.z = -0.5;
scene.add(boundary);

// Seeded starfield background.
{
  const decor = generateDecor(1337, 420, 34);
  const pos = new Float32Array(decor.length * 3);
  decor.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x9db4ff, size: 0.4, sizeAttenuation: true, transparent: true, opacity: 0.9,
  }));
  scene.add(stars);
}

// Level group: planets + targets for the current level.
const levelGroup = new THREE.Group();
scene.add(levelGroup);
let planetMeshes = [];
let planetRings = [];
let targetMeshes = [];
let targetRings = [];
let shieldMeshes = []; // shield ring per target (null unless shielded)
let blackHoleMeshes = []; // { disc, ring } per black hole (disc spins)
let portalMeshes = []; // { group, disc, ring } per portal (disc swirls)
let bouncePadMeshes = []; // { disc, ring } per bounce pad

// Comet + its glow light.
const comet = new THREE.Mesh(cometGeo, cometMat);
const cometLight = new THREE.PointLight(0x22d3ee, 6, 12, 2);
comet.add(cometLight);
comet.visible = false;
scene.add(comet);

// Trajectory preview line (gold, faint — the fading dots carry the read).
const previewPositions = new Float32Array(PREVIEW_MAX * 3);
const previewGeo = new THREE.BufferGeometry();
previewGeo.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
const previewLine = new THREE.Line(previewGeo, new THREE.LineBasicMaterial({
  color: 0xffd166, transparent: true, opacity: 0.3,
}));
previewLine.frustumCulled = false;
previewLine.visible = false;
scene.add(previewLine);

// Fading trajectory dots: gold near the comet, dimming to indigo far along
// the path, so the eye reads direction and distance at a glance.
const dotPositions = new Float32Array(PREVIEW_DOTS * 3);
const dotColors = new Float32Array(PREVIEW_DOTS * 3);
const dotGeo = new THREE.BufferGeometry();
dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
dotGeo.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));
const previewDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
  size: 0.55, vertexColors: true, transparent: true, opacity: 0.95,
  depthWrite: false,
}));
previewDots.frustumCulled = false;
previewDots.visible = false;
scene.add(previewDots);

// Predicted-end marker: a pulsing ring at the previewed shot's end point,
// coloured by predicted outcome — gold = target hit, red = planet crash,
// cyan = flies out of bounds / runs out of steam.
const previewEndRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.9, 0.09, 8, 40),
  new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }),
);
previewEndRing.frustumCulled = false;
previewEndRing.visible = false;
scene.add(previewEndRing);
const PREVIEW_END_COLORS = {
  collect: 0xffd166,
  crash: 0xff3b30,
  swallowed: 0xff3b30,
  lost: 0x22d3ee,
  none: 0x22d3ee,
};

// Comet trail (cyan line, recent positions).
const trailPositions = new Float32Array(TRAIL_MAX * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
  color: 0x22d3ee, transparent: true, opacity: 0.7,
}));
trailLine.frustumCulled = false;
trailLine.visible = false;
scene.add(trailLine);
let trailHistory = [];

// Pooled particles (one THREE.Points, reused slots, additive blending).
const pPos = new Float32Array(PARTICLE_MAX * 3);
const pCol = new Float32Array(PARTICLE_MAX * 3);
const pVel = new Float32Array(PARTICLE_MAX * 3);
const pLife = new Float32Array(PARTICLE_MAX);
const pMaxLife = new Float32Array(PARTICLE_MAX);
const pBaseCol = new Float32Array(PARTICLE_MAX * 3);
for (let i = 0; i < PARTICLE_MAX; i++) { pPos[i * 3 + 2] = -100; pLife[i] = 0; }
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({
  size: 0.4, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
particlePoints.frustumCulled = false;
scene.add(particlePoints);
let particleCursor = 0;

function spawnBurst(x, y, z, hexColor, count, speed, life) {
  const c = new THREE.Color(hexColor);
  for (let n = 0; n < count; n++) {
    const i = particleCursor;
    particleCursor = (particleCursor + 1) % PARTICLE_MAX;
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = Math.cos(a) * sp;
    pVel[i * 3 + 1] = Math.sin(a) * sp;
    pVel[i * 3 + 2] = (Math.random() - 0.5) * sp * 0.5;
    pLife[i] = life * (0.6 + Math.random() * 0.7);
    pMaxLife[i] = pLife[i];
    pBaseCol[i * 3] = c.r; pBaseCol[i * 3 + 1] = c.g; pBaseCol[i * 3 + 2] = c.b;
  }
}

function updateParticles(dt) {
  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) {
      pPos[i * 3 + 2] = -100;
      pCol[i * 3] = 0; pCol[i * 3 + 1] = 0; pCol[i * 3 + 2] = 0;
      continue;
    }
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    const f = pLife[i] / pMaxLife[i];
    pCol[i * 3] = pBaseCol[i * 3] * f;
    pCol[i * 3 + 1] = pBaseCol[i * 3 + 1] * f;
    pCol[i * 3 + 2] = pBaseCol[i * 3 + 2] * f;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

// Pooled shockwave rings: one ring geometry, one material per slot (the
// opacity fades per ring), reused round-robin so a collect never allocates.
const SHOCKWAVE_MAX = 8;
const shockwaveGeo = new THREE.RingGeometry(0.85, 1, 48);
const shockwaves = [];
for (let i = 0; i < SHOCKWAVE_MAX; i++) {
  const mesh = new THREE.Mesh(shockwaveGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  shockwaves.push({ mesh, life: 0, maxLife: 1, maxScale: 5 });
}
let shockwaveCursor = 0;

function spawnShockwave(x, y, hexColor, maxScale, life) {
  const s = shockwaves[shockwaveCursor];
  shockwaveCursor = (shockwaveCursor + 1) % SHOCKWAVE_MAX;
  s.mesh.position.set(x, y, 0.1);
  s.mesh.material.color.setHex(hexColor);
  s.mesh.scale.setScalar(0.3);
  s.mesh.material.opacity = 0.9;
  s.mesh.visible = true;
  s.life = life;
  s.maxLife = life;
  s.maxScale = maxScale;
}

function updateShockwaves(dt) {
  for (const s of shockwaves) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      s.mesh.material.opacity = 0;
      continue;
    }
    // Ease-out expansion: fast at first, settling into the full ring.
    const p = 1 - s.life / s.maxLife;
    const e = 1 - (1 - p) * (1 - p);
    s.mesh.scale.setScalar(0.3 + (s.maxScale - 0.3) * e);
    s.mesh.material.opacity = 0.9 * (1 - p);
  }
}

function countAliveParticles() {
  let n = 0;
  for (let i = 0; i < PARTICLE_MAX; i++) if (pLife[i] > 0) n++;
  return n;
}

// ---------------------------------------------------------------- feedback
// Trauma shake: shake = trauma^2, decays in real time (keeps settling during hit-stop).
// Hit-stop ownership: every hit-stop takes a fresh token; only the newest
// token's deadline freezes time, so an older, longer stop can never end a
// newer freeze early (and vice versa — the newest stop owns the restore).
let trauma = 0;
let hitStopUntil = 0;
let hitStopToken = 0;
let slingshotCount = 0; // near-miss slingshots credited on the current shot
let portalCount = 0; // portal hops on the current shot
let bounceCount = 0; // bounce-pad reflections on the current shot
let shieldHitCount = 0; // shield cracks on the current shot

function addTrauma(amount) {
  trauma = Math.min(1, trauma + amount);
}
function hitStop(seconds) {
  hitStopToken++;
  hitStopUntil = performance.now() + seconds * 1000;
}

// One funnel for every game-feel event, so responses stay proportional.
// Trauma + hit-stop come from the FEEDBACK tier table in physics.js;
// each kind then adds its own sound, particle burst and shockwave ring.
function feedback(kind, x, y) {
  const f = FEEDBACK[kind];
  if (!f) return;
  addTrauma(f.trauma);
  if (f.hitStop > 0) hitStop(f.hitStop);
  if (kind === 'launch') { sfx.launch(); }
  else if (kind === 'collect') {
    sfx.collect();
    spawnBurst(x, y, 0, 0xff2d95, 26, 7, 0.7);
    spawnShockwave(x, y, 0xff2d95, 4.5, 0.7);
  } else if (kind === 'crash') {
    sfx.crash();
    spawnBurst(x, y, 0, 0xff6b35, 40, 9, 0.9);
    spawnShockwave(x, y, 0xff6b35, 6, 0.7);
  } else if (kind === 'lost') {
    sfx.lost();
    spawnBurst(x, y, 0, 0x22d3ee, 16, 5, 0.6);
  } else if (kind === 'swallowed') {
    sfx.swallow();
    spawnBurst(x, y, 0, 0xa855f7, 36, 8, 0.9);
    spawnShockwave(x, y, 0xa855f7, 5, 0.7);
  } else if (kind === 'slingshot') {
    slingshotCount++;
    sfx.slingshot();
    spawnBurst(x, y, 0, 0xffd166, 14, 6, 0.5);
  } else if (kind === 'portal') {
    portalCount++;
    sfx.portal();
    spawnBurst(x, y, 0, 0x22d3ee, 20, 7, 0.6);
    spawnShockwave(x, y, 0x22d3ee, 4, 0.6);
  } else if (kind === 'bounce') {
    bounceCount++;
    sfx.bounce();
    spawnBurst(x, y, 0, 0x4ade80, 16, 6, 0.5);
    spawnShockwave(x, y, 0x4ade80, 3.5, 0.5);
  } else if (kind === 'shieldhit') {
    shieldHitCount++;
    sfx.shieldhit();
    spawnBurst(x, y, 0, 0xe2e8f0, 18, 6, 0.5);
  } else if (kind === 'win') {
    sfx.win();
  }
}

// ---------------------------------------------------------------- DOM helpers
const $ = (id) => document.getElementById(id);
const OVERLAYS = ['menu', 'howto', 'complete', 'failed', 'pause', 'stats'];
// Keyboard-only play: opening an overlay focuses its primary button, so
// Enter / Space immediately does the obvious thing (Play, Got it, Next,
// Retry, Resume, Back) without a mouse.
const OVERLAY_PRIMARY = {
  menu: 'btn-play',
  howto: 'btn-howto-close',
  complete: 'btn-next',
  failed: 'btn-retry',
  pause: 'btn-resume',
  stats: 'btn-stats-close',
};

function showOverlay(id) {
  for (const o of OVERLAYS) $(o).classList.toggle('hidden', o !== id);
  if (!id) for (const o of OVERLAYS) $(o).classList.add('hidden');
  if (id && OVERLAY_PRIMARY[id]) {
    const el = $(OVERLAY_PRIMARY[id]);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}
function showOnly(id) {
  if (id) showOverlay(id);
  else showOverlay(null);
}

function challengeBest(mode) {
  if (mode === 'daily') {
    return (save.daily && save.daily.date === state.dailyDate) ? save.daily.stars : 0;
  }
  if (mode === 'seed') return save.seedBest[state.seedLabel || String(state.challengeSeed)] || 0;
  return 0;
}

function updateHUD() {
  const level = levelById(state.levelId);
  const budget = level ? shotBudget(level) : 0;
  $('hud-level').textContent = level
    ? (state.mode === 'campaign' ? `Level ${level.id} — ${level.name}` : level.name)
    : '';
  const best = state.mode === 'campaign'
    ? (save.stars[state.levelId] || 0)
    : challengeBest(state.mode);
  $('hud-stars').textContent = '★'.repeat(best) + '☆'.repeat(3 - best);
  $('hud-par').textContent = level ? `Par ${level.par}` : '';
  $('hud-shots').textContent = `Shots ${state.shotsUsed}/${budget}`;
  $('hud-targets').textContent = state.targetsRemaining === 0
    ? 'All targets collected'
    : `Targets ${state.targetsRemaining} left`;
}

// Shot power meter (HUD, shown while aiming): fill width = launch power,
// colour ramps cyan -> gold -> red as power rises.
function updatePowerMeter() {
  const meter = $('power-meter');
  const fill = $('power-fill');
  const label = $('power-label');
  if (state.phase !== 'aim') {
    meter.classList.add('hidden');
    return;
  }
  meter.classList.remove('hidden');
  const pct = Math.round(state.aimPower * 100);
  fill.style.width = `${pct}%`;
  fill.style.background = state.aimPower < 0.5
    ? 'linear-gradient(90deg, #22d3ee, #7dd3fc)'
    : state.aimPower < 0.8
      ? 'linear-gradient(90deg, #22d3ee, #ffd166)'
      : 'linear-gradient(90deg, #ffd166, #ff3b30)';
  label.textContent = `Power ${pct}%${state.fineAim ? ' · FINE' : ''}`;
}

function setAimReadout(text) {
  const el = $('aim-readout');
  el.textContent = text;
  el.classList.remove('hidden');
}
function hideAimReadout() {
  $('aim-readout').classList.add('hidden');
}

function renderLevelSelect() {
  const wrap = $('level-select');
  wrap.innerHTML = '';
  // Campaign map: the next uncompleted unlocked level gets a gold "NEXT"
  // ring so the player always sees where the campaign continues.
  const nextLevel = LEVELS.find((l) => l.id <= save.unlocked && (save.stars[l.id] || 0) < 3)
    || null;
  for (const level of LEVELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-btn';
    const locked = level.id > save.unlocked;
    const stars = save.stars[level.id] || 0;
    btn.disabled = locked;
    if (!locked && nextLevel && level.id === nextLevel.id) btn.classList.add('current');
    const name = document.createElement('span');
    name.className = 'lvl-name';
    name.textContent = locked ? `Level ${level.id} — Locked` : `Level ${level.id} — ${level.name}`;
    const starLine = document.createElement('span');
    starLine.className = 'lvl-stars';
    starLine.textContent = locked ? 'Locked' : ('★'.repeat(stars) + '☆'.repeat(3 - stars));
    const parLine = document.createElement('span');
    parLine.className = 'lvl-par';
    if (locked) {
      parLine.textContent = 'Finish the previous level';
    } else {
      const t = starThresholds(level.par);
      parLine.textContent = `Par ${level.par} · ★★★ ≤ ${t.three} · ★★ ${t.two} · ★ ${t.one}`;
    }
    btn.append(name, starLine, parLine);
    if (!locked && nextLevel && level.id === nextLevel.id) {
      const nextTag = document.createElement('span');
      nextTag.className = 'lvl-next';
      nextTag.textContent = 'NEXT';
      btn.append(nextTag);
    }
    btn.addEventListener('click', () => {
      ensureAudio();
      sfx.click();
      startLevel(level.id);
    });
    wrap.appendChild(btn);
  }
  // Campaign progress bar: levels cleared and stars earned out of the
  // campaign totals, so the whole run's progress reads at a glance.
  const cleared = LEVELS.filter((l) => (save.stars[l.id] || 0) > 0).length;
  const earned = totalStars(save);
  const maxStars = LEVELS.length * 3;
  $('campaign-progress-label').textContent = `Campaign — ${cleared}/${LEVELS.length} cleared`;
  $('campaign-progress-stars').textContent = `${earned} / ${maxStars} stars`;
  $('campaign-progress-fill').style.width = `${Math.round((earned / maxStars) * 100)}%`;
  $('total-stars').textContent = String(earned);
  updateChallengeMenu();
}

// Best-stars table: one row per campaign level (stars earned + par),
// a totals line, and the challenge bests — today's daily, the endless
// run record, and how many shared seeds have a recorded best.
function renderStats() {
  const body = $('stats-body');
  body.innerHTML = '';
  for (const level of LEVELS) {
    const row = document.createElement('tr');
    const stars = save.stars[level.id] || 0;
    const nameCell = document.createElement('td');
    nameCell.textContent = `Level ${level.id} — ${level.name}`;
    const starCell = document.createElement('td');
    starCell.className = 'stats-stars';
    starCell.textContent = level.id > save.unlocked ? 'Locked'
      : ('★'.repeat(stars) + '☆'.repeat(3 - stars));
    const parCell = document.createElement('td');
    parCell.textContent = `Par ${level.par}`;
    row.append(nameCell, starCell, parCell);
    body.appendChild(row);
  }
  const earned = totalStars(save);
  const cleared = LEVELS.filter((l) => (save.stars[l.id] || 0) > 0).length;
  $('stats-totals').textContent =
    `Campaign: ${earned} / ${LEVELS.length * 3} stars · ${cleared} / ${LEVELS.length} levels cleared`;
  const today = dateKey(new Date());
  const dailyBest = (save.daily && save.daily.date === today) ? save.daily.stars : 0;
  const seedCount = save.seedBest ? Object.keys(save.seedBest).length : 0;
  $('stats-challenge').textContent =
    `Daily best today: ${'★'.repeat(dailyBest)}${'☆'.repeat(3 - dailyBest)}` +
    ` · Endless best: ${save.endlessBest || 0} round${(save.endlessBest || 0) === 1 ? '' : 's'}` +
    ` · ${seedCount} seed${seedCount === 1 ? '' : 's'} played`;
}

// The Daily button shows today's date plus the best stars earned on it so
// far today; the seed input keeps whatever ?seed= (or the last typed seed)
// put there.
function updateChallengeMenu() {
  const dailyBtn = $('btn-daily');
  if (dailyBtn) {
    const today = dateKey(new Date());
    const best = (save.daily && save.daily.date === today) ? save.daily.stars : 0;
    dailyBtn.textContent = best > 0
      ? `Daily Orbit — ${today} · ${'★'.repeat(best)}${'☆'.repeat(3 - best)}`
      : `Daily Orbit — ${today}`;
  }
}

// ---------------------------------------------------------------- level flow
function buildLevelMeshes(level) {
  while (levelGroup.children.length) levelGroup.remove(levelGroup.children[0]);
  planetMeshes = [];
  planetRings = [];
  targetMeshes = [];
  targetRings = [];
  shieldMeshes = [];
  blackHoleMeshes = [];
  portalMeshes = [];
  bouncePadMeshes = [];
  for (const p of level.planets) {
    const mat = new THREE.MeshStandardMaterial({
      color: p.color, emissive: p.color, emissiveIntensity: 0.55,
      roughness: 0.35, metalness: 0.15,
    });
    const m = new THREE.Mesh(planetGeo, mat);
    m.position.set(p.x, p.y, 0);
    m.scale.setScalar(p.r);
    levelGroup.add(m);
    planetMeshes.push(m);
    const ring = new THREE.Mesh(planetRingGeo, planetRingMat);
    ring.position.set(p.x, p.y, 0);
    ring.scale.setScalar(p.r * 1.45);
    ring.rotation.x = Math.PI / 2.6;
    ring.rotation.y = 0.3;
    levelGroup.add(ring);
    planetRings.push(ring);
    // Moving planets show their orbit path so the player can time a launch.
    if (p.orbit) {
      const o = p.orbit;
      const pts = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(o.cx + o.radius * Math.cos(a), o.cy + o.radius * Math.sin(a), -0.4));
      }
      const pathGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({
        color: 0x8b5cf6, transparent: true, opacity: 0.28,
      }));
      levelGroup.add(path);
    }
  }
  // Black holes: black core, spinning orange accretion disc (tilted),
  // thin gold photon ring, and a warm point light.
  for (const bh of levelBlackHoles(level)) {
    const group = new THREE.Group();
    group.position.set(bh.x, bh.y, 0);
    const core = new THREE.Mesh(bhGeo, bhMat);
    core.scale.setScalar(bh.r);
    group.add(core);
    const tilt = new THREE.Group();
    tilt.rotation.x = Math.PI / 2.6;
    tilt.rotation.y = 0.35;
    const disc = new THREE.Mesh(bhDiscGeo, bhDiscMat);
    disc.scale.setScalar(bh.r * 1.9);
    tilt.add(disc);
    group.add(tilt);
    const ring = new THREE.Mesh(bhRingGeo, bhRingMat);
    ring.scale.setScalar(bh.r * 1.15);
    group.add(ring);
    const light = new THREE.PointLight(0xff8c1a, 8, 14, 2);
    group.add(light);
    levelGroup.add(group);
    blackHoleMeshes.push({ disc, ring });
  }
  // Portals: a ring + a swirling disc, coloured by pair so twins match.
  for (const portal of levelPortals(level)) {
    const pair = (portal.pair ?? 0) % PORTAL_COLORS.length;
    const group = new THREE.Group();
    group.position.set(portal.x, portal.y, 0);
    const ring = new THREE.Mesh(portalRingGeo, portalRingMats[pair]);
    ring.scale.setScalar(portal.r);
    group.add(ring);
    const disc = new THREE.Mesh(portalDiscGeo, portalDiscMats[pair]);
    disc.scale.setScalar(portal.r * 0.85);
    disc.position.z = -0.2;
    group.add(disc);
    levelGroup.add(group);
    portalMeshes.push({ group, disc, ring, base: portal.r });
  }
  // Bounce pads: a lime disc on the playfield with a bright rim.
  for (const pad of levelBouncePads(level)) {
    const disc = new THREE.Mesh(bouncePadGeo, bouncePadMat);
    disc.position.set(pad.x, pad.y, -0.3);
    disc.scale.setScalar(pad.r);
    levelGroup.add(disc);
    const ring = new THREE.Mesh(bouncePadRingGeo, bouncePadRingMat);
    ring.position.set(pad.x, pad.y, -0.25);
    ring.scale.setScalar(pad.r);
    levelGroup.add(ring);
    bouncePadMeshes.push({ disc, ring });
  }
  level.targets.forEach((t, i) => {
    const m = new THREE.Mesh(targetGeo, targetMat);
    m.position.set(t.x, t.y, 0);
    m.scale.setScalar(t.r);
    m.userData.targetIndex = i;
    levelGroup.add(m);
    targetMeshes.push(m);
    const ring = new THREE.Mesh(targetRingGeo, targetRingMat);
    ring.position.set(t.x, t.y, 0);
    levelGroup.add(ring);
    targetRings.push(ring);
    // Shielded targets get a white shield ring that vanishes on the
    // cracking hit, so one hit left reads at a glance.
    if (targetHits(t) > 1) {
      const shield = new THREE.Mesh(shieldRingGeo, shieldRingMat);
      shield.position.set(t.x, t.y, 0);
      shield.scale.setScalar(t.r * 1.5);
      levelGroup.add(shield);
      shieldMeshes.push(shield);
    } else {
      shieldMeshes.push(null);
    }
  });
}

function defaultAimAngle(level, collected) {
  const next = level.targets.findIndex((_, i) => !collected.includes(i));
  const t = level.targets[next === -1 ? 0 : next];
  return Math.atan2(t.y - level.pad.y, t.x - level.pad.x);
}

function resetCometToPad() {
  const level = levelById(state.levelId);
  comet.position.set(level.pad.x, level.pad.y, 0);
  comet.visible = true;
  trailHistory = [];
  updateTrailLine();
}

function setAim(angle, power) {
  state.aimAngle = angle;
  state.aimPower = Math.max(0.05, Math.min(1, power));
  updatePreview();
  updatePowerMeter();
  const deg = Math.round((state.aimAngle * 180) / Math.PI);
  const pct = Math.round(state.aimPower * 100);
  const prediction = {
    collect: ' · Predicted: target hit',
    crash: ' · Predicted: crash!',
    swallowed: ' · Predicted: swallowed!',
    lost: ' · Predicted: flies out',
    none: ' · Predicted: runs out of steam',
  }[state.previewOutcome] || '';
  const fine = state.fineAim ? ' · FINE AIM' : '';
  setAimReadout(`Angle ${deg}° · Power ${pct}%${fine}${prediction} — release to launch`);
}

const dotGold = new THREE.Color(0xffd166);
const dotDim = new THREE.Color(0x3b2d6e);
const dotColor = new THREE.Color();

function updatePreview() {
  const level = levelById(state.levelId);
  if (state.phase !== 'aim' || !level) {
    previewLine.visible = false;
    previewDots.visible = false;
    previewEndRing.visible = false;
    state.previewOutcome = 'none';
    state.previewEnd = null;
    return;
  }
  // Preview follows the level clock: moving planets shift the shot.
  // Shield state matters too: a cracked shield previews as one hit away.
  const sim = previewShot(level, state.aimAngle, state.aimPower, state.collected, levelTime, state.shieldHits);
  const outcome = sim.outcome === 'collected' || sim.outcome === 'partial' ? 'collect'
    : sim.outcome === 'crash' ? 'crash'
    : sim.outcome === 'swallowed' ? 'swallowed'
    : 'lost';
  state.previewOutcome = outcome;
  state.previewEnd = sim.end;

  // Faint gold line for continuity.
  const pts = sim.points.slice(0, PREVIEW_MAX);
  for (let i = 0; i < pts.length; i++) {
    previewPositions[i * 3] = pts[i][0];
    previewPositions[i * 3 + 1] = pts[i][1];
    previewPositions[i * 3 + 2] = 0;
  }
  previewGeo.setDrawRange(0, pts.length);
  previewGeo.attributes.position.needsUpdate = true;
  previewLine.visible = pts.length > 1;

  // Fading dots sampled along the path: bright gold near the comet,
  // dimming toward indigo at the far end.
  const step = Math.max(1, Math.floor(pts.length / PREVIEW_DOTS));
  let n = 0;
  for (let i = 0; i < pts.length && n < PREVIEW_DOTS; i += step, n++) {
    dotPositions[n * 3] = pts[i][0];
    dotPositions[n * 3 + 1] = pts[i][1];
    dotPositions[n * 3 + 2] = 0;
    const f = pts.length > 1 ? i / (pts.length - 1) : 0;
    dotColor.lerpColors(dotGold, dotDim, f);
    dotColors[n * 3] = dotColor.r;
    dotColors[n * 3 + 1] = dotColor.g;
    dotColors[n * 3 + 2] = dotColor.b;
  }
  dotGeo.setDrawRange(0, n);
  dotGeo.attributes.position.needsUpdate = true;
  dotGeo.attributes.color.needsUpdate = true;
  previewDots.visible = n > 1;

  // Predicted-end marker, coloured by outcome, pulsing at the end point.
  previewEndRing.position.set(sim.end.x, sim.end.y, 0);
  previewEndRing.material.color.setHex(PREVIEW_END_COLORS[outcome]);
  previewEndRing.visible = true;
}

function updateTrailLine() {
  for (let i = 0; i < trailHistory.length; i++) {
    trailPositions[i * 3] = trailHistory[i][0];
    trailPositions[i * 3 + 1] = trailHistory[i][1];
    trailPositions[i * 3 + 2] = 0;
  }
  trailGeo.setDrawRange(0, trailHistory.length);
  trailGeo.attributes.position.needsUpdate = true;
  trailLine.visible = trailHistory.length > 1;
}

let flight = null;
let flightAcc = 0;
let flightEnding = false;
let shotTimer = 0;
let levelTime = 0; // seconds since the level started; moving planets follow it
let previewRefresh = 0; // throttle for re-previewing while planets move
const tmpNewly = [];

function beginLevel(level, mode) {
  if (!level) return;
  window.clearTimeout(shotTimer);
  state.mode = mode;
  state.levelId = level.id;
  state.levelName = level.name;
  state.shotsUsed = 0;
  state.collected = [];
  state.shieldHits = {};
  state.stars = mode === 'campaign' ? (save.stars[level.id] || 0) : challengeBest(mode);
  state.targetsRemaining = level.targets.length;
  flight = null;
  flightEnding = false;
  levelTime = 0;
  previewRefresh = 0;
  buildLevelMeshes(level);
  resetCometToPad();
  state.phase = 'aim';
  state.shotsLeft = shotBudget(level);
  setAim(defaultAimAngle(level, []), 0.6);
  updateHUD();
  $('hud').classList.remove('hidden');
  showOnly(null);
  // A hidden button keeps its focus in some browsers; drop it so the
  // keyboard shortcuts (Space to launch, arrows to aim) own the keys.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  ensureAudio();
  startMusic();
}

function startLevel(id) {
  const level = levelById(id);
  if (!level || id > save.unlocked) return;
  beginLevel(level, 'campaign');
}

// ---------------------------------------------------------------- challenge modes
// Daily: one seed per calendar day (YYYYMMDD), so everyone plays the same
// level; difficulty rotates 2..4 by day of year.
function startDaily() {
  const now = new Date();
  state.dailyDate = dateKey(now);
  const level = generateLevel(dateSeed(now), dailyDifficulty(now), DAILY_ID);
  level.name = `Daily — ${state.dailyDate}`;
  registerGeneratedLevel(level);
  beginLevel(level, 'daily');
}

// Seeded: ?seed= in the URL (or the menu input) replays the same generated
// level — a number ("777") or any word ("orbit42"); difficulty 2..4 comes
// from the seed itself, so a shared link always plays the same puzzle.
function startSeed(raw) {
  const seed = parseSeedParam(raw);
  if (seed === null) return false;
  const label = String(raw).trim().slice(0, 32);
  state.challengeSeed = seed;
  state.seedLabel = label;
  const level = generateLevel(seed, 2 + (seed % 3), SEED_ID);
  level.name = `Seed ${label.slice(0, 16)}`;
  registerGeneratedLevel(level);
  beginLevel(level, 'seed');
  return true;
}

// Endless: a fresh run seed per attempt, one difficulty step per round.
// Round n plays seed (base + n * 7919) at difficulty n.
function startEndless() {
  state.endlessBaseSeed = 100000 + Math.floor(Math.random() * 900000);
  startEndlessRound(1);
}

function startEndlessRound(round) {
  state.endlessRound = round;
  const seed = (state.endlessBaseSeed + round * 7919) >>> 0;
  const level = generateLevel(seed, endlessDifficulty(round), ENDLESS_ID);
  level.name = `Endless Round ${round}`;
  registerGeneratedLevel(level);
  beginLevel(level, 'endless');
}

// Retry / restart / replay: replays the exact same challenge level (same
// seed and round), so a retry is never a different puzzle.
function restartCurrent() {
  if (state.mode === 'daily') startDaily();
  else if (state.mode === 'seed') startSeed(state.seedLabel || String(state.challengeSeed));
  else if (state.mode === 'endless') startEndlessRound(state.endlessRound);
  else startLevel(state.levelId);
}

function launch() {
  if (state.phase !== 'aim' || flightEnding) return;
  const level = levelById(state.levelId);
  // The flight carries the attempt's shield state: a target cracked by
  // an earlier shot is one hit from collecting on this one.
  flight = launchState(level, state.aimAngle, state.aimPower, levelTime, state.shieldHits);
  flightAcc = 0;
  flightEnding = false;
  slingshotCount = 0;
  portalCount = 0;
  bounceCount = 0;
  shieldHitCount = 0;
  state.phase = 'fly';
  previewLine.visible = false;
  previewDots.visible = false;
  previewEndRing.visible = false;
  trailLine.visible = false;
  updatePowerMeter();
  hideAimReadout();
  feedback('launch', level.pad.x, level.pad.y);
  spawnBurst(level.pad.x, level.pad.y, 0, 0x22d3ee, 14, 5, 0.5);
}

function scheduleEndShot(ms) {
  window.clearTimeout(shotTimer);
  shotTimer = window.setTimeout(() => endShot(), ms);
}

function endShot() {
  if (state.phase !== 'fly') return;
  const level = levelById(state.levelId);
  state.shotsUsed++;
  state.shotsLeft = Math.max(0, shotBudget(level) - state.shotsUsed);
  flight = null;
  flightEnding = false;
  if (isLevelComplete(level, state.collected)) {
    completeLevel();
    return;
  }
  if (state.shotsUsed >= shotBudget(level)) {
    failLevel();
    return;
  }
  state.phase = 'aim';
  resetCometToPad();
  setAim(defaultAimAngle(level, state.collected), 0.6);
  updateHUD();
  // Down to the last shot: a two-tone warning so the player knows it.
  if (state.shotsLeft === 1) sfx.lastShot();
}

function completeLevel() {
  const level = levelById(state.levelId);
  const stars = starsForShots(state.shotsUsed, level.par);
  state.stars = stars;
  // Campaign completions unlock the next level; challenge completions
  // record a best (daily / per-seed) instead and never touch the unlocks.
  let unlockedNew = false;
  if (state.mode === 'campaign') {
    if (!save.stars[state.levelId] || save.stars[state.levelId] < stars) {
      save.stars[state.levelId] = stars;
    }
    if (state.levelId < LEVELS.length && save.unlocked <= state.levelId) {
      save.unlocked = state.levelId + 1;
      unlockedNew = true;
    }
    state.unlocked = save.unlocked;
  } else if (state.mode === 'daily') {
    if (!save.daily || save.daily.date !== state.dailyDate || save.daily.stars < stars) {
      save.daily = { date: state.dailyDate, stars };
    }
  } else if (state.mode === 'seed') {
    const key = state.seedLabel || String(state.challengeSeed);
    if (!save.seedBest[key] || save.seedBest[key] < stars) save.seedBest[key] = stars;
  } else if (state.mode === 'endless') {
    // Clearing round n means n rounds cleared in this run — the record.
    if (!save.endlessBest || save.endlessBest < state.endlessRound) {
      save.endlessBest = state.endlessRound;
    }
  }
  persistSave();
  state.phase = 'complete';
  state.targetsRemaining = 0;
  feedback('win', 0, 0);
  // A fresh unlock rings a rising chime just after the win arpeggio.
  if (unlockedNew) window.setTimeout(() => sfx.unlock(), 450);
  for (const t of level.targets) {
    spawnBurst(t.x, t.y, 0, 0xffd166, 30, 8, 1.0);
    spawnShockwave(t.x, t.y, 0xffd166, 7, 0.9);
  }
  $('complete-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  let shotsLine = `Finished in ${state.shotsUsed} shot${state.shotsUsed === 1 ? '' : 's'} (par ${level.par})`;
  if (state.mode === 'daily' && save.daily) {
    shotsLine += ` · Daily best: ${'★'.repeat(save.daily.stars)}${'☆'.repeat(3 - save.daily.stars)}`;
  } else if (state.mode === 'seed') {
    const b = save.seedBest[state.seedLabel || String(state.challengeSeed)] || 0;
    shotsLine += ` · Seed best: ${'★'.repeat(b)}${'☆'.repeat(3 - b)}`;
  } else if (state.mode === 'endless') {
    shotsLine += ` · Round ${state.endlessRound} cleared`;
  }
  $('complete-shots').textContent = shotsLine;
  // Endless: the Next button advances to the next round. Daily / seed:
  // no next level — replay the same seed or go back to the menu.
  const nextBtn = $('btn-next');
  if (state.mode === 'endless') {
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = 'Next Round →';
  } else {
    nextBtn.textContent = 'Next Level';
    nextBtn.classList.toggle('hidden',
      state.mode !== 'campaign' || state.levelId >= LEVELS.length);
  }
  updateHUD();
  renderLevelSelect();
  showOnly('complete');
}

function failLevel() {
  const level = levelById(state.levelId);
  state.phase = 'failed';
  sfx.fail();
  let text = `${level.name}: out of shots with ${state.targetsRemaining} target${state.targetsRemaining === 1 ? '' : 's'} left. Try a different arc.`;
  if (state.mode === 'endless') {
    const cleared = state.endlessRound - 1;
    text = `Run over — you cleared ${cleared} round${cleared === 1 ? '' : 's'} of Endless Orbit. Retry the round or start a new run.`;
    if (!save.endlessBest || save.endlessBest < cleared) save.endlessBest = cleared;
    persistSave();
  }
  $('failed-text').textContent = text;
  // Failed-screen stats: what this attempt cost, and the best already
  // banked on this level (campaign) or in this mode (challenge).
  const budget = shotBudget(level);
  let statsLine = `Shots used: ${state.shotsUsed} / ${budget} · Par ${level.par}`;
  if (state.mode === 'campaign') {
    const best = save.stars[state.levelId] || 0;
    statsLine += ` · Best on this level: ${'★'.repeat(best)}${'☆'.repeat(3 - best)}`;
  } else if (state.mode === 'endless') {
    statsLine += ` · Endless best: ${save.endlessBest || 0} round${(save.endlessBest || 0) === 1 ? '' : 's'}`;
  } else {
    const best = challengeBest(state.mode);
    statsLine += ` · Best here: ${'★'.repeat(best)}${'☆'.repeat(3 - best)}`;
  }
  $('failed-stats').textContent = statsLine;
  updateHUD();
  showOnly('failed');
}

function quitToMenu() {
  window.clearTimeout(shotTimer);
  flight = null;
  flightEnding = false;
  state.phase = 'menu';
  comet.visible = false;
  previewLine.visible = false;
  previewDots.visible = false;
  previewEndRing.visible = false;
  trailLine.visible = false;
  updatePowerMeter();
  hideAimReadout();
  $('hud').classList.add('hidden');
  renderLevelSelect();
  showOnly('menu');
}

function pauseGame() {
  if (state.phase !== 'aim' && state.phase !== 'fly') return;
  state.phaseBeforePause = state.phase;
  state.phase = 'paused';
  showOnly('pause');
}

function resumeGame() {
  if (state.phase !== 'paused') return;
  state.phase = state.phaseBeforePause;
  showOnly(null);
  if (state.phase === 'aim') setAim(state.aimAngle, state.aimPower);
}

// ---------------------------------------------------------------- flight stepping
function stepFlightLoop(dt) {
  if (!flight) return;
  flightAcc += dt;
  let guard = 0;
  while (flightAcc >= SUBSTEP && flight && !flightEnding && guard < 12) {
    flightAcc -= SUBSTEP;
    guard++;
    levelTime += SUBSTEP; // level clock stays in lockstep with flight time
    tmpNewly.length = 0;
    const level = levelById(state.levelId);
    const ev = stepFlight(flight, level, SUBSTEP, state.collected, tmpNewly);
    comet.position.set(flight.x, flight.y, 0);
    // Near-miss slingshot: skim within the band of a planet's surface
    // (close enough to feel the bend, far enough to live) — once per
    // planet per shot, with a gold burst and a rising sweep.
    level.planets.forEach((p, i) => {
      if (flight.slingshotPlanets.includes(i)) return;
      const pos = planetPosAt(p, levelTime);
      const d = Math.hypot(flight.x - pos.x, flight.y - pos.y);
      if (isNearMiss(d, p.r)) {
        flight.slingshotPlanets.push(i);
        feedback('slingshot', flight.x, flight.y);
      }
    });
    if (ev && ev.type === 'portal') {
      // The comet jumped to the twin portal: clear the trail so no streak
      // crosses the playfield, and flash the exit point.
      feedback('portal', flight.x, flight.y);
      trailHistory = [];
      updateTrailLine();
    } else if (ev && ev.type === 'bounce') {
      feedback('bounce', flight.x, flight.y);
    } else if (ev && ev.type === 'shieldhit') {
      // The crack persists in the attempt's shield state, and the shield
      // ring on that target vanishes so one hit left reads at a glance.
      for (const idx of ev.targets) {
        state.shieldHits[idx] = flight.shieldHits[idx];
        const mesh = shieldMeshes[idx];
        if (mesh) mesh.visible = false;
        const t = level.targets[idx];
        feedback('shieldhit', t.x, t.y);
      }
    } else if (ev && ev.type === 'collect') {
      for (const idx of tmpNewly) {
        const mesh = targetMeshes[idx];
        if (mesh) mesh.visible = false;
        const ring = targetRings[idx];
        if (ring) ring.visible = false;
        const t = level.targets[idx];
        feedback('collect', t.x, t.y);
      }
      // A shield crack in the same substep as a collect is applied
      // silently by the physics; sync the attempt state and rings so a
      // cracked shield never shows as intact.
      for (const [k, v] of Object.entries(flight.shieldHits)) {
        const idx = Number(k);
        if (state.shieldHits[idx] !== v) {
          state.shieldHits[idx] = v;
          const mesh = shieldMeshes[idx];
          if (mesh) mesh.visible = false;
        }
      }
      state.targetsRemaining = level.targets.length - state.collected.length;
      updateHUD();
      if (isLevelComplete(level, state.collected)) {
        flightEnding = true;
        scheduleEndShot(700);
        break;
      }
    } else if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout' || ev.type === 'swallowed')) {
      flightEnding = true;
      if (ev.type === 'crash') {
        feedback('crash', flight.x, flight.y);
        comet.visible = false;
      } else if (ev.type === 'swallowed') {
        feedback('swallowed', flight.x, flight.y);
        comet.visible = false;
      } else {
        feedback('lost', flight.x, flight.y);
        comet.visible = false;
      }
      trailHistory = [];
      updateTrailLine();
      scheduleEndShot(500);
      break;
    }
  }
  if (flightAcc > SUBSTEP * 12) flightAcc = 0;
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
let dragging = false;
let dragPointerId = null;
let lastDragDist = 0; // world units pulled; a plain click must not launch
let dragStartDist = 0; // pull distance when the drag began (fine-aim anchor)
// Tap-to-launch: the press point/time of the current drag. A press that
// lifts within TAP_MAX_MS having moved under TAP_MAX_PX is a tap — it
// launches with the current aim instead of re-aiming.
let downX = 0;
let downY = 0;
let downTime = 0;
// Pinch zoom: every live pointer on the canvas, by pointerId. Two live
// pointers mean a pinch — the aim drag is cancelled and the finger
// distance drives the camera zoom until one finger lifts.
const activePointers = new Map();
let pinching = false;
let pinchStartDist = 0;
let pinchStartZoom = 1;

function worldFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, hit);
  return hit;
}

function aimFromPointer(e) {
  const level = levelById(state.levelId);
  const p = worldFromEvent(e);
  if (!p) return;
  const dx = p.x - level.pad.x;
  const dy = p.y - level.pad.y;
  const dist = Math.hypot(dx, dy);
  lastDragDist = dist;
  if (dist < 0.4) return;
  // Fine aim: hold Shift and the pull distance moves 4x slower around the
  // point where the drag started, for small power tweaks.
  state.fineAim = !!e.shiftKey;
  const effDist = state.fineAim
    ? dragStartDist + (dist - dragStartDist) * FINE_AIM_SCALE
    : dist;
  const angle = Math.atan2(-dy, -dx);
  const power = Math.max(0.05, Math.min(1, effDist / MAX_DRAG));
  setAim(angle, power);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state.phase !== 'aim') return;
  ensureAudio();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    // Second finger down: pinch-zoom takes over, the aim drag is off.
    dragging = false;
    pinching = true;
    const [a, b] = [...activePointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartZoom = cameraZoom;
    return;
  }
  if (activePointers.size > 2) return; // ignore extra fingers
  dragging = true;
  dragPointerId = e.pointerId;
  downX = e.clientX;
  downY = e.clientY;
  downTime = performance.now();
  // Synthetic pointer events (tests) have no active pointer to capture;
  // a failed capture must never break the drag.
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  const level = levelById(state.levelId);
  const p = worldFromEvent(e);
  dragStartDist = p ? Math.hypot(p.x - level.pad.x, p.y - level.pad.y) : 0;
  // Aim updates on the first move, not on press — so a tap never re-aims
  // before it launches with the current aim.
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinching && activePointers.size >= 2) {
    const [a, b] = [...activePointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStartDist > 0 && d > 0) setZoom(pinchStartZoom * (d / pinchStartDist));
    return;
  }
  if (!dragging || e.pointerId !== dragPointerId || state.phase !== 'aim') return;
  aimFromPointer(e);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const wasPinching = pinching;
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinching = false;
  // A pinch ending never launches — lifting a finger is not a shot.
  if (wasPinching) { dragging = false; return; }
  if (!dragging || e.pointerId !== dragPointerId) return;
  dragging = false;
  state.fineAim = false;
  if (state.phase !== 'aim') return;
  // Quick tap, barely moved: launch with the current aim.
  const duration = performance.now() - downTime;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (isTapGesture(duration, moved)) {
    launch();
    return;
  }
  aimFromPointer(e);
  if (lastDragDist >= 1.5 && state.aimPower >= 0.08) launch();
});
renderer.domElement.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinching = false;
  if (e.pointerId === dragPointerId) dragging = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// Mouse wheel zooms the camera in and out (zoom buttons and pinch do the
// same on touch). preventDefault stops the page scrolling under the game.
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  setZoom(cameraZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  // Typing a seed in the menu input must not trigger game hotkeys.
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  // Escape closes the how-to and stats overlays back to the menu.
  if (e.key === 'Escape' && (state.phase === 'howto' || state.phase === 'stats')) {
    if (state.phase === 'howto') $('btn-howto-close').click();
    else $('btn-stats-close').click();
    return;
  }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (state.phase === 'paused') resumeGame();
    else pauseGame();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (state.phase === 'aim' || state.phase === 'fly' || state.phase === 'complete' || state.phase === 'failed') {
      ensureAudio();
      restartCurrent();
    }
    return;
  }
  // + / - zoom the camera in and out (same as the wheel, pinch and HUD
  // zoom buttons).
  if (e.key === '+' || e.key === '=') { setZoom(cameraZoom * 1.25); return; }
  if (e.key === '-' || e.key === '_') { setZoom(cameraZoom / 1.25); return; }
  // Enter does the obvious thing for the current screen — Play on the
  // menu, launch while aiming, Next on completion, Retry on failure,
  // Resume when paused. A focused button already handles Enter natively,
  // so this only fires when nothing interactive has focus.
  if (e.key === 'Enter') {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A')) return;
    if (state.phase === 'menu') $('btn-play').click();
    else if (state.phase === 'howto') $('btn-howto-close').click();
    else if (state.phase === 'stats') $('btn-stats-close').click();
    else if (state.phase === 'complete') $('btn-next').click();
    else if (state.phase === 'failed') $('btn-retry').click();
    else if (state.phase === 'paused') $('btn-resume').click();
    else if (state.phase === 'aim') launch();
    e.preventDefault();
    return;
  }
  // Arrow keys on the menu move focus between the enabled level buttons
  // (wrapping around the grid) so the whole campaign map is navigable
  // without a mouse.
  if (state.phase === 'menu'
    && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const btns = [...document.querySelectorAll('.level-btn')].filter((b) => !b.disabled);
    if (btns.length) {
      const idx = btns.indexOf(document.activeElement);
      const delta = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      btns[focusStep(idx, btns.length, delta)].focus();
      e.preventDefault();
    }
    return;
  }
  if (state.phase !== 'aim') return;
  // Shift = fine aim: quarter-size angle/power steps for keyboard aim too.
  state.fineAim = !!e.shiftKey;
  const fine = e.shiftKey ? 0.25 : 1;
  if (e.key === 'ArrowLeft') { setAim(state.aimAngle + 0.06 * fine, state.aimPower); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { setAim(state.aimAngle - 0.06 * fine, state.aimPower); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { setAim(state.aimAngle, state.aimPower + 0.05 * fine); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { setAim(state.aimAngle, state.aimPower - 0.05 * fine); e.preventDefault(); }
  else if (e.key === ' ') { launch(); e.preventDefault(); }
});

// ---------------------------------------------------------------- buttons
function wireButtons() {
  $('btn-play').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    if (!save.seenHowTo) {
      save.seenHowTo = true;
      persistSave();
      state.phase = 'howto';
      showOnly('howto');
      return;
    }
    const next = LEVELS.find((l) => l.id <= save.unlocked && (save.stars[l.id] || 0) < 3)
      || LEVELS.find((l) => l.id === save.unlocked) || LEVELS[0];
    startLevel(next.id);
  });
  $('btn-howto').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    state.phase = 'howto';
    showOnly('howto');
  });
  $('btn-stats').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    renderStats();
    state.phase = 'stats';
    showOnly('stats');
  });
  $('btn-stats-close').addEventListener('click', () => {
    sfx.click();
    state.phase = 'menu';
    showOnly('menu');
  });
  $('btn-howto-close').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    save.seenHowTo = true;
    persistSave();
    // A ?seed= link keeps working after the first-visit how-to: close it
    // straight into the linked level instead of the menu.
    if (pendingSeed !== null) {
      startSeed(urlSeedRaw);
      return;
    }
    state.phase = 'menu';
    showOnly('menu');
  });
  $('btn-next').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    if (state.mode === 'endless') startEndlessRound(state.endlessRound + 1);
    else if (state.levelId < LEVELS.length) startLevel(state.levelId + 1);
    else quitToMenu();
  });
  $('btn-replay').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    restartCurrent();
  });
  $('btn-menu-complete').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-retry').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    restartCurrent();
  });
  // Level Select jumps back to the menu and scrolls the campaign map into
  // view, so a failed run can pick a different level in one tap.
  $('btn-level-select').addEventListener('click', () => {
    sfx.click();
    quitToMenu();
    const sel = $('level-select');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('btn-menu-failed').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-resume').addEventListener('click', () => { sfx.click(); resumeGame(); });
  $('btn-restart').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    restartCurrent();
  });
  $('btn-quit').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-pause').addEventListener('click', () => { sfx.click(); pauseGame(); });
  // Challenge modes: daily (one level per day), endless (escalating
  // rounds), and a seed box — type a seed or open a ?seed= link to replay
  // the exact same generated level as a friend.
  $('btn-daily').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startDaily();
  });
  $('btn-endless').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startEndless();
  });
  $('btn-seed').addEventListener('click', () => {
    ensureAudio();
    if (startSeed($('seed-input').value)) {
      sfx.click();
    } else {
      $('seed-input').focus();
      $('seed-input').placeholder = 'Type a seed first';
    }
  });
  $('seed-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-seed').click();
  });
  $('btn-mute-menu').addEventListener('click', () => { ensureAudio(); toggleMute(); });
  $('btn-mute-hud').addEventListener('click', () => { ensureAudio(); toggleMute(); });
  $('btn-mute-pause').addEventListener('click', () => { ensureAudio(); toggleMute(); });
  // Camera zoom (HUD − / + buttons; wheel, pinch and the + / - keys do
  // the same thing). Each tap steps 25% in or out.
  $('btn-zoom-in').addEventListener('click', () => { ensureAudio(); sfx.click(); setZoom(cameraZoom * 1.25); });
  $('btn-zoom-out').addEventListener('click', () => { ensureAudio(); sfx.click(); setZoom(cameraZoom / 1.25); });
  updateZoomLabel();
  // Volume sliders (menu + pause) share one persisted setting; moving
  // either updates the master gain live and syncs the other slider.
  for (const suffix of ['menu', 'pause']) {
    const range = $(`volume-range-${suffix}`);
    range.addEventListener('input', () => {
      ensureAudio();
      setVolume(Number(range.value) / 100);
    });
  }
  updateVolumeLabels();
  const shakeRange = $('shake-range');
  shakeRange.value = String(Math.round(settings.shake * 100));
  $('shake-value').textContent = `${Math.round(settings.shake * 100)}%`;
  shakeRange.addEventListener('input', () => {
    settings.shake = Number(shakeRange.value) / 100;
    $('shake-value').textContent = `${shakeRange.value}%`;
    persistSettings();
  });
}

// ---------------------------------------------------------------- resize + context loss
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const need = PLAYFIELD_RADIUS + 2;
  // Zoom in (factor > 1) pulls the camera closer than the fitted distance.
  const z = Math.max(need / halfFovTan, need / (halfFovTan * aspect)) / cameraZoom;
  camera.position.set(0, 0, z);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fitCamera);

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (state.phase === 'aim' || state.phase === 'fly') pauseGame();
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  // Three.js restores GL resources; the player resumes from the pause menu.
});

// Moving planets follow the level clock; their meshes (and rings) are
// repositioned every frame so what the player sees matches the physics.
function updatePlanetMeshes() {
  const level = levelById(state.levelId);
  if (!level) return;
  level.planets.forEach((p, i) => {
    if (!p.orbit) return;
    const pos = planetPosAt(p, levelTime);
    const m = planetMeshes[i];
    if (m) m.position.set(pos.x, pos.y, 0);
    const r = planetRings[i];
    if (r) r.position.set(pos.x, pos.y, 0);
  });
}

// ---------------------------------------------------------------- main loop
let lastNow = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;
  const stopped = now < hitStopUntil;
  // Trauma decays with real time, so shake settles even during hit-stop.
  trauma = Math.max(0, trauma - dt * 1.4);
  const shake = trauma * trauma * settings.shake;
  const t = now / 1000;
  cameraRig.position.set(
    shake * 0.9 * Math.sin(t * 47.3),
    shake * 0.9 * Math.sin(t * 39.7 + 1.3),
    0,
  );
  camera.lookAt(0, 0, 0);
  // Predicted-end marker pulses while aiming so the predicted outcome reads.
  if (previewEndRing.visible) {
    const s = 1 + 0.18 * Math.sin(t * 6);
    previewEndRing.scale.setScalar(s);
  }
  if (!stopped) {
    updateParticles(dt);
    updateShockwaves(dt);
    const level = levelById(state.levelId);
    if (level) {
      // The level clock runs while aiming; during flight it advances in
      // lockstep with the simulation inside stepFlightLoop.
      if (state.phase === 'aim') {
        levelTime += dt;
        if (levelHasMovingPlanets(level)) {
          previewRefresh += dt;
          if (previewRefresh >= 0.15) {
            previewRefresh = 0;
            // Re-aim at the same angle/power: the preview and its readout
            // follow the planets as they move.
            setAim(state.aimAngle, state.aimPower);
          }
        }
      }
      updatePlanetMeshes();
      // Black hole accretion discs swirl; photon rings counter-rotate.
      for (const bh of blackHoleMeshes) {
        bh.disc.rotation.z += dt * 0.9;
        bh.ring.rotation.z -= dt * 0.4;
      }
      // Portal discs swirl and their rings breathe, so twins read as live.
      for (const portal of portalMeshes) {
        portal.disc.rotation.z += dt * 1.6;
        const pulse = 1 + 0.06 * Math.sin(t * 3 + portal.group.position.x);
        portal.ring.scale.setScalar(portal.base * pulse);
      }
      // Shield rings turn slowly around their target.
      for (const shield of shieldMeshes) {
        if (shield && shield.visible) shield.rotation.z += dt * 0.6;
      }
      targetMeshes.forEach((m, i) => {
        if (!m.visible) return;
        const r = level.targets[i].r;
        m.scale.setScalar(r * (1 + 0.12 * Math.sin(now * 0.004 + i * 1.7)));
        m.rotation.y += dt * 0.8;
        m.rotation.x += dt * 0.4;
      });
      targetRings.forEach((ring, i) => {
        if (!ring.visible) return;
        ring.rotation.z += dt * 0.5;
      });
    }
    if (state.phase === 'fly' && flight) {
      stepFlightLoop(dt);
      if (flight && comet.visible) {
        trailHistory.push([flight.x, flight.y]);
        if (trailHistory.length > TRAIL_MAX) trailHistory.shift();
        updateTrailLine();
        comet.rotation.y += dt * 3;
      }
    }
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- public hooks (bot harness / tests)
window.__orbit = {
  version: VERSION,
  threeVersion: THREE_VERSION,
  state,
  selectLevel: (id) => { ensureAudio(); startLevel(id); },
  aim: (angle, power) => { if (state.phase === 'aim') setAim(angle, power); },
  launch: () => launch(),
  // Camera zoom (Block 8): current factor and a clamped setter for the
  // render check (wheel / pinch / buttons / keys all funnel through it).
  zoom: () => cameraZoom,
  setZoom: (v) => setZoom(v),
  // Challenge-mode hooks (bot harness / render check).
  playDaily: () => { ensureAudio(); startDaily(); },
  playSeed: (raw) => { ensureAudio(); return startSeed(raw); },
  playEndless: () => { ensureAudio(); startEndless(); },
  // Best collecting shot from the current aim clock (coarse grid, launch
  // times from now up to 3s ahead): the render check waits for the clock
  // to reach the returned t0, then launches — on moving-planet levels
  // that means waiting for the bend to line up. A shot that only cracks
  // a shield still counts: on a shielded level the crack is the useful
  // first move, so it is returned (with shieldCracks) instead of null.
  solveShot: () => {
    const level = levelById(state.levelId);
    if (!level || state.phase !== 'aim') return null;
    const t0s = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((d) => levelTime + d);
    const best = solveShot(level, state.collected, { coarse: true, t0s, shieldHits: state.shieldHits });
    if (!best || (best.res.collected.length === 0 && (best.res.shieldCracks || 0) === 0)) return null;
    return {
      angle: best.angle, power: best.power, t0: best.t0,
      collected: best.res.collected.length, outcome: best.res.outcome,
      shieldCracks: best.res.shieldCracks || 0,
    };
  },
  challengeInfo: () => ({
    mode: state.mode,
    seed: state.challengeSeed,
    seedLabel: state.seedLabel || null,
    round: state.endlessRound,
    difficulty: (() => {
      const level = levelById(state.levelId);
      return level && typeof level.difficulty === 'number' ? level.difficulty : null;
    })(),
    dailyDate: state.dailyDate,
  }),
  info: () => {
    const level = levelById(state.levelId);
    return {
      levelTime,
      blackHoles: level ? levelBlackHoles(level).length : 0,
      movingPlanets: level ? level.planets.filter((p) => p.orbit).length : 0,
      portals: level ? levelPortals(level).length : 0,
      bouncePads: level ? levelBouncePads(level).length : 0,
      shieldedTargets: level ? level.targets.filter((t) => targetHits(t) > 1).length : 0,
      shieldHits: { ...state.shieldHits },
      planetPositions: planetMeshes.map((m) => [m.position.x, m.position.y]),
    };
  },
  // Live audio state for the render check: mute/volume, whether the
  // music scheduler is running, the current intensity layer (0/1/2), and
  // the most recently played SFX name.
  audioState: () => ({
    audioReady: !!audioCtx,
    muted: settings.muted,
    volume: settings.volume,
    musicPlaying: !!musicTimer && !!audioCtx,
    intensity: musicIntensity(),
    lastSfx,
    lastSfxAt,
  }),
  feedbackState: () => ({
    trauma,
    hitStopActive: performance.now() < hitStopUntil,
    hitStopToken,
    shockwavesActive: shockwaves.filter((s) => s.life > 0).length,
    particlesAlive: countAliveParticles(),
    slingshotCount,
    portalCount,
    bounceCount,
    shieldHitCount,
  }),
  newGame: () => {
    save = defaultSave();
    persistSave();
    state.unlocked = save.unlocked;
    renderLevelSelect();
    startLevel(1);
  },
};

// ---------------------------------------------------------------- init
// A ?seed= link opens that exact generated level (after the how-to on a
// first visit, so the link still works for a brand-new player).
const urlSeedRaw = new URLSearchParams(window.location.search).get('seed');
const pendingSeed = parseSeedParam(urlSeedRaw);
if (pendingSeed !== null) {
  const seedInput = $('seed-input');
  if (seedInput) seedInput.value = String(urlSeedRaw).trim().slice(0, 32);
}
document.querySelector('.version').textContent = `v${VERSION} · Three.js ${THREE_VERSION}`;
fitCamera();
wireButtons();
updateMuteLabels();
updateVolumeLabels();
renderLevelSelect();
if (!save.seenHowTo) {
  state.phase = 'howto';
  showOnly('howto');
} else if (pendingSeed !== null) {
  startSeed(urlSeedRaw);
} else {
  showOnly('menu');
}
requestAnimationFrame(animate);
