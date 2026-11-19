// Neon Orbit — Three.js 3D gravity-slingshot puzzle (v0.2.0).
// Drag back from the comet to aim, release to launch. Planets bend the
// flight with gravity; collect every magenta target before shots run out.
import * as THREE from 'three';
import {
  LEVELS, PLAYFIELD_RADIUS, SUBSTEP,
  levelById, shotBudget, starsForShots, starThresholds, isLevelComplete,
  generateDecor, launchState, stepFlight, previewShot,
  defaultSave, serializeSave, parseSave, totalStars,
} from './physics.js';

export const VERSION = '0.2.0';
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
const state = {
  version: VERSION,
  phase: 'menu', // menu | howto | aim | fly | complete | failed | paused
  levelId: 1,
  levelName: '',
  shotsUsed: 0,
  shotsLeft: 0,
  targetsRemaining: 0,
  collected: [],
  aimAngle: 0,
  aimPower: 0.6,
  fineAim: false,
  previewOutcome: 'none', // collect | crash | lost | none (predicted shot end)
  previewEnd: null, // { x, y } predicted end of the previewed shot
  stars: 0,
  unlocked: 1,
  phaseBeforePause: 'aim',
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
      shake: typeof raw.shake === 'number' ? Math.max(0, Math.min(1, raw.shake)) : 1,
    };
  } catch {
    return { muted: false, shake: 1 };
  }
}
function persistSettings() {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

let save = loadSave();
let settings = loadSettings();
state.unlocked = save.unlocked;

// ---------------------------------------------------------------- audio
let audioCtx = null;
let masterGain = null;
let musicTimer = null;
let musicStep = 0;
let nextNoteTime = 0;
const MUSIC_ROOTS = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = settings.muted ? 0 : 0.6;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function toneAt(freq, at, dur, type, vol, slideTo) {
  if (!audioCtx || !masterGain) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function tone(freq, dur, type, vol, slideTo, delay) {
  if (!audioCtx) return;
  toneAt(freq, audioCtx.currentTime + (delay || 0), dur, type, vol, slideTo || null);
}

function noiseBurst(dur, vol, cutoff) {
  if (!audioCtx || !masterGain) return;
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
  g.connect(masterGain);
  src.start();
}

const sfx = {
  click() { tone(660, 0.06, 'square', 0.05); },
  launch() {
    tone(180, 0.3, 'sawtooth', 0.1, 720);
    noiseBurst(0.25, 0.07, 1200);
  },
  collect() {
    tone(880, 0.12, 'sine', 0.16);
    tone(1318, 0.18, 'sine', 0.16, null, 0.07);
  },
  crash() {
    tone(90, 0.35, 'sine', 0.28, 40);
    noiseBurst(0.3, 0.22, 500);
  },
  lost() { tone(320, 0.4, 'sine', 0.1, 140); },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'sine', 0.15, null, i * 0.09));
  },
};

function scheduleMusicStep(step, at) {
  const bar = Math.floor(step / 8) % MUSIC_ROOTS.length;
  const root = MUSIC_ROOTS[bar];
  if (step % 2 === 0) toneAt(root, at, 0.5, 'triangle', 0.045);
  if (step % 8 === 4) toneAt(root * 2, at, 0.4, 'sine', 0.035);
  if (step % 16 === 14) toneAt(880, at, 0.3, 'sine', 0.022);
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
  if (masterGain) masterGain.gain.value = settings.muted ? 0 : 0.6;
  updateMuteLabels();
}

function updateMuteLabels() {
  const label = settings.muted ? 'Sound: Off' : 'Sound: On';
  for (const id of ['btn-mute-menu', 'btn-mute-hud', 'btn-mute-pause']) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
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
let targetMeshes = [];
let targetRings = [];

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

// ---------------------------------------------------------------- feedback
// Trauma shake: shake = trauma^2, decays in real time (keeps settling during hit-stop).
let trauma = 0;
let hitStopUntil = 0;

function addTrauma(amount) {
  trauma = Math.min(1, trauma + amount);
}
function hitStop(seconds) {
  hitStopUntil = performance.now() + seconds * 1000;
}

// One funnel for every game-feel event, so responses stay proportional.
function feedback(kind, x, y) {
  if (kind === 'launch') { addTrauma(0.12); sfx.launch(); }
  else if (kind === 'collect') {
    addTrauma(0.18);
    sfx.collect();
    spawnBurst(x, y, 0, 0xff2d95, 26, 7, 0.7);
  } else if (kind === 'crash') {
    addTrauma(0.85);
    hitStop(0.12);
    sfx.crash();
    spawnBurst(x, y, 0, 0xff6b35, 40, 9, 0.9);
  } else if (kind === 'lost') {
    addTrauma(0.15);
    sfx.lost();
    spawnBurst(x, y, 0, 0x22d3ee, 16, 5, 0.6);
  } else if (kind === 'win') {
    addTrauma(0.3);
    sfx.win();
  }
}

// ---------------------------------------------------------------- DOM helpers
const $ = (id) => document.getElementById(id);
const OVERLAYS = ['menu', 'howto', 'complete', 'failed', 'pause'];

function showOverlay(id) {
  for (const o of OVERLAYS) $(o).classList.toggle('hidden', o !== id);
  if (!id) for (const o of OVERLAYS) $(o).classList.add('hidden');
}
function showOnly(id) {
  if (id) showOverlay(id);
  else showOverlay(null);
}

function updateHUD() {
  const level = levelById(state.levelId);
  const budget = level ? shotBudget(level) : 0;
  $('hud-level').textContent = level ? `Level ${level.id} — ${level.name}` : '';
  const best = save.stars[state.levelId] || 0;
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
  for (const level of LEVELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-btn';
    const locked = level.id > save.unlocked;
    const stars = save.stars[level.id] || 0;
    btn.disabled = locked;
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
    btn.addEventListener('click', () => {
      ensureAudio();
      sfx.click();
      startLevel(level.id);
    });
    wrap.appendChild(btn);
  }
  $('total-stars').textContent = String(totalStars(save));
}

// ---------------------------------------------------------------- level flow
function buildLevelMeshes(level) {
  while (levelGroup.children.length) levelGroup.remove(levelGroup.children[0]);
  planetMeshes = [];
  targetMeshes = [];
  targetRings = [];
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
  const sim = previewShot(level, state.aimAngle, state.aimPower, state.collected);
  const outcome = sim.outcome === 'collected' || sim.outcome === 'partial' ? 'collect'
    : sim.outcome === 'crash' ? 'crash'
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
const tmpNewly = [];

function startLevel(id) {
  const level = levelById(id);
  if (!level || id > save.unlocked) return;
  window.clearTimeout(shotTimer);
  state.levelId = id;
  state.levelName = level.name;
  state.shotsUsed = 0;
  state.collected = [];
  state.stars = save.stars[id] || 0;
  state.targetsRemaining = level.targets.length;
  flight = null;
  flightEnding = false;
  buildLevelMeshes(level);
  resetCometToPad();
  state.phase = 'aim';
  state.shotsLeft = shotBudget(level);
  setAim(defaultAimAngle(level, []), 0.6);
  updateHUD();
  $('hud').classList.remove('hidden');
  showOnly(null);
  ensureAudio();
  startMusic();
}

function launch() {
  if (state.phase !== 'aim' || flightEnding) return;
  const level = levelById(state.levelId);
  flight = launchState(level, state.aimAngle, state.aimPower);
  flightAcc = 0;
  flightEnding = false;
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
}

function completeLevel() {
  const level = levelById(state.levelId);
  const stars = starsForShots(state.shotsUsed, level.par);
  state.stars = stars;
  if (!save.stars[state.levelId] || save.stars[state.levelId] < stars) {
    save.stars[state.levelId] = stars;
  }
  if (state.levelId < LEVELS.length && save.unlocked <= state.levelId) {
    save.unlocked = state.levelId + 1;
  }
  state.unlocked = save.unlocked;
  persistSave();
  state.phase = 'complete';
  state.targetsRemaining = 0;
  feedback('win', 0, 0);
  for (const t of level.targets) spawnBurst(t.x, t.y, 0, 0xffd166, 30, 8, 1.0);
  $('complete-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('complete-shots').textContent =
    `Finished in ${state.shotsUsed} shot${state.shotsUsed === 1 ? '' : 's'} (par ${level.par})`;
  $('btn-next').classList.toggle('hidden', state.levelId >= LEVELS.length);
  updateHUD();
  renderLevelSelect();
  showOnly('complete');
}

function failLevel() {
  const level = levelById(state.levelId);
  state.phase = 'failed';
  $('failed-text').textContent =
    `${level.name}: out of shots with ${state.targetsRemaining} target${state.targetsRemaining === 1 ? '' : 's'} left. Try a different arc.`;
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
    tmpNewly.length = 0;
    const level = levelById(state.levelId);
    const ev = stepFlight(flight, level, SUBSTEP, state.collected, tmpNewly);
    comet.position.set(flight.x, flight.y, 0);
    if (ev && ev.type === 'collect') {
      for (const idx of tmpNewly) {
        const mesh = targetMeshes[idx];
        if (mesh) mesh.visible = false;
        const ring = targetRings[idx];
        if (ring) ring.visible = false;
        const t = level.targets[idx];
        feedback('collect', t.x, t.y);
      }
      state.targetsRemaining = level.targets.length - state.collected.length;
      updateHUD();
      if (isLevelComplete(level, state.collected)) {
        flightEnding = true;
        scheduleEndShot(700);
        break;
      }
    } else if (ev && (ev.type === 'crash' || ev.type === 'lost' || ev.type === 'timeout')) {
      flightEnding = true;
      if (ev.type === 'crash') {
        feedback('crash', flight.x, flight.y);
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
let lastDragDist = 0; // world units pulled; a plain click must not launch
let dragStartDist = 0; // pull distance when the drag began (fine-aim anchor)

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
  dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
  const level = levelById(state.levelId);
  const p = worldFromEvent(e);
  dragStartDist = p ? Math.hypot(p.x - level.pad.x, p.y - level.pad.y) : 0;
  aimFromPointer(e);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || state.phase !== 'aim') return;
  aimFromPointer(e);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  state.fineAim = false;
  if (state.phase !== 'aim') return;
  aimFromPointer(e);
  if (lastDragDist >= 1.5 && state.aimPower >= 0.08) launch();
});
renderer.domElement.addEventListener('pointercancel', () => { dragging = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (state.phase === 'paused') resumeGame();
    else pauseGame();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (state.phase === 'aim' || state.phase === 'fly' || state.phase === 'complete' || state.phase === 'failed') {
      ensureAudio();
      startLevel(state.levelId);
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
  $('btn-howto-close').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    save.seenHowTo = true;
    persistSave();
    state.phase = 'menu';
    showOnly('menu');
  });
  $('btn-next').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    if (state.levelId < LEVELS.length) startLevel(state.levelId + 1);
    else quitToMenu();
  });
  $('btn-replay').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startLevel(state.levelId);
  });
  $('btn-menu-complete').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-retry').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startLevel(state.levelId);
  });
  $('btn-menu-failed').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-resume').addEventListener('click', () => { sfx.click(); resumeGame(); });
  $('btn-restart').addEventListener('click', () => {
    ensureAudio();
    sfx.click();
    startLevel(state.levelId);
  });
  $('btn-quit').addEventListener('click', () => { sfx.click(); quitToMenu(); });
  $('btn-pause').addEventListener('click', () => { sfx.click(); pauseGame(); });
  $('btn-mute-menu').addEventListener('click', () => { ensureAudio(); toggleMute(); });
  $('btn-mute-hud').addEventListener('click', () => { ensureAudio(); toggleMute(); });
  $('btn-mute-pause').addEventListener('click', () => { ensureAudio(); toggleMute(); });
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
  const z = Math.max(need / halfFovTan, need / (halfFovTan * aspect));
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
    const level = levelById(state.levelId);
    if (level) {
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
  newGame: () => {
    save = defaultSave();
    persistSave();
    state.unlocked = save.unlocked;
    renderLevelSelect();
    startLevel(1);
  },
};

// ---------------------------------------------------------------- init
document.querySelector('.version').textContent = `v${VERSION} · Three.js ${THREE_VERSION}`;
fitCamera();
wireButtons();
updateMuteLabels();
renderLevelSelect();
if (!save.seenHowTo) {
  state.phase = 'howto';
  showOnly('howto');
} else {
  showOnly('menu');
}
requestAnimationFrame(animate);
