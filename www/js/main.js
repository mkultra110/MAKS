// Point d'entrée : navigation entre écrans et déroulé d'une partie.
import { partDef } from './data.js';
import { state, load, buildLoadout, makeOpponent, winRewards, save } from './state.js';
import { buildCarSpec, drawCarStatic, drawPartThumb } from './car.js';
import { initGarage, renderGarage } from './garage.js';
import { startBattle, stopBattle } from './battle.js';
import { unlockAudio, sfxClick, sfxWin, sfxLose } from './sfx.js';

const PLAYER_NAME = 'Toi 🐱';
let pendingOpponent = null;
let pendingQuick = false;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function drawVsCard(canvasId, lo, flip) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,20,.35)';
  ctx.fillRect(0, canvas.height * 0.85, canvas.width, canvas.height * 0.15);
  drawCarStatic(ctx, buildCarSpec(lo), canvas.width / 2, canvas.height * 0.85, 0.62, flip ? -1 : 1);
}

function gotoVs(quick) {
  pendingQuick = quick;
  pendingOpponent = quick
    ? makeOpponent(Math.max(1, state.stage - 1), Math.floor(Math.random() * 3), true)
    : makeOpponent(state.stage, state.stageWins);
  drawVsCard('vs-me', buildLoadout(), false);
  drawVsCard('vs-them', pendingOpponent.loadout, true);
  document.getElementById('vs-me-name').textContent = PLAYER_NAME;
  document.getElementById('vs-them-name').textContent =
    pendingOpponent.name + (quick ? ' (combat rapide)' : ` — Étape ${state.stage}`);
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
  const rewardsEl = document.getElementById('result-rewards');
  const partEl = document.getElementById('reward-part');
  partEl.classList.add('hidden');

  if (result.win) {
    sfxWin();
    const r = winRewards(pendingQuick);
    title.textContent = 'VICTOIRE !';
    title.className = 'result-title win';
    document.getElementById('result-sub').textContent = result.reason;
    rewardsEl.textContent = `+🪙 ${r.coins}`;
    if (r.part) {
      partEl.classList.remove('hidden');
      drawPartThumb(document.getElementById('reward-canvas'), r.part);
      document.getElementById('reward-name').textContent =
        `${partDef(r.part).name} ${'★'.repeat(r.part.stars)} (niv. ${r.part.level})`;
    }
  } else {
    sfxLose();
    title.textContent = 'DÉFAITE';
    title.className = 'result-title lose';
    document.getElementById('result-sub').textContent = result.reason + ' Améliore tes pièces et réessaie !';
    rewardsEl.textContent = '+🪙 5';
    state.coins += 5;
    save();
  }
  show('screen-result');
}

function boot() {
  load();
  initGarage();
  renderGarage();

  document.getElementById('btn-fight').addEventListener('click', () => { sfxClick(); gotoVs(false); });
  document.getElementById('btn-quick').addEventListener('click', () => { sfxClick(); gotoVs(true); });
  document.getElementById('btn-vs-back').addEventListener('click', () => { sfxClick(); show('screen-garage'); });
  document.getElementById('btn-vs-go').addEventListener('click', () => { sfxClick(); launchBattle(); });
  document.getElementById('btn-result-ok').addEventListener('click', () => {
    sfxClick();
    renderGarage();
    show('screen-garage');
  });

  // déblocage audio iOS au premier geste
  window.addEventListener('touchstart', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });

  // redessine l'aperçu quand la fenêtre change
  window.addEventListener('resize', () => {
    if (!document.getElementById('screen-garage').classList.contains('hidden')) renderGarage();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

// utile pour les tests automatisés
window.__MAKS__ = { state, stopBattle };
