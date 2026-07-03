// Effets sonores procéduraux (WebAudio) — aucun fichier audio requis.
let ctx = null;
let lastHit = 0;
let muted = false;
let master = null; // bus master : compresseur + gain, partagé par tous les sons

const rnd = (a, b) => a + Math.random() * (b - a);

// Réglage « Son » : coupe tous les effets (les boucles de combat comprises).
export function setMuted(m) {
  muted = !!m;
  if (muted) { stopBattleAudio(); stopMusic(); }
}
export function isMuted() { return muted; }

function ac() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (!master) {
    // Bus master : évite le clipping quand boom + clang + boucles se cumulent.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    comp.connect(out).connect(ctx.destination);
    master = comp;
  }
  // couvre aussi l'état non standard 'interrupted' d'iOS (appel, Siri…)
  if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume();
  return ctx;
}

// À appeler sur le premier geste utilisateur (obligatoire sur iOS).
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  ac();
}

// Suspend/reprend selon la visibilité de l'app (batterie, politesse).
export function handleVisibility() {
  if (!ctx) return;
  if (document.hidden) ctx.suspend?.();
  else if (ctx.state !== 'closed') ctx.resume?.();
}

function env(g, t0, a, d, peak = 0.3) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function noise(c, dur) {
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

export function sfxHit() {
  const c = ac(); if (!c) return;
  if (c.currentTime - lastHit < 0.06) return; // limite anti-spam
  lastHit = c.currentTime;
  const n = noise(c, 0.08), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'highpass'; f.frequency.value = rnd(1500, 2300);
  env(g, c.currentTime, 0.005, 0.07, rnd(0.09, 0.15));
  n.connect(f).connect(g).connect(master);
  n.start();
}

export function sfxBoom(big = false) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(big ? rnd(148, 175) : rnd(110, 135), c.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, c.currentTime + (big ? 0.6 : 0.3));
  env(g, c.currentTime, 0.01, big ? 0.6 : 0.3, big ? 0.5 : 0.3);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.8);
  const n = noise(c, 0.4), f = c.createBiquadFilter(), g2 = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 900;
  env(g2, c.currentTime, 0.01, 0.35, big ? 0.4 : 0.2);
  n.connect(f).connect(g2).connect(master);
  n.start();
}

export function sfxLaser() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1400, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(300, c.currentTime + 0.18);
  env(g, c.currentTime, 0.005, 0.18, 0.12);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.25);
}

export function sfxShot() {
  const c = ac(); if (!c) return;
  const n = noise(c, 0.05), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = rnd(2100, 3100);
  env(g, c.currentTime, 0.003, 0.05, 0.1);
  n.connect(f).connect(g).connect(master);
  n.start();
}

// Whoosh grave de lancement de roquette (distinct de sfxShot).
export function sfxRocket() {
  const c = ac(); if (!c) return;
  const n = noise(c, 0.25), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(400, c.currentTime);
  f.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.25);
  env(g, c.currentTime, 0.02, 0.22, 0.2);
  n.connect(f).connect(g).connect(master);
  n.start();
}

// Refus (pas assez de pièces, action bloquée) : deux blips descendants.
export function sfxDenied() {
  const c = ac(); if (!c) return;
  [180, 140].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.09;
    env(g, t0, 0.005, 0.08, 0.1);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.14);
  });
}

// Tick très court et discret pour les compteurs de pièces.
export function sfxTick() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = 1200;
  env(g, c.currentTime, 0.003, 0.027, 0.06);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.05);
}

export function sfxWin() {
  const c = ac(); if (!c) return;
  duckMusic(1.2);
  [523, 659, 784, 1047].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.13;
    env(g, t0, 0.01, 0.25, 0.25);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.4);
  });
}

export function sfxLose() {
  const c = ac(); if (!c) return;
  duckMusic(1.2);
  [400, 330, 260, 180].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.17;
    env(g, t0, 0.01, 0.28, 0.12);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.45);
  });
}

// ---- Boucles continues du combat : rumeur de foule + ronron moteur ----
let loops = null;
export function startBattleAudio() {
  const c = ac(); if (!c || loops) return;
  const crowdSrc = noise(c, 2.5);
  crowdSrc.loop = true;
  const cf = c.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 420;
  const cg = c.createGain(); cg.gain.value = 0.028;
  crowdSrc.connect(cf).connect(cg).connect(master);
  crowdSrc.start();
  // Drone moteur épaissi : deux sawtooth légèrement désaccordés + LFO lent.
  const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 240;
  const eg = c.createGain(); eg.gain.value = 0.016;
  const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 70;
  eng.connect(ef);
  const eng2 = c.createOscillator(); eng2.type = 'sawtooth';
  eng2.frequency.value = 70; eng2.detune.value = 12;
  const e2g = c.createGain(); e2g.gain.value = 0.5; // mixé à 50 %
  eng2.connect(e2g).connect(ef);
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 11;
  const lfoG = c.createGain(); lfoG.gain.value = 5;
  lfo.connect(lfoG); lfoG.connect(eng.frequency); lfoG.connect(eng2.frequency);
  ef.connect(eg).connect(master);
  eng.start(); eng2.start(); lfo.start();
  loops = { c, crowdSrc, cg, eng, eng2, lfo, eg };
}
export function setEngineSpeed(v) {
  if (!loops) return;
  // setTargetAtTime évite le zipper noise des écritures directes chaque frame
  const c = loops.c, f = 55 + Math.min(28, Math.abs(v)) * 5;
  loops.eng.frequency.setTargetAtTime(f, c.currentTime, 0.06);
  loops.eng2.frequency.setTargetAtTime(f, c.currentTime, 0.06);
}
export function crowdExcite(x) {
  if (!loops) return;
  loops.cg.gain.setTargetAtTime(0.028 + x * 0.05, loops.c.currentTime, 0.15);
}
export function stopBattleAudio() {
  if (!loops) return;
  try { loops.crowdSrc.stop(); loops.eng.stop(); loops.eng2.stop(); loops.lfo.stop(); } catch (e) {}
  loops = null;
}

// ---- Musique procédurale : mini-séquenceur lookahead sur le bus master ----
// Gains volontairement très bas : la musique doit rester SOUS les SFX.
let music = null;
const PENTA = [220, 262, 294, 330, 392]; // La mineur pentatonique
// Deux motifs mélodiques alternés par mesure (index dans PENTA, -1 = silence).
const MOTIFS = [
  [0, -1, 2, -1, 1, -1, -1, 3, -1, 2, -1, 1, -1, -1, 0, -1],
  [4, -1, 3, -1, 2, -1, -1, 1, -1, 2, -1, 3, -1, -1, 2, -1],
];
// Basse du menu : une note par mesure (La, Do, La, Sol).
const MENU_BASS = [110, 131, 110, 98];

// Note planifiée à t sur le sous-bus musique.
function mNote(c, dest, type, freq, t, a, d, peak) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  env(g, t, a, d, peak);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + a + d + 0.05);
}

// Shaker : souffle très court sur les contretemps.
function mShaker(c, dest, t) {
  const n = noise(c, 0.03), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'highpass'; f.frequency.value = 6000;
  env(g, t, 0.003, 0.025, 0.03);
  n.connect(f).connect(g).connect(dest);
  n.start(t);
}

// Kick : sine descendante, ponctue la boucle de combat.
function mKick(c, dest, t) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  env(g, t, 0.005, 0.11, 0.3);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + 0.18);
}

function scheduleMenuStep(c, m, step, t) {
  if (step % 4 === 0) mNote(c, m.gain, 'triangle', MENU_BASS[m.bar % 4], t, 0.01, 0.22, 0.06);
  const mi = MOTIFS[m.bar % 2][step];
  if (mi >= 0) mNote(c, m.gain, 'triangle', PENTA[mi] * 2, t, 0.01, 0.18, 0.045);
  if (step % 4 === 2) mShaker(c, m.gain, t);
}

function scheduleBattleStep(c, m, step, t) {
  if (step % 4 === 0) mKick(c, m.gain, t);
  if (step % 2 === 0) mNote(c, m.gain, 'square', 110, t, 0.005, 0.07, 0.05);
  const mi = MOTIFS[m.bar % 2][step];
  if (mi >= 0 && step % 4 !== 0) mNote(c, m.gain, 'square', PENTA[mi], t, 0.005, 0.1, 0.03);
}

// Tick du séquenceur : planifie les pas jusqu'à currentTime + 0.1 s.
function musicTick() {
  const m = music; if (!m) return;
  const c = m.c;
  if (c.state !== 'running') return;
  // rattrapage après une suspension : on repart d'un temps proche
  if (m.nextTime < c.currentTime - 0.2) m.nextTime = c.currentTime + 0.05;
  while (m.nextTime < c.currentTime + 0.1) {
    if (m.mode === 'battle') scheduleBattleStep(c, m, m.step, m.nextTime);
    else scheduleMenuStep(c, m, m.step, m.nextTime);
    m.nextTime += m.stepDur;
    m.step++;
    if (m.step >= 16) { m.step = 0; m.bar++; }
  }
}

// Démarre la boucle 'menu' (~90 BPM, doux) ou 'battle' (132 BPM, martelé).
export function startMusic(mode) {
  const c = ac(); if (!c) return;
  if (music && music.mode === mode) return;
  stopMusic();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.setTargetAtTime(1, c.currentTime, 0.12); // fade-in
  g.connect(master);
  music = {
    mode, c, gain: g,
    step: 0, bar: 0,
    stepDur: mode === 'battle' ? 60 / 132 / 4 : 60 / 90 / 4,
    nextTime: c.currentTime + 0.05,
    timer: setInterval(musicTick, 25),
  };
}

// Arrête la musique avec un fade de ~0.3 s.
export function stopMusic() {
  const m = music; if (!m) return;
  music = null;
  clearInterval(m.timer);
  try {
    m.gain.gain.setTargetAtTime(0.0001, m.c.currentTime, 0.08);
  } catch (e) {}
  setTimeout(() => { try { m.gain.disconnect(); } catch (e) {} }, 500);
}

// Baisse temporairement la musique (jingles de fin de combat).
function duckMusic(dur) {
  const m = music; if (!m) return;
  m.gain.gain.setTargetAtTime(0.4, m.c.currentTime, 0.05);
  m.gain.gain.setTargetAtTime(1, m.c.currentTime + dur, 0.3);
}

// Bip du compte à rebours (3, 2, 1).
export function sfxCount() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = 660;
  env(g, c.currentTime, 0.005, 0.12, 0.2);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.18);
}

// « MIAOU ! » de départ : bip montant.
export function sfxGo() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(990, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(1320, c.currentTime + 0.12);
  env(g, c.currentTime, 0.005, 0.3, 0.28);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.4);
}

// Sirène des murs de la mort.
export function sfxSiren() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sawtooth';
  for (let i = 0; i < 3; i++) {
    o.frequency.setValueAtTime(420, c.currentTime + i * 0.36);
    o.frequency.linearRampToValueAtTime(720, c.currentTime + i * 0.36 + 0.18);
    o.frequency.linearRampToValueAtTime(420, c.currentTime + (i + 1) * 0.36);
  }
  env(g, c.currentTime, 0.02, 1.05, 0.12);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 1.15);
}

// Clang métallique du clash d'armes.
export function sfxClang() {
  const c = ac(); if (!c) return;
  const k = rnd(0.94, 1.06); // un seul facteur pour garder l'accord des deux voix
  for (const [type, freq] of [['square', 620], ['triangle', 1870]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq * k;
    env(g, c.currentTime, 0.004, 0.18, 0.18);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.25);
  }
}

// Médaille gagnée : double carillon.
export function sfxMedal() {
  const c = ac(); if (!c) return;
  [880, 1320].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.11;
    env(g, t0, 0.005, 0.3, 0.22);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.45);
  });
}

// Promotion : fanfare courte.
export function sfxPromote() {
  const c = ac(); if (!c) return;
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.11;
    env(g, t0, 0.008, 0.22, 0.09);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.35);
  });
}

// Miaou cartoon de la mascotte : sweep montant puis retombant, léger vibrato.
export function sfxMeow() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'sawtooth';
  const t0 = c.currentTime;
  o.frequency.setValueAtTime(520, t0);
  o.frequency.exponentialRampToValueAtTime(940, t0 + 0.12);
  o.frequency.exponentialRampToValueAtTime(430, t0 + 0.34);
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.6;
  env(g, t0, 0.02, 0.32, 0.22);
  o.connect(f).connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.42);
}

// Achat en boutique : deux blips « pièces » brillants.
export function sfxBuy() {
  const c = ac(); if (!c) return;
  [1050, 1580].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.07;
    env(g, t0, 0.004, 0.12, 0.18);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.2);
  });
}

export function sfxClick() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = rnd(640, 780);
  env(g, c.currentTime, 0.004, 0.06, 0.12);
  o.connect(g).connect(master);
  o.start(); o.stop(c.currentTime + 0.1);
}
