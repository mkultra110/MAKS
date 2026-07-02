// Effets sonores procéduraux (WebAudio) — aucun fichier audio requis.
let ctx = null;
let lastHit = 0;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// À appeler sur le premier geste utilisateur (obligatoire sur iOS).
export function unlockAudio() { ac(); }

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

export function sfxClick() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = 700;
  env(g, c.currentTime, 0.004, 0.06, 0.12);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.1);
}
