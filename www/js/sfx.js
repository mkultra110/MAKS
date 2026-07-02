// Effets sonores procéduraux (WebAudio) — aucun fichier audio requis.
let ctx = null;
let lastHit = 0;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // couvre aussi l'état non standard 'interrupted' d'iOS (appel, Siri…)
  if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume();
  return ctx;
}

// À appeler sur le premier geste utilisateur (obligatoire sur iOS).
export function unlockAudio() { ac(); }

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
  f.type = 'highpass'; f.frequency.value = 1800;
  env(g, c.currentTime, 0.005, 0.07, 0.12);
  n.connect(f).connect(g).connect(c.destination);
  n.start();
}

export function sfxBoom(big = false) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(big ? 160 : 120, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, c.currentTime + (big ? 0.6 : 0.3));
  env(g, c.currentTime, 0.01, big ? 0.6 : 0.3, big ? 0.5 : 0.3);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.8);
  const n = noise(c, 0.4), f = c.createBiquadFilter(), g2 = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 900;
  env(g2, c.currentTime, 0.01, 0.35, big ? 0.4 : 0.2);
  n.connect(f).connect(g2).connect(c.destination);
  n.start();
}

export function sfxLaser() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1400, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(300, c.currentTime + 0.18);
  env(g, c.currentTime, 0.005, 0.18, 0.12);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.25);
}

export function sfxShot() {
  const c = ac(); if (!c) return;
  const n = noise(c, 0.05), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = 2500;
  env(g, c.currentTime, 0.003, 0.05, 0.1);
  n.connect(f).connect(g).connect(c.destination);
  n.start();
}

export function sfxWin() {
  const c = ac(); if (!c) return;
  [523, 659, 784, 1047].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.13;
    env(g, t0, 0.01, 0.25, 0.25);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.4);
  });
}

export function sfxLose() {
  const c = ac(); if (!c) return;
  [400, 330, 260, 180].forEach((freq, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.17;
    env(g, t0, 0.01, 0.28, 0.12);
    o.connect(g).connect(c.destination);
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
  crowdSrc.connect(cf).connect(cg).connect(c.destination);
  crowdSrc.start();
  const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 70;
  const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 240;
  const eg = c.createGain(); eg.gain.value = 0.016;
  eng.connect(ef).connect(eg).connect(c.destination);
  eng.start();
  loops = { crowdSrc, cg, eng, eg };
}
export function setEngineSpeed(v) {
  if (loops) loops.eng.frequency.value = 55 + Math.min(28, Math.abs(v)) * 5;
}
export function crowdExcite(x) {
  if (loops) loops.cg.gain.value = 0.028 + x * 0.05;
}
export function stopBattleAudio() {
  if (!loops) return;
  try { loops.crowdSrc.stop(); loops.eng.stop(); } catch (e) {}
  loops = null;
}

// Bip du compte à rebours (3, 2, 1).
export function sfxCount() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = 660;
  env(g, c.currentTime, 0.005, 0.12, 0.2);
  o.connect(g).connect(c.destination);
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
  o.connect(g).connect(c.destination);
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
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 1.15);
}

// Clang métallique du clash d'armes.
export function sfxClang() {
  const c = ac(); if (!c) return;
  for (const [type, freq] of [['square', 620], ['triangle', 1870]]) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    env(g, c.currentTime, 0.004, 0.18, 0.18);
    o.connect(g).connect(c.destination);
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
    o.connect(g).connect(c.destination);
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
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.35);
  });
}

export function sfxClick() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = 700;
  env(g, c.currentTime, 0.004, 0.06, 0.12);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.1);
}
