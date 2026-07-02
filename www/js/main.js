// Point d'entrée : navigation entre écrans et déroulé d'une partie.
import * as THREE from 'three';
import { partDef, LEAGUES, leagueIndex } from './data.js';
import {
  state, load, buildLoadout, computeCarStats, makeOpponent, makeRoster,
  winRewards, save, ROSTER_SIZE, MEDALS_TO_ADVANCE,
} from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene } from './render3d.js';
import { createCarModel, poseCarStatic } from './models3d.js';
import { carSnapshot, partThumb, avatarThumb } from './thumbs.js';
import { initGarage, renderGarage, startPreview, stopPreview } from './garage.js';
import { startBattle } from './battle.js';
import { unlockAudio, sfxClick, sfxWin, sfxLose } from './sfx.js';

const PLAYER_NAME = 'Toi';
let pendingOpponent = null;
let pendingQuick = false;
let gauntlet = null; // { fought, coins } quand le Grand Combat est en cours

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

function statLine(lo, boost = 1) {
  const s = computeCarStats(lo);
  return `PV ${Math.round(s.hp * boost)} · ATQ ${Math.round(s.atk * boost)}`;
}

// ---------- championnat : le groupe des 14 joueurs ----------
function renderRoster() {
  const li = leagueIndex(state.stage);
  document.getElementById('roster-title').textContent = `Étape ${state.stage} — Ligue ${LEAGUES[li].name}`;
  document.getElementById('roster-sub').textContent =
    `Prends ${MEDALS_TO_ADVANCE} médailles sur ${ROSTER_SIZE} pour être promu !`;
  document.getElementById('roster-medals').textContent = `${state.medals.length}/${MEDALS_TO_ADVANCE}`;
  document.getElementById('roster-fill').style.width = (state.medals.length / MEDALS_TO_ADVANCE * 100) + '%';

  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  const roster = makeRoster(state.stage);
  for (const opp of roster) {
    const beaten = state.medals.includes(opp.idx);
    const el = document.createElement('div');
    el.className = 'roster-card' + (beaten ? ' beaten' : '');
    const img = document.createElement('img');
    img.src = avatarThumb(opp.avatar);
    el.appendChild(img);
    const info = document.createElement('div');
    info.style.minWidth = '0';
    const nm = document.createElement('div');
    nm.className = 'rc-name';
    nm.textContent = opp.name;
    info.appendChild(nm);
    const st = document.createElement('div');
    st.className = 'rc-stats';
    st.textContent = statLine(opp.loadout, opp.statBoost);
    info.appendChild(st);
    el.appendChild(info);
    if (!beaten) {
      const medal = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      medal.setAttribute('class', 'rc-medal');
      medal.innerHTML = '<use href="#i-medal"/>';
      el.appendChild(medal);
      el.addEventListener('click', () => { sfxClick(); gotoVs(false, opp); });
    }
    list.appendChild(el);
  }
  const unbeaten = roster.filter(o => !state.medals.includes(o.idx));
  document.getElementById('btn-gauntlet').disabled = unbeaten.length === 0;
}

function nextUnbeaten() {
  return makeRoster(state.stage).find(o => !state.medals.includes(o.idx)) || null;
}

// ---------- déroulé d'une partie ----------
function gotoVs(quick, opponent = null) {
  pendingQuick = quick;
  pendingOpponent = opponent || makeOpponent(Math.max(1, state.stage - 1), Math.floor(Math.random() * ROSTER_SIZE), true);
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
    opponent: pendingOpponent,
    copilot: state.copilot,
    onEnd: onBattleEnd,
  });
}

function onBattleEnd(result) {
  const title = document.getElementById('result-title');
  const partEl = document.getElementById('reward-part');
  const leagueEl = document.getElementById('result-league');
  partEl.classList.add('hidden');
  leagueEl.classList.add('hidden');

  if (result.win) {
    const r = winRewards(pendingQuick, pendingOpponent.idx);
    // Grand Combat : on enchaîne tant qu'on n'est pas promu (ou plus d'adversaires)
    if (gauntlet && !r.promoted) {
      gauntlet.fought++;
      gauntlet.coins += r.coins;
      gauntlet.leagueUp = gauntlet.leagueUp || r.leagueUp;
      const next = nextUnbeaten();
      if (next) {
        pendingOpponent = next;
        launchBattle();
        return;
      }
    }
    sfxWin();
    title.textContent = r.promoted ? 'PROMU !' : 'VICTOIRE !';
    title.className = 'result-title win';
    const bits = [result.reason];
    if (r.medal) bits.push('Médaille gagnée !');
    if (r.promoted) bits.push(`Bienvenue à l'étape ${state.stage} !`);
    document.getElementById('result-sub').textContent = bits.join(' ');
    const leagueUp = r.leagueUp || (gauntlet && gauntlet.leagueUp);
    if (leagueUp) {
      leagueEl.textContent = `NOUVELLE LIGUE : ${leagueUp.name.toUpperCase()} ! +${leagueUp.bonus} pièces`;
      leagueEl.classList.remove('hidden');
    }
    const totalCoins = r.coins + (gauntlet ? gauntlet.coins : 0);
    countUp(document.getElementById('reward-coins'), totalCoins);
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
    let sub = result.reason + ' Améliore tes pièces et réessaie !';
    let coins = 5;
    if (gauntlet) {
      sub = `${result.reason} Série du Grand Combat terminée : ${gauntlet.fought} victoire${gauntlet.fought > 1 ? 's' : ''}.`;
      coins += gauntlet.coins;
    }
    document.getElementById('result-sub').textContent = sub;
    document.getElementById('reward-coins').textContent = '+' + coins;
    state.coins += 5;
    save();
    show('screen-result');
  }
  gauntlet = null;
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
  document.getElementById('btn-fight').addEventListener('click', () => {
    sfxClick();
    renderRoster();
    show('screen-roster');
  });
  document.getElementById('btn-quick').addEventListener('click', () => { sfxClick(); gauntlet = null; gotoVs(true); });
  document.getElementById('btn-roster-back').addEventListener('click', () => { sfxClick(); renderGarage(); show('screen-garage'); });
  document.getElementById('btn-gauntlet').addEventListener('click', () => {
    sfxClick();
    const next = nextUnbeaten();
    if (!next) return;
    gauntlet = { fought: 0, coins: 0, leagueUp: null };
    gotoVs(false, next);
  });
  document.getElementById('btn-vs-back').addEventListener('click', () => {
    sfxClick();
    gauntlet = null;
    if (pendingQuick) { renderGarage(); show('screen-garage'); }
    else { renderRoster(); show('screen-roster'); }
  });
  document.getElementById('btn-vs-go').addEventListener('click', () => { sfxClick(); launchBattle(); });
  document.getElementById('btn-result-ok').addEventListener('click', () => {
    sfxClick();
    if (!pendingQuick) { renderRoster(); renderGarage(); show('screen-roster'); }
    else { renderGarage(); show('screen-garage'); }
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
