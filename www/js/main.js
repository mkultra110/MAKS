// Point d'entrée : navigation entre écrans et déroulé d'une partie.
import * as THREE from 'three';
import { partDef } from './data.js';
import { state, load, buildLoadout, computeCarStats, makeOpponent, winRewards, save } from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene } from './render3d.js';
import { createCarModel, poseCarStatic } from './models3d.js';
import { carSnapshot, partThumb } from './thumbs.js';
import { initGarage, renderGarage, startPreview, stopPreview } from './garage.js';
import { startBattle } from './battle.js';
import { unlockAudio, sfxClick, sfxWin, sfxLose } from './sfx.js';

const PLAYER_NAME = 'Toi';
let pendingOpponent = null;
let pendingQuick = false;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'screen-garage') startPreview();
  else stopPreview();
  if (id !== 'screen-splash') stopSplash();
}

// ---------- écran d'accueil : vitrine 3D ----------
let splash = null;
function startSplash() {
  const canvas = document.getElementById('splash-canvas');
  const renderer = createRenderer(canvas);
  const scene = createStudioScene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const holder = new THREE.Group();
  scene.add(holder);
  const lo = buildLoadout();
  if (lo.body) {
    const model = createCarModel(buildCarSpec(lo));
    poseCarStatic(model, 1);
    holder.add(model);
  }
  splash = { renderer, scene, camera, holder, raf: 0, running: true };
  const loop = now => {
    if (!splash || !splash.running) return;
    splash.raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    holder.rotation.y = now / 3800;
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(4.8 / (2 * Math.tan(hFov / 2)), 6);
    camera.position.set(Math.sin(now / 9000) * 1.4, 2.1 + Math.sin(now / 5200) * 0.3, dist);
    camera.lookAt(0, 1.0, 0);
    renderer.render(scene, camera);
  };
  splash.raf = requestAnimationFrame(loop);
}
function stopSplash() {
  if (!splash) return;
  splash.running = false;
  cancelAnimationFrame(splash.raf);
}

// ---------- confettis de victoire ----------
function confetti() {
  const canvas = document.getElementById('confetti-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  const colors = ['#ffc93e', '#ff5d7a', '#4fd7ff', '#4de08a', '#8f7bff', '#fff'];
  const parts = [];
  for (let i = 0; i < 130; i++) {
    parts.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 90 * dpr,
      vy: (140 + Math.random() * 200) * dpr,
      w: (4 + Math.random() * 6) * dpr,
      h: (6 + Math.random() * 8) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 8,
      color: colors[i % colors.length],
    });
  }
  let last = performance.now();
  let elapsed = 0;
  const loop = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (elapsed > 4 || document.getElementById('screen-result').classList.contains('hidden')) return;
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.2 - elapsed));
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + Math.abs(Math.sin(p.rot * 2)) * 0.6));
      ctx.restore();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Compteur animé de pièces gagnées.
function countUp(el, target) {
  const t0 = performance.now();
  const dur = 700;
  const loop = now => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = '+' + Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- déroulé d'une partie ----------
function statLine(lo, boost = 1) {
  const s = computeCarStats(lo);
  return `PV ${Math.round(s.hp * boost)} · ATQ ${Math.round(s.atk * boost)}`;
}

function gotoVs(quick) {
  pendingQuick = quick;
  pendingOpponent = quick
    ? makeOpponent(Math.max(1, state.stage - 1), Math.floor(Math.random() * 3), true)
    : makeOpponent(state.stage, state.stageWins);
  const lo = buildLoadout();
  document.getElementById('vs-me').src = carSnapshot(lo, { dir: 1 });
  document.getElementById('vs-them').src = carSnapshot(pendingOpponent.loadout, { dir: -1 });
  document.getElementById('vs-me-name').textContent = PLAYER_NAME;
  document.getElementById('vs-me-stats').textContent = statLine(lo);
  document.getElementById('vs-them-name').textContent =
    pendingOpponent.name + (quick ? '' : ` · Étape ${state.stage}`);
  document.getElementById('vs-them-stats').textContent = statLine(pendingOpponent.loadout, pendingOpponent.statBoost);
  show('screen-vs');
}

function launchBattle() {
  show('screen-battle');
  document.getElementById('hud-name-l').textContent = PLAYER_NAME;
  document.getElementById('hud-name-r').textContent = pendingOpponent.name;
  document.getElementById('battle-msg').classList.add('hidden');
  startBattle({
    playerLoadout: buildLoadout(),
    playerName: PLAYER_NAME,
    opponent: pendingOpponent,
    onEnd: onBattleEnd,
  });
}

function onBattleEnd(result) {
  const title = document.getElementById('result-title');
  const partEl = document.getElementById('reward-part');
  partEl.classList.add('hidden');

  if (result.win) {
    sfxWin();
    const r = winRewards(pendingQuick);
    title.textContent = 'VICTOIRE !';
    title.className = 'result-title win';
    document.getElementById('result-sub').textContent = result.reason;
    countUp(document.getElementById('reward-coins'), r.coins);
    if (r.part) {
      partEl.classList.remove('hidden');
      document.getElementById('reward-img').src = partThumb(r.part);
      document.getElementById('reward-name').textContent =
        `${partDef(r.part).name} ${'★'.repeat(r.part.stars)} · niv. ${r.part.level}`;
    }
    show('screen-result');
    confetti();
  } else {
    sfxLose();
    title.textContent = 'DÉFAITE';
    title.className = 'result-title lose';
    document.getElementById('result-sub').textContent = result.reason + ' Améliore tes pièces et réessaie !';
    document.getElementById('reward-coins').textContent = '+5';
    state.coins += 5;
    save();
    show('screen-result');
  }
}

function boot() {
  load();
  initGarage();
  startSplash();

  document.getElementById('btn-play').addEventListener('click', () => {
    sfxClick();
    renderGarage();
    show('screen-garage');
  });
  document.getElementById('btn-fight').addEventListener('click', () => { sfxClick(); gotoVs(false); });
  document.getElementById('btn-quick').addEventListener('click', () => { sfxClick(); gotoVs(true); });
  document.getElementById('btn-vs-back').addEventListener('click', () => { sfxClick(); renderGarage(); show('screen-garage'); });
  document.getElementById('btn-vs-go').addEventListener('click', () => { sfxClick(); launchBattle(); });
  document.getElementById('btn-result-ok').addEventListener('click', () => {
    sfxClick();
    renderGarage();
    show('screen-garage');
  });

  window.addEventListener('touchstart', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

// utile pour les tests automatisés et la génération d'icônes
window.__MAKS__ = { state, carSnapshot, buildLoadout };
