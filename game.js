// Neon Orbit — Three.js 3D gravity-slingshot puzzle (v0.16.0).
// Drag back from the comet to aim, release to launch. Planets bend the
// flight with gravity; collect every magenta target before shots run out.
import * as THREE from 'three';
import {
  LEVELS, PLAYFIELD_RADIUS, SUBSTEP,
  levelById, shotBudget, starsForShots, starThresholds, isLevelComplete,
  generateDecor, launchState, stepFlight, previewShot, planetPosAt, targetPosAt,
  levelHasMovingPlanets, levelHasMovingTargets, levelBlackHoles, levelPortals, levelBouncePads,
  targetHits, FEEDBACK, isNearMiss,
  defaultSave, serializeSave, parseSave, totalStars,
  dateSeed, dateKey, dailyDifficulty, endlessDifficulty, parseSeedParam,
  generateLevel, registerGeneratedLevel, solveShot,
  TIME_ATTACK_LEVEL_IDS, TIME_ATTACK_SECONDS, formatClock,
  clampZoom, isTapGesture, focusStep, createPerfGuard, PERF_LEVELS,
  slowMoScale, SLOW_MO_MS, zenLevel, ZEN_ID,
  ACHIEVEMENTS, checkAchievements, defaultStats,
} from './physics.js';

export const VERSION = '0.16.0';
const THREE_VERSION = '0.160.0';
const SAVE_KEY = 'nor-stars';
const SETTINGS_KEY = 'nor-settings';
const MAX_DRAG = 12; // world units of pull for full launch power
const PREVIEW_MAX = 240;
const PREVIEW_DOTS = 96; // fading trajectory dots sampled from the preview
const FINE_AIM_SCALE = 0.25; // Shift-held drag moves the aim 4x slower
const TRAIL_MAX = 48;
const PARTICLE_MAX = 240;
// FPS guard (#46) scales this 1 -> 0.35 as the quality level drops, so
// bursts and confetti shrink instead of the frame rate collapsing.
let particleScale = 1;

// ---------------------------------------------------------------- state
// Challenge-mode ids: generated levels register under these ids and
// never touch the campaign unlock chain (campaign levels are 1..12).
const DAILY_ID = 900;
const SEED_ID = 901;
const ENDLESS_ID = 902;

const state = {
  version: VERSION,
  phase: 'menu', // menu | howto | aim | fly | complete | failed | paused
  mode: 'campaign', // campaign | daily | seed | endless | timeattack | zen
  levelId: 1,
  levelName: '',
  shotsUsed: 0,
  shotsLeft: 0,
  targetsRemaining: 0,
  collected: [],
  // Zen Sandbox session count: every star collected in the current zen
  // session (targets respawn, so this only ever grows). The session best
  // is saved as save.zenBest when the player quits.
  zenCollected: 0,
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
  // Time Attack run state: one shared clock across levels 1-5, the stars
  // banked so far, and how many of the five levels are cleared.
  timeLeft: 0,
  timeAttackIndex: 0,
  timeAttackStars: 0,
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
  // Reduce motion defaults to the OS preference when nothing is saved
  // yet, so a player who asked their system for less motion gets it on
  // the first visit without hunting for a toggle (#44 / #50).
  let osReduceMotion = false;
  try {
    osReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* matchMedia unavailable */ }
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      muted: !!raw.muted,
      volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : 0.6,
      shake: typeof raw.shake === 'number' ? Math.max(0, Math.min(1, raw.shake)) : 1,
      zoom: clampZoom(raw.zoom),
      reduceMotion: typeof raw.reduceMotion === 'boolean' ? raw.reduceMotion : osReduceMotion,
      music: typeof raw.music === 'boolean' ? raw.music : true,
    };
  } catch {
    return { muted: false, shake: 1, zoom: 1, reduceMotion: osReduceMotion, music: true };
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
  // Achievement unlock: a bright two-note fanfare, distinct from the
  // level-unlock chime so the render check can tell them apart.
  achievement() {
    recordSfx('achievement');
    tone(1046, 0.14, 'sine', 0.14);
    tone(1568, 0.22, 'sine', 0.14, null, 0.1);
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
// progression rotates by level so later levels sound different. A Time
// Attack run under 30 seconds on the clock is tense too.
function musicIntensity() {
  let intensity = state.levelId >= 3 ? 1 : 0;
  if (state.mode === 'timeattack' && state.timeLeft <= 30) intensity = 2;
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
  if (musicTimer || !audioCtx || !settings.music) return;
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

function stopMusic() {
  if (musicTimer) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

// Music toggle (#44): off stops the scheduler (the gain stays, so SFX
// still play), on restarts it from the next step when audio is ready.
function setMusic(on) {
  settings.music = !!on;
  persistSettings();
  if (settings.music) startMusic();
  else stopMusic();
  updateSettingsToggles();
}

// Reduce motion + music checkboxes live in the menu and the pause menu;
// every change syncs all four so the two panels never disagree.
function updateSettingsToggles() {
  for (const suffix of ['menu', 'pause']) {
    const rm = document.getElementById(`reduce-motion-${suffix}`);
    if (rm) rm.checked = settings.reduceMotion;
    const mu = document.getElementById(`music-toggle-${suffix}`);
    if (mu) mu.checked = settings.music;
  }
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

// Nebula background (#29): one ShaderMaterial — a slowly drifting
// 2-octave value-noise nebula in violet / magenta / cyan on a plane behind
// the starfield, so the sky has depth instead of flat black. The uTime
// uniform advances every frame in the animate loop.
const nebulaUniforms = { uTime: { value: 0 } };
const nebulaMat = new THREE.ShaderMaterial({
  uniforms: nebulaUniforms,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    // Cheap hash (no sin — a sin-based hash is far too slow for a
    // fullscreen shader under software rendering, and it stalled the
    // game clock enough to time out the render check's launch waits).
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // Two octaves keep the clouds soft without paying for a third.
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 2; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(11.3, 7.7);
        a *= 0.5;
      }
      return v;
    }
    void main() {
      vec2 p = vUv * 3.0;
      float t = uTime * 0.012;
      float n = fbm(p + vec2(t, -t * 0.6));
      float m = fbm(p * 1.7 - vec2(t * 0.7, t));
      vec3 base = vec3(0.027, 0.012, 0.075);
      vec3 violet = vec3(0.16, 0.07, 0.38);
      vec3 magenta = vec3(0.45, 0.08, 0.42);
      vec3 cyan = vec3(0.05, 0.25, 0.38);
      vec3 col = base + violet * smoothstep(0.35, 0.75, n);
      col += magenta * smoothstep(0.55, 0.85, m) * 0.7;
      col += cyan * smoothstep(0.6, 0.9, n * m) * 0.5;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  depthWrite: false,
});
const nebula = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), nebulaMat);
nebula.position.z = -12;
scene.add(nebula);

// Planet atmosphere glow (#29): one fresnel ShaderMaterial per effect —
// a backside sphere a little larger than the planet, additive, so each
// planet wears a halo in its own colour. One material instance per planet
// (same shader code, its own glowColor uniform).
const planetGlowGeo = new THREE.SphereGeometry(1, 32, 24);
const PLANET_GLOW_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const PLANET_GLOW_FRAG = `
  uniform vec3 glowColor;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
    gl_FragColor = vec4(glowColor, 1.0) * intensity;
  }
`;
function makePlanetGlowMaterial(hexColor) {
  return new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(hexColor) } },
    vertexShader: PLANET_GLOW_VERT,
    fragmentShader: PLANET_GLOW_FRAG,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

// Level group: planets + targets for the current level.
const levelGroup = new THREE.Group();
scene.add(levelGroup);
let planetMeshes = [];
let planetRings = [];
let planetGlows = []; // fresnel atmosphere halo per planet (#29)
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

// Comet trail (cyan line, recent positions) + its glow ribbon (#28): a
// triangle strip whose width tapers and whose colour fades to black along
// the trail, so additive blending makes it glow bright at the head and
// melt away at the tail. The thin cyan line stays as a bright core.
const trailPositions = new Float32Array(TRAIL_MAX * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
  color: 0x22d3ee, transparent: true, opacity: 0.7,
}));
trailLine.frustumCulled = false;
trailLine.visible = false;
scene.add(trailLine);
// Ribbon buffers: two vertices per trail point, pre-built index for the
// maximum strip length; updateTrailLine rewrites positions + colours.
const ribbonPositions = new Float32Array(TRAIL_MAX * 2 * 3);
const ribbonColors = new Float32Array(TRAIL_MAX * 2 * 3);
const ribbonIndex = new Uint16Array((TRAIL_MAX - 1) * 6);
for (let i = 0; i < TRAIL_MAX - 1; i++) {
  const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
  ribbonIndex.set([a, b, c, b, d, c], i * 6);
}
const ribbonGeo = new THREE.BufferGeometry();
ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3));
ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribbonColors, 3));
ribbonGeo.setIndex(new THREE.BufferAttribute(ribbonIndex, 1));
const trailRibbon = new THREE.Mesh(ribbonGeo, new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
}));
trailRibbon.frustumCulled = false;
trailRibbon.visible = false;
scene.add(trailRibbon);
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
  const n = Math.max(1, Math.round(count * particleScale));
  for (let k = 0; k < n; k++) {
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
  // Reduce motion (#50): expanding flash rings are the one effect that
  // reads as a strobe — skip them entirely; the burst and sound remain.
  if (settings.reduceMotion) return;
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

// Level-complete confetti (#30): a pool of 3D shards (small coloured
// planes) that burst from the collected targets when a level completes,
// tumble under gravity and shrink away. Pooled and reused — no allocation
// per win.
const CONFETTI_MAX = 90;
const CONFETTI_COLORS = [0xffd166, 0xff2d95, 0x22d3ee, 0xa855f7, 0xffffff];
const confettiGeo = new THREE.PlaneGeometry(0.42, 0.26);
const confettiMats = CONFETTI_COLORS.map((c) => new THREE.MeshBasicMaterial({
  color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false,
}));
const confettiMeshes = [];
const confettiVel = new Float32Array(CONFETTI_MAX * 3);
const confettiSpin = new Float32Array(CONFETTI_MAX * 3);
const confettiLife = new Float32Array(CONFETTI_MAX);
const confettiMaxLife = new Float32Array(CONFETTI_MAX);
for (let i = 0; i < CONFETTI_MAX; i++) {
  const mesh = new THREE.Mesh(confettiGeo, confettiMats[i % confettiMats.length]);
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  confettiMeshes.push(mesh);
}
let confettiCursor = 0;

function spawnConfetti(x, y, count) {
  // Reduce motion (#50): no confetti storm on a win — the win arpeggio
  // and the gold bursts at each target still celebrate.
  if (settings.reduceMotion) return;
  const n = Math.max(1, Math.round(count * particleScale));
  for (let k = 0; k < n; k++) {
    const i = confettiCursor;
    confettiCursor = (confettiCursor + 1) % CONFETTI_MAX;
    const mesh = confettiMeshes[i];
    mesh.position.set(x + (Math.random() - 0.5) * 1.5, y + (Math.random() - 0.5) * 1.5, 0.5);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.scale.setScalar(1);
    mesh.visible = true;
    const a = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 7;
    confettiVel[i * 3] = Math.cos(a) * sp;
    confettiVel[i * 3 + 1] = Math.abs(Math.sin(a)) * sp * 0.8 + 2;
    confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 2;
    confettiSpin[i * 3] = (Math.random() - 0.5) * 12;
    confettiSpin[i * 3 + 1] = (Math.random() - 0.5) * 12;
    confettiSpin[i * 3 + 2] = (Math.random() - 0.5) * 12;
    confettiLife[i] = 1.4 + Math.random() * 0.8;
    confettiMaxLife[i] = confettiLife[i];
  }
}

function updateConfetti(dt) {
  for (let i = 0; i < CONFETTI_MAX; i++) {
    if (confettiLife[i] <= 0) continue;
    confettiLife[i] -= dt;
    const mesh = confettiMeshes[i];
    if (confettiLife[i] <= 0) {
      mesh.visible = false;
      continue;
    }
    confettiVel[i * 3 + 1] -= 9 * dt; // gravity pulls the shards down
    mesh.position.x += confettiVel[i * 3] * dt;
    mesh.position.y += confettiVel[i * 3 + 1] * dt;
    mesh.position.z += confettiVel[i * 3 + 2] * dt;
    mesh.rotation.x += confettiSpin[i * 3] * dt;
    mesh.rotation.y += confettiSpin[i * 3 + 1] * dt;
    mesh.rotation.z += confettiSpin[i * 3 + 2] * dt;
    // Shrink away in the last third of life so shards never pop out.
    const f = confettiLife[i] / confettiMaxLife[i];
    mesh.scale.setScalar(f < 0.35 ? Math.max(0.01, f / 0.35) : 1);
  }
}

function countActiveConfetti() {
  let n = 0;
  for (let i = 0; i < CONFETTI_MAX; i++) if (confettiLife[i] > 0) n++;
  return n;
}

// ---------------------------------------------------------------- feedback
// Trauma shake: shake = trauma^2, decays in real time (keeps settling during hit-stop).
// Hit-stop ownership: every hit-stop takes a fresh token; only the newest
// token's deadline freezes time, so an older, longer stop can never end a
// newer freeze early (and vice versa — the newest stop owns the restore).
let trauma = 0;
let peakTrauma = 0; // highest trauma reached on the current shot (Block 14:
// the render check reads it to prove reduce motion really zeroes shake)
let hitStopUntil = 0;
let hitStopToken = 0;
let slingshotCount = 0; // near-miss slingshots credited on the current shot
let portalCount = 0; // portal hops on the current shot
let bounceCount = 0; // bounce-pad reflections on the current shot
let shieldHitCount = 0; // shield cracks on the current shot
// Near-miss slow-mo (#31): a real-time deadline — while now < slowMoUntil
// the animate loop runs the simulation at SLOW_MO_SCALE. The deadline is
// real time, so the dip always restores even mid hit-stop. slowMoCount
// latches how many dips fired on the current shot (render check reads it).
let slowMoUntil = 0;
let slowMoCount = 0;
// Zen target respawn (#21): pending setTimeout ids, plus a generation
// token — a timer from an earlier zen session must never resurrect a
// target in a later level. beginLevel bumps zenGen and clears the timers.
let zenGen = 0;
let zenRespawnTimers = [];

function addTrauma(amount) {
  trauma = Math.min(1, trauma + amount);
  peakTrauma = Math.max(peakTrauma, trauma);
}
function hitStop(seconds) {
  hitStopToken++;
  hitStopUntil = performance.now() + seconds * 1000;
}

// One funnel for every game-feel event, so responses stay proportional.
// Trauma + hit-stop come from the FEEDBACK tier table in physics.js;
// each kind then adds its own sound, particle burst and shockwave ring.
// Reduce motion (#44 / #50): no trauma (so no shake), no shockwave rings
// and no confetti — the sound and the small particle burst still fire, so
// the event reads without the flash or the camera movement.
function feedback(kind, x, y) {
  const f = FEEDBACK[kind];
  if (!f) return;
  if (!settings.reduceMotion) addTrauma(f.trauma);
  if (f.hitStop > 0) hitStop(f.hitStop);
  if (kind === 'launch') { sfx.launch(); recordStat('shots'); }
  else if (kind === 'collect') {
    sfx.collect();
    recordStat('collects');
    spawnBurst(x, y, 0, 0xff2d95, 26, 7, 0.7);
    spawnShockwave(x, y, 0xff2d95, 4.5, 0.7);
  } else if (kind === 'crash') {
    sfx.crash();
    recordStat('crashes');
    spawnBurst(x, y, 0, 0xff6b35, 40, 9, 0.9);
    spawnShockwave(x, y, 0xff6b35, 6, 0.7);
  } else if (kind === 'lost') {
    sfx.lost();
    recordStat('crashes');
    spawnBurst(x, y, 0, 0x22d3ee, 16, 5, 0.6);
  } else if (kind === 'swallowed') {
    sfx.swallow();
    recordStat('crashes');
    spawnBurst(x, y, 0, 0xa855f7, 36, 8, 0.9);
    spawnShockwave(x, y, 0xa855f7, 5, 0.7);
  } else if (kind === 'slingshot') {
    slingshotCount++;
    recordStat('slingshots');
    sfx.slingshot();
    spawnBurst(x, y, 0, 0xffd166, 14, 6, 0.5);
    // Near-miss slow-mo (#31): the bend reads better at 0.35x for a beat.
    // Skipped under reduce motion — a time-scale dip is motion, and the
    // real-time deadline guarantees the game never stays slow.
    if (!settings.reduceMotion) {
      slowMoUntil = performance.now() + SLOW_MO_MS;
      slowMoCount++;
    }
  } else if (kind === 'portal') {
    portalCount++;
    recordStat('portals');
    sfx.portal();
    spawnBurst(x, y, 0, 0x22d3ee, 20, 7, 0.6);
    spawnShockwave(x, y, 0x22d3ee, 4, 0.6);
  } else if (kind === 'bounce') {
    bounceCount++;
    recordStat('bounces');
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

// ---------------------------------------------------------------- achievements (Block 16)
// Lifetime stats live in save.stats; every event that matters funnels
// through recordStat, which bumps the counter, checks for newly earned
// achievements, toasts each one (gold banner, unlock chime, screen-reader
// announcement) and persists. Toasts queue so a multi-unlock moment
// (first launch + first star + first win on one good shot) shows each in
// turn instead of overwriting. The toast is pointer-events: none so it
// can never block a click, and it is plain text — no flash — so reduce
// motion does not need to suppress it.
let achievementToastQueue = [];
let achievementToastTimer = 0;

function recordStat(key, delta = 1) {
  if (!save.stats) save.stats = defaultStats();
  const next = (save.stats[key] || 0) + delta;
  save.stats[key] = Math.max(0, Math.min(999999, next));
  const newly = checkAchievements(save);
  if (newly.length) {
    for (const id of newly) save.achievements.push(id);
    achievementToastQueue.push(...newly);
    showNextAchievementToast();
  }
  persistSave();
}

function showNextAchievementToast() {
  const el = $('achievement-toast');
  if (!el || achievementToastTimer) return;
  const id = achievementToastQueue.shift();
  if (!id) return;
  const ach = ACHIEVEMENTS.find((a) => a.id === id);
  if (!ach) { showNextAchievementToast(); return; }
  el.textContent = `Achievement unlocked — ${ach.icon} ${ach.name}: ${ach.desc}`;
  el.classList.remove('hidden');
  sfx.achievement();
  announce(`Achievement unlocked — ${ach.name}. ${ach.desc}`);
  achievementToastTimer = window.setTimeout(() => {
    achievementToastTimer = 0;
    el.classList.add('hidden');
    if (achievementToastQueue.length) showNextAchievementToast();
  }, 4000);
}

// ---------------------------------------------------------------- DOM helpers
const $ = (id) => document.getElementById(id);
const OVERLAYS = ['menu', 'howto', 'complete', 'failed', 'pause', 'stats', 'achievements'];
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
  achievements: 'btn-achievements-close',
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
  if (mode === 'zen') return save.zenBest || 0;
  return 0;
}

function updateHUD() {
  const level = levelById(state.levelId);
  const budget = level ? shotBudget(level) : 0;
  $('hud-level').textContent = level
    ? (state.mode === 'campaign' ? `Level ${level.id} — ${level.name}`
      : state.mode === 'timeattack' ? `Time Attack ${state.timeAttackIndex + 1}/5 — ${level.name}`
      : level.name)
    : '';
  // Time Attack levels show the campaign best for the level — the run's
  // banked stars live on the complete screen, not in the per-level slot.
  // Zen shows the session best as a plain count (it can exceed 3 stars).
  const best = state.mode === 'campaign' || state.mode === 'timeattack'
    ? (save.stars[state.levelId] || 0)
    : challengeBest(state.mode);
  $('hud-stars').textContent = state.mode === 'zen'
    ? `Zen best ${best} ★`
    : '★'.repeat(best) + '☆'.repeat(3 - best);
  $('hud-par').textContent = level
    ? (state.mode === 'zen' ? 'Zen Sandbox — no shot limit' : `Par ${level.par}`)
    : '';
  $('hud-shots').textContent = state.mode === 'zen'
    ? `Shots ${state.shotsUsed} · ∞`
    : `Shots ${state.shotsUsed}/${budget}`;
  $('hud-targets').textContent = state.mode === 'zen'
    ? `★ ${state.zenCollected} collected · ${state.targetsRemaining} on field`
    : state.targetsRemaining === 0
      ? 'All targets collected'
      : `Targets ${state.targetsRemaining} left`;
  // The Time Attack clock lives in the HUD mid row, gold and bold; the
  // animate loop refreshes its text once per second while the run ticks.
  const timerEl = $('hud-timer');
  timerEl.classList.toggle('hidden', state.mode !== 'timeattack');
  if (state.mode === 'timeattack') timerEl.textContent = `⏱ ${formatClock(state.timeLeft)}`;
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

// Screen-reader announcements (#50): the live region is visually hidden
// but read aloud on every major event, so the game is playable by ear —
// level starts, collects, lost shots, wins and failures.
function announce(msg) {
  const el = $('sr-status');
  if (el) el.textContent = msg;
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
  const taBest = save.timeAttackBest;
  $('stats-challenge').textContent =
    `Daily best today: ${'★'.repeat(dailyBest)}${'☆'.repeat(3 - dailyBest)}` +
    ` · Endless best: ${save.endlessBest || 0} round${(save.endlessBest || 0) === 1 ? '' : 's'}` +
    ` · Time Attack best: ${taBest ? `${taBest.stars}/15 stars in ${formatClock(taBest.seconds)}` : 'no full clear yet'}` +
    ` · Zen best: ${save.zenBest || 0} star${(save.zenBest || 0) === 1 ? '' : 's'} in one session` +
    ` · ${seedCount} seed${seedCount === 1 ? '' : 's'} played`;
  // Lifetime stats (Block 16): every shot, collect, lost shot and trick
  // ever recorded, plus how many of the 14 achievements are unlocked.
  const s = save.stats || defaultStats();
  $('stats-lifetime').textContent =
    `Shots launched: ${s.shots || 0} · Stars collected: ${s.collects || 0}` +
    ` · Shots lost: ${s.crashes || 0} · Slingshots: ${s.slingshots || 0}` +
    ` · Levels won: ${s.wins || 0} · Levels failed: ${s.fails || 0}`;
  $('stats-achievements').textContent =
    `Achievements: ${(save.achievements || []).length} / ${ACHIEVEMENTS.length} unlocked`;
}

// Achievements overlay (Block 16): one row per achievement — gold when
// unlocked, dimmed with its goal still shown when locked, so the list
// doubles as a checklist of things left to do.
function renderAchievements() {
  const grid = $('achievements-grid');
  grid.innerHTML = '';
  const unlocked = new Set(save.achievements || []);
  for (const ach of ACHIEVEMENTS) {
    const row = document.createElement('div');
    row.className = 'achievement-row' + (unlocked.has(ach.id) ? ' unlocked' : '');
    const icon = document.createElement('span');
    icon.className = 'achievement-icon';
    icon.textContent = ach.icon;
    const name = document.createElement('span');
    name.className = 'achievement-name';
    name.textContent = ach.name;
    const desc = document.createElement('span');
    desc.className = 'achievement-desc';
    desc.textContent = ach.desc;
    const stateEl = document.createElement('span');
    stateEl.className = 'achievement-state';
    stateEl.textContent = unlocked.has(ach.id) ? 'Unlocked ★' : 'Locked';
    row.append(icon, name, desc, stateEl);
    grid.appendChild(row);
  }
  $('achievements-count').textContent =
    `${unlocked.size} / ${ACHIEVEMENTS.length} unlocked`;
}

// Reset progress (Block 16, #48): wipes stars, unlocks, bests, lifetime
// stats and achievements back to a fresh save and re-renders the menu.
// The button arms on first click and fires on the second within 5s, so a
// stray tap can never erase a campaign.
let resetArmedUntil = 0;
function resetSave() {
  save = defaultSave();
  persistSave();
  state.unlocked = save.unlocked;
  renderLevelSelect();
  renderStats();
  announce('Progress reset — all stars, unlocks and achievements erased.');
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
  planetGlows = [];
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
    // Atmosphere glow (#29): a fresnel halo in the planet's own colour,
    // a little larger than the planet so the rim reads against the dark.
    const glow = new THREE.Mesh(planetGlowGeo, makePlanetGlowMaterial(p.color));
    glow.position.set(p.x, p.y, 0);
    glow.scale.setScalar(p.r * 1.45);
    levelGroup.add(glow);
    planetGlows.push(glow);
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
    // Moving targets show their orbit path so the player can lead the shot.
    if (t.orbit) {
      const o = t.orbit;
      const pts = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(o.cx + o.radius * Math.cos(a), o.cy + o.radius * Math.sin(a), -0.4));
      }
      const pathGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({
        color: 0xff2d95, transparent: true, opacity: 0.28,
      }));
      levelGroup.add(path);
    }
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

const RIBBON_HEAD = new THREE.Color(0x22d3ee);
const RIBBON_TAIL = new THREE.Color(0x000000);
const ribbonColor = new THREE.Color();

function updateTrailLine() {
  // Thin bright core line.
  for (let i = 0; i < trailHistory.length; i++) {
    trailPositions[i * 3] = trailHistory[i][0];
    trailPositions[i * 3 + 1] = trailHistory[i][1];
    trailPositions[i * 3 + 2] = 0;
  }
  trailGeo.setDrawRange(0, trailHistory.length);
  trailGeo.attributes.position.needsUpdate = true;
  trailLine.visible = trailHistory.length > 1;
  // Fading ribbon (#28): two vertices per point, offset perpendicular to
  // the local direction, width tapering head -> tail, colour fading cyan
  // -> black (additive blending turns black into transparent).
  const n = trailHistory.length;
  if (n <= 1) {
    trailRibbon.visible = false;
    return;
  }
  for (let i = 0; i < n; i++) {
    const p = trailHistory[i];
    const q = trailHistory[Math.min(i + 1, n - 1)];
    const r = trailHistory[Math.max(i - 1, 0)];
    let dx = q[0] - r[0], dy = q[1] - r[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // f = 0 at the head (newest point), 1 at the tail (oldest point):
    // trailHistory is oldest-first, so the newest point is last.
    const f = 1 - i / (n - 1);
    const half = 0.55 * (1 - f) + 0.06 * f;
    const nx = -dy * half, ny = dx * half;
    ribbonPositions[(i * 2) * 3] = p[0] + nx;
    ribbonPositions[(i * 2) * 3 + 1] = p[1] + ny;
    ribbonPositions[(i * 2) * 3 + 2] = 0;
    ribbonPositions[(i * 2 + 1) * 3] = p[0] - nx;
    ribbonPositions[(i * 2 + 1) * 3 + 1] = p[1] - ny;
    ribbonPositions[(i * 2 + 1) * 3 + 2] = 0;
    ribbonColor.lerpColors(RIBBON_HEAD, RIBBON_TAIL, f);
    for (let v = 0; v < 2; v++) {
      ribbonColors[(i * 2 + v) * 3] = ribbonColor.r;
      ribbonColors[(i * 2 + v) * 3 + 1] = ribbonColor.g;
      ribbonColors[(i * 2 + v) * 3 + 2] = ribbonColor.b;
    }
  }
  ribbonGeo.setDrawRange(0, (n - 1) * 6);
  ribbonGeo.attributes.position.needsUpdate = true;
  ribbonGeo.attributes.color.needsUpdate = true;
  trailRibbon.visible = true;
}

let flight = null;
let flightAcc = 0;
let flightEnding = false;
let shotTimer = 0;
let levelTime = 0; // seconds since the level started; moving planets follow it
let previewRefresh = 0; // throttle for re-previewing while planets move
let lastTimerSecond = -1; // last whole second shown on the Time Attack clock
const tmpNewly = [];

// ---------------------------------------------------------------- state audit (Block 11, #47)
// Once a second, while a level is running, validate the live simulation
// state: the level clock, the flight, the comet mesh, and the shot
// counters. A corrupted value (NaN from bad input, a runaway counter)
// is recovered on the spot — a lost shot, or a level restart — instead
// of freezing the game or crashing the tab. The audit never throws:
// a failure inside the audit itself is counted, not propagated.
let auditChecks = 0;
let auditFailures = 0;
let auditRecoveries = 0;
let lastAuditFailure = null;

function auditFailureReason() {
  const level = levelById(state.levelId);
  if (!level) return null;
  if (!Number.isFinite(levelTime)) return 'levelTime is not finite';
  // Zen's budget is infinite (shotBudget returns Infinity), so the shot
  // counters have no finite upper bound there: shotsLeft is legitimately
  // Infinity in zen, and shotsUsed just grows. A finite level keeps the
  // strict integer-in-range checks.
  const budget = shotBudget(level);
  if (!Number.isInteger(state.shotsUsed) || state.shotsUsed < 0
    || (Number.isFinite(budget) && state.shotsUsed > budget)) {
    return 'shotsUsed out of range';
  }
  // Zen's budget is infinite, so shotsLeft is legitimately Infinity
  // there; a finite level keeps the strict integer-in-range check.
  const shotsLeftOk = Number.isFinite(budget)
    ? (Number.isInteger(state.shotsLeft) && state.shotsLeft >= 0 && state.shotsLeft <= budget)
    : (state.shotsLeft === Infinity);
  if (!shotsLeftOk) return 'shotsLeft out of range';
  if (!Number.isInteger(state.targetsRemaining) || state.targetsRemaining < 0 || state.targetsRemaining > level.targets.length) {
    return 'targetsRemaining out of range';
  }
  if (!['aim', 'fly', 'complete', 'failed', 'paused', 'menu', 'howto'].includes(state.phase)) {
    return 'unknown phase';
  }
  if (flight) {
    if (![flight.x, flight.y, flight.vx, flight.vy, flight.t].every(Number.isFinite)) {
      return 'flight state is not finite';
    }
    if (Math.abs(flight.x) > 1e6 || Math.abs(flight.y) > 1e6) {
      return 'flight position out of range';
    }
  }
  if (![comet.position.x, comet.position.y, comet.position.z].every(Number.isFinite)) {
    return 'comet position is not finite';
  }
  return null;
}

function recoverFromAudit(reason) {
  auditRecoveries++;
  lastAuditFailure = reason;
  // A corrupt flight mid-shot is a lost shot: end it cleanly so the
  // player re-aims instead of watching a frozen comet. The recovery
  // gives the same lost-shot feel as the physics guard's 'invalid'
  // path (sound + burst + announcement) — which path fires is a race
  // between this 1s audit and the next animation frame, so both must
  // read the same. The position falls back to the pad when the flight
  // itself is NaN, so a bad coordinate never poisons the particles.
  if (state.phase === 'fly' && flight) {
    const level = levelById(state.levelId);
    const fx = Number.isFinite(flight.x) ? flight.x : (level ? level.pad.x : 0);
    const fy = Number.isFinite(flight.y) ? flight.y : (level ? level.pad.y : 0);
    feedback('lost', fx, fy);
    announce('Comet flew out of bounds — shot lost.');
    flightEnding = true;
    flight = null;
    comet.visible = false;
    trailHistory = [];
    updateTrailLine();
    scheduleEndShot(300);
    return;
  }
  // Anything else (bad clock, bad counters, bad comet) restarts the
  // level — the attempt is lost but the game stays playable.
  if (state.phase === 'aim' || state.phase === 'fly') {
    restartCurrent();
    return;
  }
  if (!Number.isFinite(levelTime)) levelTime = 0;
}

function runStateAudit() {
  if (state.phase !== 'aim' && state.phase !== 'fly') return;
  auditChecks++;
  let reason = null;
  try { reason = auditFailureReason(); } catch (err) { reason = `audit threw: ${err.message}`; }
  if (!reason) return;
  auditFailures++;
  console.warn(`[audit] ${reason} — recovering`);
  try { recoverFromAudit(reason); } catch (err) { console.warn(`[audit] recovery threw: ${err.message}`); }
}

function beginLevel(level, mode) {
  if (!level) return;
  window.clearTimeout(shotTimer);
  // A new level invalidates any pending zen respawns from the last one.
  for (const t of zenRespawnTimers) window.clearTimeout(t);
  zenRespawnTimers = [];
  zenGen++;
  state.mode = mode;
  state.levelId = level.id;
  state.levelName = level.name;
  state.shotsUsed = 0;
  state.collected = [];
  state.shieldHits = {};
  state.zenCollected = 0;
  state.stars = mode === 'campaign' ? (save.stars[level.id] || 0)
    : mode === 'zen' ? 0 : challengeBest(mode);
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
  announce(mode === 'zen'
    ? 'Zen Sandbox — unlimited shots. Collect stars; they drift back onto the field. No fail state, just flow.'
    : `Level ${level.id} — ${level.name}. Par ${level.par}, ${level.targets.length} target${level.targets.length === 1 ? '' : 's'}, ${state.shotsLeft} shots.`);
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

// Zen Sandbox (#21): the handcrafted playground from physics.js —
// unlimited shots, respawning targets, no fail state. Registered under
// ZEN_ID (903) so levelById / shotBudget work on it like any level.
function startZen() {
  const level = zenLevel();
  registerGeneratedLevel(level);
  beginLevel(level, 'zen');
}

// Time Attack: one 4:00 clock across campaign levels 1-5. Clearing a
// level banks its stars and advances to the next; the run ends when the
// clock hits zero, a level runs out of shots, or all five are cleared.
function startTimeAttack() {
  state.timeAttackIndex = 0;
  state.timeAttackStars = 0;
  state.timeLeft = TIME_ATTACK_SECONDS;
  lastTimerSecond = -1;
  const level = levelById(TIME_ATTACK_LEVEL_IDS[0]);
  beginLevel(level, 'timeattack');
}

function nextTimeAttackLevel() {
  const id = TIME_ATTACK_LEVEL_IDS[state.timeAttackIndex];
  const level = levelById(id);
  if (!level) { quitToMenu(); return; }
  beginLevel(level, 'timeattack');
}

// Retry / restart / replay: replays the exact same challenge level (same
// seed and round), so a retry is never a different puzzle. A Time Attack
// retry restarts the whole run — the clock cannot be rewound.
function restartCurrent() {
  if (state.mode === 'daily') startDaily();
  else if (state.mode === 'seed') startSeed(state.seedLabel || String(state.challengeSeed));
  else if (state.mode === 'endless') startEndlessRound(state.endlessRound);
  else if (state.mode === 'timeattack') startTimeAttack();
  else if (state.mode === 'zen') startZen();
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
  peakTrauma = 0;
  portalCount = 0;
  bounceCount = 0;
  shieldHitCount = 0;
  slowMoCount = 0;
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
  // Zen never completes or fails: the shot budget is infinite and the
  // targets respawn, so every shot just ends back at the pad.
  if (state.mode !== 'zen' && isLevelComplete(level, state.collected)) {
    completeLevel();
    return;
  }
  if (state.mode !== 'zen' && state.shotsUsed >= shotBudget(level)) {
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
  } else if (state.mode === 'timeattack') {
    // A cleared level banks its stars into the run total. On the fifth
    // level the run is over: the best full clear is most stars, then
    // fastest — a partial run never records a best.
    state.timeAttackStars += stars;
    state.timeAttackIndex++;
    if (state.timeAttackIndex >= TIME_ATTACK_LEVEL_IDS.length) {
      const secondsUsed = Math.round(TIME_ATTACK_SECONDS - state.timeLeft);
      const best = save.timeAttackBest;
      if (!best || state.timeAttackStars > best.stars
        || (state.timeAttackStars === best.stars && secondsUsed < best.seconds)) {
        save.timeAttackBest = { stars: state.timeAttackStars, seconds: secondsUsed };
      }
    }
  }
  // Lifetime stats (Block 16): a win, a one-shot clear, a last-shot win
  // and a daily win each feed the achievements (recordStat toasts any
  // newly earned one and persists the save).
  recordStat('wins');
  if (state.shotsUsed === 1) recordStat('oneShotClears');
  if (state.shotsUsed >= shotBudget(level)) recordStat('lastShotWins');
  if (state.mode === 'daily') recordStat('dailyWins');
  persistSave();
  state.phase = 'complete';
  state.targetsRemaining = 0;
  feedback('win', 0, 0);
  // A fresh unlock rings a rising chime just after the win arpeggio.
  if (unlockedNew) window.setTimeout(() => sfx.unlock(), 450);
  for (const t of level.targets) {
    const pos = targetPosAt(t, levelTime);
    spawnBurst(pos.x, pos.y, 0, 0xffd166, 30, 8, 1.0);
    spawnShockwave(pos.x, pos.y, 0xffd166, 7, 0.9);
    // Confetti burst (#30): 3D shards burst from every collected target.
    spawnConfetti(pos.x, pos.y, 25);
  }
  $('complete-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  let shotsLine = `Finished in ${state.shotsUsed} shot${state.shotsUsed === 1 ? '' : 's'} (par ${level.par})`;
  announce(`Level complete — ${stars} star${stars === 1 ? '' : 's'} in ${state.shotsUsed} shot${state.shotsUsed === 1 ? '' : 's'}.`);
  if (state.mode === 'daily' && save.daily) {
    shotsLine += ` · Daily best: ${'★'.repeat(save.daily.stars)}${'☆'.repeat(3 - save.daily.stars)}`;
  } else if (state.mode === 'seed') {
    const b = save.seedBest[state.seedLabel || String(state.challengeSeed)] || 0;
    shotsLine += ` · Seed best: ${'★'.repeat(b)}${'☆'.repeat(3 - b)}`;
  } else if (state.mode === 'endless') {
    shotsLine += ` · Round ${state.endlessRound} cleared`;
  } else if (state.mode === 'timeattack') {
    if (state.timeAttackIndex >= TIME_ATTACK_LEVEL_IDS.length) {
      const secondsUsed = Math.round(TIME_ATTACK_SECONDS - state.timeLeft);
      const best = save.timeAttackBest;
      shotsLine = `Time Attack complete! ${state.timeAttackStars}/15 stars in ${formatClock(secondsUsed)}`
        + (best ? ` · Best: ${best.stars}/15 in ${formatClock(best.seconds)}` : '');
    } else {
      shotsLine += ` · ${state.timeAttackStars}/15 stars · ${formatClock(state.timeLeft)} left`;
    }
  }
  $('complete-shots').textContent = shotsLine;
  // Endless: the Next button advances to the next round. Time Attack: it
  // advances to the next level until the fifth is cleared, then hides.
  // Daily / seed: no next level — replay the same seed or go back.
  const nextBtn = $('btn-next');
  if (state.mode === 'endless') {
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = 'Next Round →';
  } else if (state.mode === 'timeattack') {
    const more = state.timeAttackIndex < TIME_ATTACK_LEVEL_IDS.length;
    nextBtn.classList.toggle('hidden', !more);
    nextBtn.textContent = 'Next Level →';
  } else {
    nextBtn.textContent = 'Next Level';
    nextBtn.classList.toggle('hidden',
      state.mode !== 'campaign' || state.levelId >= LEVELS.length);
  }
  updateHUD();
  renderLevelSelect();
  showOnly('complete');
}

function failLevel(reason) {
  const level = levelById(state.levelId);
  state.phase = 'failed';
  recordStat('fails');
  sfx.fail();
  let text = `${level.name}: out of shots with ${state.targetsRemaining} target${state.targetsRemaining === 1 ? '' : 's'} left. Try a different arc.`;
  if (state.mode === 'timeattack') {
    if (reason === 'time') {
      text = `Time's up — you cleared ${state.timeAttackIndex} of 5 levels with ${state.timeAttackStars}/15 stars. The clock waits for no comet.`;
    } else {
      text = `Run over — out of shots on level ${state.timeAttackIndex + 1} of 5. You cleared ${state.timeAttackIndex} level${state.timeAttackIndex === 1 ? '' : 's'} with ${state.timeAttackStars}/15 stars.`;
    }
  } else if (state.mode === 'endless') {
    const cleared = state.endlessRound - 1;
    text = `Run over — you cleared ${cleared} round${cleared === 1 ? '' : 's'} of Endless Orbit. Retry the round or start a new run.`;
    if (!save.endlessBest || save.endlessBest < cleared) save.endlessBest = cleared;
    persistSave();
  }
  $('failed-text').textContent = text;
  announce(`Out of shots — ${level.name} failed. ${state.targetsRemaining} target${state.targetsRemaining === 1 ? '' : 's'} left.`);
  // Failed-screen stats: what this attempt cost, and the best already
  // banked on this level (campaign) or in this mode (challenge).
  const budget = shotBudget(level);
  let statsLine = `Shots used: ${state.shotsUsed} / ${budget} · Par ${level.par}`;
  if (state.mode === 'campaign') {
    const best = save.stars[state.levelId] || 0;
    statsLine += ` · Best on this level: ${'★'.repeat(best)}${'☆'.repeat(3 - best)}`;
  } else if (state.mode === 'endless') {
    statsLine += ` · Endless best: ${save.endlessBest || 0} round${(save.endlessBest || 0) === 1 ? '' : 's'}`;
  } else if (state.mode === 'timeattack') {
    const best = save.timeAttackBest;
    statsLine += ` · Time Attack best: ${best ? `${best.stars}/15 stars in ${formatClock(best.seconds)}` : 'no full clear yet'}`;
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
  // Pending zen respawns belong to the session being left — drop them so
  // a later level never sees a stale target reappear.
  for (const t of zenRespawnTimers) window.clearTimeout(t);
  zenRespawnTimers = [];
  zenGen++;
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
// Zen target respawn (#21): 1.5s after a star is collected it drifts back
// onto the field — mesh and ring visible again, out of the collected list
// so the next shot can take it. The generation token guards against a
// timer from an earlier session firing after a restart or a quit.
function respawnZenTarget(level, idx) {
  const gen = zenGen;
  const timer = window.setTimeout(() => {
    if (gen !== zenGen || state.mode !== 'zen') return;
    const i = state.collected.indexOf(idx);
    if (i !== -1) state.collected.splice(i, 1);
    const mesh = targetMeshes[idx];
    if (mesh) mesh.visible = true;
    const ring = targetRings[idx];
    if (ring) ring.visible = true;
    state.targetsRemaining = level.targets.length - state.collected.length;
    updateHUD();
  }, 1500);
  zenRespawnTimers.push(timer);
}

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
        const pos = targetPosAt(t, levelTime);
        feedback('shieldhit', pos.x, pos.y);
      }
    } else if (ev && ev.type === 'collect') {
      for (const idx of tmpNewly) {
        const mesh = targetMeshes[idx];
        if (mesh) mesh.visible = false;
        const ring = targetRings[idx];
        if (ring) ring.visible = false;
        const t = level.targets[idx];
        const pos = targetPosAt(t, levelTime);
        feedback('collect', pos.x, pos.y);
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
      if (state.mode === 'zen') {
        // Zen: every collected star counts toward the session total, the
        // session best is banked live, and the star drifts back onto the
        // field after a short delay — the flight keeps going, the level
        // never completes, and the next shot can collect it again.
        state.zenCollected += tmpNewly.length;
        if (state.zenCollected > (save.zenBest || 0)) {
          save.zenBest = state.zenCollected;
          persistSave();
        }
        for (const idx of tmpNewly) respawnZenTarget(level, idx);
        updateHUD();
        announce(`Star collected — ${state.zenCollected} in this Zen session.`);
      } else {
        announce(state.targetsRemaining === 0
          ? 'All targets collected.'
          : `Star collected — ${state.targetsRemaining} target${state.targetsRemaining === 1 ? '' : 's'} left.`);
      }
      if (state.mode !== 'zen' && isLevelComplete(level, state.collected)) {
        flightEnding = true;
        scheduleEndShot(700);
        break;
      }
    } else if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout' || ev.type === 'swallowed' || ev.type === 'invalid')) {
      flightEnding = true;
      announce(ev.type === 'crash' ? 'Comet crashed into a planet — shot lost.'
        : ev.type === 'swallowed' ? 'Comet swallowed by a black hole — shot lost.'
        : ev.type === 'timeout' ? 'Comet ran out of steam — shot lost.'
        : 'Comet flew out of bounds — shot lost.');
      if (ev.type === 'crash') {
        feedback('crash', flight.x, flight.y);
        comet.visible = false;
      } else if (ev.type === 'swallowed') {
        feedback('swallowed', flight.x, flight.y);
        comet.visible = false;
      } else {
        // 'lost' and 'timeout' fly out or run out of steam; 'invalid' is
        // a corrupted flight the physics guard ended — same lost-shot
        // feel, no extra drama for a state that should never show.
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
  // Escape closes the how-to, stats and achievements overlays back to
  // the menu.
  if (e.key === 'Escape' && (state.phase === 'howto' || state.phase === 'stats' || state.phase === 'achievements')) {
    if (state.phase === 'howto') $('btn-howto-close').click();
    else if (state.phase === 'stats') $('btn-stats-close').click();
    else $('btn-achievements-close').click();
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
    else if (state.phase === 'achievements') $('btn-achievements-close').click();
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
  // Achievements overlay (Block 16): the menu button opens the list,
  // the close button returns to the menu.
  $('btn-achievements').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    renderAchievements();
    state.phase = 'achievements';
    showOnly('achievements');
  });
  $('btn-achievements-close').addEventListener('click', () => {
    sfx.click();
    state.phase = 'menu';
    showOnly('menu');
  });
  // Reset Progress (Block 16, #48): first click arms the button, the
  // second click within 5s wipes the whole save.
  $('btn-reset-save').addEventListener('click', () => {
    const btn = $('btn-reset-save');
    if (performance.now() < resetArmedUntil) {
      resetArmedUntil = 0;
      btn.textContent = 'Reset Progress';
      sfx.click();
      resetSave();
      return;
    }
    resetArmedUntil = performance.now() + 5000;
    btn.textContent = 'Click again to erase all progress';
    window.setTimeout(() => {
      if (performance.now() >= resetArmedUntil) btn.textContent = 'Reset Progress';
    }, 5100);
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
    else if (state.mode === 'timeattack') nextTimeAttackLevel();
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
  // Time Attack: one 4:00 clock across levels 1-5.
  $('btn-timeattack').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startTimeAttack();
  });
  // Zen Sandbox (#21): free orbit playground, unlimited shots.
  $('btn-zen').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startZen();
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
  // Settings toggles (#44): reduce motion + music, mirrored in the menu
  // and the pause menu — one handler per checkbox, all synced.
  for (const suffix of ['menu', 'pause']) {
    const rm = $(`reduce-motion-${suffix}`);
    if (rm) {
      rm.addEventListener('change', () => {
        settings.reduceMotion = rm.checked;
        persistSettings();
        updateSettingsToggles();
      });
    }
    const mu = $(`music-toggle-${suffix}`);
    if (mu) {
      mu.addEventListener('change', () => {
        ensureAudio();
        setMusic(mu.checked);
      });
    }
  }
  updateSettingsToggles();
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
    // The atmosphere halo rides with its planet (#29).
    const g = planetGlows[i];
    if (g) g.position.set(pos.x, pos.y, 0);
  });
}

// Moving targets drift on their orbits; their meshes (and rings) are
// repositioned every frame so what the player sees matches the physics.
function updateTargetMeshes() {
  const level = levelById(state.levelId);
  if (!level) return;
  level.targets.forEach((t, i) => {
    if (!t.orbit) return;
    const pos = targetPosAt(t, levelTime);
    const m = targetMeshes[i];
    if (m) m.position.set(pos.x, pos.y, 0);
    const ring = targetRings[i];
    if (ring) ring.position.set(pos.x, pos.y, 0);
    const shield = shieldMeshes[i];
    if (shield) shield.position.set(pos.x, pos.y, 0);
  });
}

// ---------------------------------------------------------------- main loop
let lastNow = performance.now();
// FPS guard (#46): a pure frame-time EMA; the level it reports drives the
// renderer's pixel ratio and the particle budget. Applied lazily — only
// when the level actually changes, so a steady game never touches GL state.
const perfGuard = createPerfGuard();
let appliedPerfLevel = 0;
function applyPerfLevel() {
  const level = perfGuard.level;
  if (level === appliedPerfLevel) return;
  appliedPerfLevel = level;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfGuard.pixelRatio()));
  particleScale = perfGuard.particleScale();
  fitCamera();
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;
  // Feed every frame (ms) to the guard; a level change re-applies the
  // renderer pixel ratio and the particle budget for the next frame.
  perfGuard.update(dt * 1000);
  applyPerfLevel();
  const stopped = now < hitStopUntil;
  // Trauma decays with real time, so shake settles even during hit-stop.
  trauma = Math.max(0, trauma - dt * 1.4);
  // Reduce motion (#50) zeroes the shake at the source — the slider still
  // scales it for everyone else.
  const shake = settings.reduceMotion ? 0 : trauma * trauma * settings.shake;
  const t = now / 1000;
  // The nebula shader drifts with real time (#29).
  nebulaUniforms.uTime.value = t;
  cameraRig.position.set(
    shake * 0.9 * Math.sin(t * 47.3),
    shake * 0.9 * Math.sin(t * 39.7 + 1.3),
    0,
  );
  camera.lookAt(0, 0, 0);
  // Predicted-end marker pulses while aiming so the predicted outcome reads.
  // Reduce motion holds it steady — the ring itself still shows the outcome.
  if (previewEndRing.visible) {
    const s = settings.reduceMotion ? 1 : 1 + 0.18 * Math.sin(t * 6);
    previewEndRing.scale.setScalar(s);
  }
  if (!stopped) {
    // Near-miss slow-mo (#31): while the dip is live the whole simulation
    // runs at SLOW_MO_SCALE (0.35x) — flight, particles, planet motion —
    // while trauma decay, the nebula and the Time Attack clock below stay
    // on real time. slowMoScale returns 1 outside the window, under
    // reduce motion, or on a corrupted clock, so this can never stick.
    const sdt = dt * slowMoScale(now, slowMoUntil, settings.reduceMotion);
    updateParticles(sdt);
    updateShockwaves(sdt);
    updateConfetti(sdt);
    const level = levelById(state.levelId);
    if (level) {
      // The level clock runs while aiming; during flight it advances in
      // lockstep with the simulation inside stepFlightLoop.
      if (state.phase === 'aim') {
        levelTime += sdt;
        if (levelHasMovingPlanets(level) || levelHasMovingTargets(level)) {
          previewRefresh += sdt;
          if (previewRefresh >= 0.15) {
            previewRefresh = 0;
            // Re-aim at the same angle/power: the preview and its readout
            // follow the planets (and drifting targets) as they move.
            setAim(state.aimAngle, state.aimPower);
          }
        }
      }
      // The Time Attack clock ticks while aiming or flying (never while
      // paused, complete or failed) and fails the run at zero. It runs on
      // real time — a slow-mo dip must never buy the player extra seconds.
      if (state.mode === 'timeattack' && (state.phase === 'aim' || state.phase === 'fly')) {
        state.timeLeft = Math.max(0, state.timeLeft - dt);
        const sec = Math.ceil(state.timeLeft);
        if (sec !== lastTimerSecond) {
          lastTimerSecond = sec;
          const timerEl = $('hud-timer');
          if (timerEl) timerEl.textContent = `⏱ ${formatClock(state.timeLeft)}`;
        }
        if (state.timeLeft <= 0) failLevel('time');
      }
      updatePlanetMeshes();
      updateTargetMeshes();
      // Black hole accretion discs swirl; photon rings counter-rotate.
      for (const bh of blackHoleMeshes) {
        bh.disc.rotation.z += sdt * 0.9;
        bh.ring.rotation.z -= sdt * 0.4;
      }
      // Portal discs swirl and their rings breathe, so twins read as live.
      for (const portal of portalMeshes) {
        portal.disc.rotation.z += sdt * 1.6;
        const pulse = 1 + 0.06 * Math.sin(t * 3 + portal.group.position.x);
        portal.ring.scale.setScalar(portal.base * pulse);
      }
      // Shield rings turn slowly around their target.
      for (const shield of shieldMeshes) {
        if (shield && shield.visible) shield.rotation.z += sdt * 0.6;
      }
      targetMeshes.forEach((m, i) => {
        if (!m.visible) return;
        const r = level.targets[i].r;
        m.scale.setScalar(r * (1 + 0.12 * Math.sin(now * 0.004 + i * 1.7)));
        m.rotation.y += sdt * 0.8;
        m.rotation.x += sdt * 0.4;
      });
      targetRings.forEach((ring, i) => {
        if (!ring.visible) return;
        ring.rotation.z += sdt * 0.5;
      });
    }
    if (state.phase === 'fly' && flight) {
      stepFlightLoop(sdt);
      if (flight && comet.visible) {
        trailHistory.push([flight.x, flight.y]);
        if (trailHistory.length > TRAIL_MAX) trailHistory.shift();
        updateTrailLine();
        comet.rotation.y += sdt * 3;
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
  playTimeAttack: () => { ensureAudio(); startTimeAttack(); },
  // Zen Sandbox (Block 15, #21): free orbit playground, unlimited shots.
  playZen: () => { ensureAudio(); startZen(); },
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
    timeLeft: state.timeLeft,
    timeAttackStars: state.timeAttackStars,
    timeAttackIndex: state.timeAttackIndex,
    timeAttackBest: save.timeAttackBest ? { ...save.timeAttackBest } : null,
    zenCollected: state.zenCollected,
    zenBest: save.zenBest || 0,
  }),
  info: () => {
    const level = levelById(state.levelId);
    return {
      levelTime,
      blackHoles: level ? levelBlackHoles(level).length : 0,
      movingPlanets: level ? level.planets.filter((p) => p.orbit).length : 0,
      movingTargets: level ? level.targets.filter((t) => t.orbit).length : 0,
      portals: level ? levelPortals(level).length : 0,
      bouncePads: level ? levelBouncePads(level).length : 0,
      shieldedTargets: level ? level.targets.filter((t) => targetHits(t) > 1).length : 0,
      shieldHits: { ...state.shieldHits },
      planetPositions: planetMeshes.map((m) => [m.position.x, m.position.y]),
      targetPositions: targetMeshes.map((m) => [m.position.x, m.position.y]),
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
    peakTrauma,
    hitStopActive: performance.now() < hitStopUntil,
    hitStopToken,
    shockwavesActive: shockwaves.filter((s) => s.life > 0).length,
    particlesAlive: countAliveParticles(),
    slingshotCount,
    portalCount,
    bounceCount,
    shieldHitCount,
    // Near-miss slow-mo (#31): how many dips fired on the current shot,
    // and whether one is live right now (real-time deadline).
    slowMoCount,
    slowMoActive: performance.now() < slowMoUntil,
  }),
  // Visual polish state (Block 12, #28/#29/#30) for the render check:
  // the trail ribbon's live length, the nebula clock, how many planet
  // glow halos are in the scene, and how many confetti shards are flying.
  visualState: () => ({
    trailPoints: trailHistory.length,
    trailRibbonVisible: trailRibbon.visible,
    nebulaTime: nebulaUniforms.uTime.value,
    planetGlows: planetGlows.length,
    confettiActive: countActiveConfetti(),
  }),
  // State audit (Block 11, #47): how many 1s checks ran, how many
  // failures were found, how many recoveries ran, and the last reason.
  auditState: () => ({
    checks: auditChecks,
    failures: auditFailures,
    recoveries: auditRecoveries,
    lastFailure: lastAuditFailure,
  }),
  // FPS guard (Block 14, #46): the frame-time EMA, the current quality
  // level, the pixel ratio and particle scale it applies, and how many
  // times it stepped down or back up this session.
  perfState: () => ({
    emaMs: Math.round(perfGuard.emaMs * 100) / 100,
    level: perfGuard.level,
    appliedLevel: appliedPerfLevel,
    pixelRatio: renderer.getPixelRatio(),
    // The guard's target ratio (2 at level 0); the renderer applies
    // min(devicePixelRatio, target), so on a DPR-1 screen the applied
    // ratio stays 1 while the target still tracks the level.
    targetPixelRatio: perfGuard.pixelRatio(),
    particleScale,
    stepsDown: perfGuard.stepsDown,
    stepsUp: perfGuard.stepsUp,
  }),
  // Test-only frame feeder for the render check: drives the guard with
  // synthetic frame times (ms) so a slow device can be simulated without
  // waiting for real slow frames. Returns the level after the feed.
  testPerf: (dtMs, frames = 1) => {
    let level = perfGuard.level;
    for (let i = 0; i < frames; i++) level = perfGuard.update(dtMs);
    applyPerfLevel();
    return level;
  },
  // Settings state (Block 14, #44/#50) for the render check: the persisted
  // toggles, the last screen-reader announcement, and whether the OS
  // asked for reduced motion on this visit.
  settingsState: () => ({
    reduceMotion: settings.reduceMotion,
    music: settings.music,
    shake: settings.shake,
    lastAnnouncement: (() => { const el = document.getElementById('sr-status'); return el ? el.textContent : ''; })(),
    osReduceMotion: (() => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    })(),
  }),
  // Achievements state (Block 16) for the render check: the unlocked
  // ids, the total, the lifetime stats and the save schema version.
  achievementsState: () => ({
    unlocked: [...(save.achievements || [])],
    total: ACHIEVEMENTS.length,
    stats: { ...(save.stats || defaultStats()) },
    version: save.version,
  }),
  // Test-only corruption hook for the render check: 'flight' NaNs the
  // live flight state (the physics guard must end the shot cleanly),
  // 'time' NaNs the level clock (only the 1s audit can catch it).
  // Returns false when there is nothing to corrupt.
  testCorrupt: (what) => {
    if (what === 'flight' && flight) { flight.x = NaN; return true; }
    if (what === 'time') { levelTime = NaN; return true; }
    return false;
  },
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
// The state audit (Block 11, #47) runs once a second for the whole
// session; it only acts while a level is running.
window.setInterval(runStateAudit, 1000);
requestAnimationFrame(animate);
