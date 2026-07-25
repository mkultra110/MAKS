// Point d'entrée : navigation entre écrans et déroulé d'une partie.
import * as THREE from 'three';
import { partDef, upgradeCost, LEAGUES, leagueIndex, SETS, MUTATORS, seededRng, randomPart, COPILOTS, PAINTS } from './data.js';
import {
  state, load, buildLoadout, computeCarStats, makeOpponent, makeRoster,
  winRewards, defeatReward, prestigeBoost, loadoutValid, paintOwned, save,
  ROSTER_SIZE, MEDALS_TO_ADVANCE,
} from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene, addHubDecor, disposeModel, FLOOR_Y } from './render3d.js';
import { createCarModel, poseCarStatic, catMascot } from './models3d.js';
import { carSnapshot, partThumb, avatarThumb, copilotThumb } from './thumbs.js';
import { initGarage, renderGarage, startPreview, stopPreview } from './garage.js';
import { startBattle } from './battle.js';
import {
  unlockAudio, handleVisibility, setMuted, sfxClick, sfxWin, sfxLose,
  sfxMedal, sfxPromote, sfxMeow, sfxBuy, sfxTick, sfxClang, startMusic, stopMusic,
} from './sfx.js';

// Vibrations : plugin Capacitor Haptics si présent (app native), sinon vibrate.
function haptic(style = 'MEDIUM') {
  if (state.settings && !state.settings.haptics) return;
  try {
    const h = window.Capacitor?.Plugins?.Haptics;
    if (h) h.impact({ style });
    else navigator.vibrate?.(style === 'HEAVY' ? 60 : 25);
  } catch (e) {}
}

const pName = () => state.playerName || 'Toi';
let pendingOpponent = null;
let pendingQuick = false;
let gauntlet = null; // { fought, coins } quand le Grand Combat est en cours
let pendingBet = null; // { a, b, choice, amount, oddsA, oddsB } pendant un pari

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'screen-garage') {
    startPreview();
    renderDailyBanner();
  } else stopPreview();
  if (id === 'screen-hub') { renderHub(); resumeHub(); } else pauseHub();
  // musique de menu partout sauf en combat (le combat gère la sienne)
  if (id !== 'screen-battle' && id !== 'screen-loading') startMusic('menu');
  // barre d'onglets : visible sur les 5 écrans principaux
  const TAB_OF = {
    'screen-hub': 'tab-hub', 'screen-garage': 'tab-garage', 'screen-roster': 'tab-arena',
    'screen-shop': 'tab-shop', 'screen-bet': 'tab-bet',
  };
  const tabbar = document.getElementById('tabbar');
  if (tabbar) {
    const active = TAB_OF[id];
    tabbar.classList.toggle('hidden', !active);
    document.getElementById('app').classList.toggle('with-tabs', !!active);
    if (active) tabbar.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b.id === active));
  }
  // iris wipe cartoon
  const iris = document.getElementById('iris');
  if (iris) {
    iris.classList.remove('play');
    void iris.offsetWidth;
    iris.classList.add('play');
  }
}

// ---------- hub : la place du village (scène persistante, en pause hors écran) ----------
let hub = null;
let hubCarKey = '';
const mascotState = { jumpT: -9, bubbleTimer: 0 };

function loadoutKey(lo) {
  return JSON.stringify([
    lo.body && (lo.body.id + (lo.body.paint || '')),
    lo.wheels.map(w => w.id), lo.weapons.map(w => w.id), lo.gadgets.map(g => g.id),
  ]);
}

function ensureHub() {
  if (hub) return;
  const canvas = document.getElementById('hub-canvas');
  const renderer = createRenderer(canvas);
  const scene = createStudioScene(renderer);
  addHubDecor(scene); // stade, panneau MAKS, arbres : un vrai lieu
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const holder = new THREE.Group();
  scene.add(holder);
  const mascotHolder = new THREE.Group();
  mascotHolder.position.set(-1.95, 0, 1.15); // SUR le podium, elle présente la machine
  mascotHolder.rotation.y = 0.55;
  scene.add(mascotHolder);
  hub = { renderer, scene, camera, holder, mascotHolder, mascot: null, mascotColor: null, raf: 0, running: false };

  // tap sur la mascotte → saut + miaou + phrase
  canvas.addEventListener('pointerdown', e => {
    if (!hub.mascot) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, hub.camera);
    if (ray.intersectObject(hub.mascotHolder, true).length) pokeMascot();
  });
}

// Reconstruit la voiture (si le montage a changé) et la mascotte (si le co-pilote a changé).
function refreshHubModels() {
  ensureHub();
  const lo = buildLoadout();
  const key = loadoutKey(lo);
  if (key !== hubCarKey) {
    hubCarKey = key;
    disposeModel(hub.holder);
    hub.holder.clear();
    if (lo.body) {
      const model = createCarModel(buildCarSpec(lo));
      poseCarStatic(model, 1);
      hub.holder.add(model);
      hub.carBodyY = model.userData.bodyGroup.position.y; // base pour le bob idle
    }
  }
  const color = COPILOTS[state.copilot]?.color ?? 0xffd9a0;
  if (hub.mascotColor !== color) {
    hub.mascotColor = color;
    disposeModel(hub.mascotHolder);
    hub.mascotHolder.clear();
    hub.mascot = catMascot(color);
    hub.mascotHolder.add(hub.mascot);
  }
}

function hubLoop(now) {
  if (!hub || !hub.running) return;
  hub.raf = requestAnimationFrame(hubLoop);
  const canvas = hub.renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w && canvas.width !== Math.floor(w * hub.renderer.getPixelRatio())) {
    hub.renderer.setSize(w, h, false);
    hub.camera.aspect = w / h;
    hub.camera.updateProjectionMatrix();
  }
  hub.holder.rotation.y = now / 4200;
  // la vitrine vit : bob de caisse, armes qui tournent lentement (12 fps cranté)
  const showCar = hub.holder.children[0];
  if (showCar?.userData?.bodyGroup) {
    const t12 = Math.floor(now / 1000 * 12) / 12;
    const u = showCar.userData;
    u.bodyGroup.position.y = (hub.carBodyY || 0) + Math.sin(t12 * Math.PI * 2 / 2.4) * 0.03;
    u.bodyGroup.rotation.z = Math.sin(t12 * Math.PI * 2 / 2.4) * 0.008;
    for (const anim of u.spins || []) {
      for (const m of anim.spin || []) m.rotation[anim.axis || 'z'] = t12 * Math.PI;
    }
  }
  // mascotte : idle crantée 12 fps (queue, tête, respiration) + saut au tap
  if (hub.mascot) {
    const tq = Math.floor(now / 1000 * 12) / 12;
    const u = hub.mascot.userData;
    u.tail.rotation.z = Math.sin(tq * Math.PI * 2 / 1.8) * 0.3;
    u.head.rotation.z = Math.sin(tq * Math.PI * 2 / 3.4) * 0.07;
    u.body.scale.y = 1.05 * (1 + Math.sin(tq * Math.PI * 2 / 2.6) * 0.02);
    const since = now / 1000 - mascotState.jumpT;
    hub.mascot.position.y = since < 0.45
      ? Math.sin(Math.min(1, Math.floor(since / 0.45 * 12) / 12) * Math.PI) * 0.55
      : 0;
  }
  const vFov = hub.camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * hub.camera.aspect);
  const dist = Math.max(5.6 / (2 * Math.tan(hFov / 2)), 7);
  hub.camera.position.set(Math.sin(now / 11000) * 1.2, 2.9 + Math.sin(now / 6200) * 0.25, dist);
  hub.camera.lookAt(-0.5, 0.55, 0);
  hub.renderer.render(hub.scene, hub.camera);
  // la bulle de dialogue suit la tête de la mascotte
  const bubble = document.getElementById('mascot-bubble');
  if (!bubble.classList.contains('hidden') && hub.mascot) {
    const p = new THREE.Vector3(0, 2.0, 0);
    hub.mascotHolder.localToWorld(p);
    p.project(hub.camera);
    bubble.style.left = ((p.x * 0.5 + 0.5) * w) + 'px';
    bubble.style.top = ((-p.y * 0.5 + 0.5) * h) + 'px';
  }
}

function resumeHub() {
  ensureHub();
  refreshHubModels();
  if (hub.running) return;
  hub.running = true;
  hub.raf = requestAnimationFrame(hubLoop);
}
function pauseHub() {
  if (!hub) return;
  hub.running = false;
  cancelAnimationFrame(hub.raf);
  document.getElementById('mascot-bubble')?.classList.add('hidden');
}

// La mascotte parle : conseils utiles d'abord, vannes sinon.
const MASCOT_FUN = [
  'Miaou !', 'On va tout casser !', 'Griffes dehors !', 'Je crois en toi. Un peu.',
  'Encore un combat, allez !', 'Mon pelage sent la victoire.', 'Le boss ? Même pas peur.',
  'Nourris-moi de médailles !', 'Ta machine ronronne bien.',
];
function mascotPhrase() {
  const tips = [];
  if (state.dailyDone !== todayKey()) tips.push('Le Défi du jour t\'attend — une pièce 3★ à la clé !');
  const s = computeCarStats(buildLoadout());
  if (s.used > s.capacity) tips.push('Ton énergie déborde, file au garage !');
  if (state.medals.length >= MEDALS_TO_ADVANCE - 1) tips.push('Plus qu\'une médaille pour la promotion !');
  if (tips.length && Math.random() < 0.65) return tips[Math.floor(Math.random() * tips.length)];
  return MASCOT_FUN[Math.floor(Math.random() * MASCOT_FUN.length)];
}
function pokeMascot() {
  mascotState.jumpT = performance.now() / 1000;
  sfxMeow();
  haptic();
  const bubble = document.getElementById('mascot-bubble');
  bubble.textContent = mascotPhrase();
  bubble.classList.remove('hidden');
  clearTimeout(mascotState.bubbleTimer);
  mascotState.bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 2600);
}

function renderHub() {
  document.getElementById('hub-coins').textContent = state.coins;
  document.getElementById('profile-name').textContent = pName();
  document.getElementById('profile-level').textContent = 'NIV. ' + (1 + Math.floor(state.totalWins / 5));
  document.getElementById('profile-avatar').src = avatarThumb(COPILOTS[state.copilot]?.color ?? 0xffd9a0);
  document.getElementById('hub-medals').innerHTML =
    `<svg class="ic"><use href="#i-medal"/></svg>${state.medals.length}/${MEDALS_TO_ADVANCE}`;
  document.getElementById('hub-fight-label').textContent = `COMBATTRE · Ét. ${state.stage}`;
  const li = leagueIndex(state.stage);
  const stageChip = document.getElementById('hub-stage');
  stageChip.textContent = `${state.prestige > 0 ? `★${state.prestige}·` : ''}Ét. ${state.stage}`;
  stageChip.parentElement.querySelector('.ic').style.color = LEAGUES[li].color;
  const valid = loadoutValid(buildLoadout());
  document.getElementById('hub-fight').disabled = !valid;
  document.getElementById('hub-quick').disabled = !valid;
  document.getElementById('tab-bet').disabled = state.coins < 10;
  renderDailyBanner();
}

// ---------- écran de chargement ----------
const LOAD_TIPS = [
  'Astuce : les scies mordent fort à l\'arrière des machines.',
  'Astuce : 3 pièces d\'un même set activent un bonus d\'équipe.',
  'Astuce : recycle tes doublons pour financer tes améliorations.',
  'Astuce : le Défi du jour offre une pièce 3★ garantie.',
  'Astuce : les boss de fin de ligue paient 50% de plus.',
  'Astuce : tape sur ton chat au hub, il adore ça.',
  'Astuce : la Boutique vend des caisses pleines de pièces.',
];
function runLoading() {
  const fill = document.getElementById('load-fill');
  document.getElementById('load-tip').textContent =
    LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
  const t0 = performance.now();
  let ready = false;
  Promise.resolve(document.fonts?.ready).then(() => {
    ensureHub();
    refreshHubModels();
    ready = true;
  });
  const MIN = 1300;
  const step = now => {
    const el = now - t0;
    let p = Math.min(0.92, el / MIN);
    if (ready && el >= MIN) p = 1;
    // progression crantée façon stop-motion
    fill.style.width = Math.round(Math.floor(p * 14) / 14 * 100) + '%';
    if (p >= 1) { setTimeout(() => show('screen-hub'), 160); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- confettis de victoire ----------
function confetti() {
  const canvas = document.getElementById('confetti-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  const colors = ['#FFB800', '#FF4D5E', '#49C4F0', '#2FD573', '#FFF6E0', '#26183A'];
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

// Compteur animé de pièces gagnées (avec petits ticks sonores).
function countUp(el, target) {
  const t0 = performance.now();
  const dur = 700;
  let lastTick = -1;
  const loop = now => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = '+' + Math.round(target * (1 - Math.pow(1 - k, 3)));
    const tick = Math.floor(k * 8);
    if (tick !== lastTick) { lastTick = tick; if (k < 1) sfxTick(); }
    if (k < 1) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Révélation en cascade sur l'écran résultat : chaque élément arrive avec un délai.
let resultTimers = [];
function cascade(steps) {
  for (const t of resultTimers) clearTimeout(t);
  resultTimers = steps.map(([ms, fn]) => setTimeout(fn, ms));
}
function addBit(text) {
  const el = document.createElement('div');
  el.className = 'result-bit';
  el.textContent = text;
  document.getElementById('result-bits').appendChild(el);
  sfxClick();
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
  // score du joueur pour situer la difficulté de chaque adversaire
  const ps = computeCarStats(buildLoadout());
  const playerScore = Math.max(1, ps.hp * ps.atk);
  const nextIdx = roster.find(o => !state.medals.includes(o.idx))?.idx;
  roster.forEach((opp, i) => {
    const beaten = state.medals.includes(opp.idx);
    const os = computeCarStats(opp.loadout);
    const ratio = (os.hp * opp.statBoost * os.atk * opp.dmgBoost) / playerScore;
    const diff = opp.boss ? 'boss' : (ratio < 0.75 ? 'easy' : (ratio > 1.4 ? 'hard' : ''));
    const el = document.createElement('div');
    el.className = 'roster-card' + (beaten ? ' beaten' : '') + (diff ? ' ' + diff : '')
      + (!beaten && opp.idx === nextIdx ? ' next' : '');
    el.style.animationDelay = (i * 0.045) + 's';
    // la MACHINE adverse (pas juste l'avatar), sur fond teinté à la couleur du chat
    const img = document.createElement('img');
    img.src = carSnapshot(opp.loadout, { dir: -1, w: 128, h: 96 });
    img.style.background = '#' + opp.avatar.toString(16).padStart(6, '0') + '55';
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
    if (diff && !beaten) {
      const tag = document.createElement('div');
      tag.className = 'rc-diff ' + diff;
      tag.textContent = opp.boss ? 'BOSS' : (diff === 'easy' ? 'FACILE' : 'COSTAUD');
      el.appendChild(tag);
    }
    if (!beaten && opp.idx === nextIdx) {
      const tag = document.createElement('div');
      tag.className = 'rc-next';
      tag.textContent = 'À TOI !';
      el.appendChild(tag);
    }
    if (!beaten) el.addEventListener('click', () => { sfxClick(); gotoVs(false, opp); });
    list.appendChild(el);
  });
  const unbeaten = roster.filter(o => !state.medals.includes(o.idx));
  document.getElementById('btn-gauntlet').disabled = unbeaten.length === 0;
}

function nextUnbeaten() {
  return makeRoster(state.stage).find(o => !state.medals.includes(o.idx)) || null;
}

// ---------- Défi du jour : un combat à mutateur, une récompense 3★ par jour ----------
let pendingDaily = null;

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dailyOfToday() {
  const day = todayKey();
  const seed = [...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0x7fffffff;
  const rng = seededRng(seed);
  const mutator = MUTATORS[Math.floor(rng() * MUTATORS.length)];
  const opponent = makeOpponent(state.stage, Math.floor(rng() * ROSTER_SIZE));
  return { day, mutator, opponent: { ...opponent, name: opponent.name, idx: null } };
}

function renderDailyBanner() {
  for (const id of ['daily-banner', 'hub-daily']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove('hidden');
    if (state.dailyDone === todayKey()) {
      el.className = 'daily-banner done';
      // décompte réel jusqu'au prochain défi (minuit)
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      const mins = Math.max(0, Math.floor((next - now) / 60000));
      el.innerHTML = `<svg class="ic"><use href="#i-check"/></svg> Défi réussi — prochain dans ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
    } else {
      const { mutator } = dailyOfToday();
      el.className = 'daily-banner';
      el.innerHTML = `<svg class="ic"><use href="#i-daily"/></svg> Défi du jour : ${mutator.name} — gagne une pièce 3★ !`;
    }
  }
}

// ---------- Boutique : offre du jour, caisses, peintures, co-pilotes ----------
const CRATES = [
  { key: 'bois', name: 'Caisse Bois', desc: '2 pièces surprises', price: 120,
    roll: rng => [randomPart(rng, state.stage), randomPart(rng, state.stage)] },
  { key: 'or', name: 'Caisse Or', desc: '3 pièces, dont une 3★ minimum', price: 350,
    roll: rng => [randomPart(rng, state.stage, 3), randomPart(rng, state.stage), randomPart(rng, state.stage)] },
  { key: 'etoile', name: 'Caisse Étoile', desc: '3 pièces 3★+, dont une 4★ minimum', price: 900,
    roll: rng => [randomPart(rng, state.stage, 4), randomPart(rng, state.stage, 3), randomPart(rng, state.stage, 3)] },
];
const PAINT_PRICE = 60;
const COPILOT_PRICE = 450;

function shopDailyOffer() {
  const day = todayKey();
  const seed = [...day].reduce((a, c) => a * 33 + c.charCodeAt(0), 11) & 0x7fffffff;
  const rng = seededRng(seed ^ 0x5a5a);
  return { day, part: randomPart(rng, state.stage, 3), price: 100 + state.stage * 25 };
}

function priceBtn(price, disabled, fn) {
  const b = document.createElement('button');
  b.className = 'btn gold price-btn';
  if (typeof price === 'number') {
    b.innerHTML = '<svg class="ic"><use href="#i-coin"/></svg> ' + price;
  } else b.textContent = price;
  b.disabled = disabled;
  b.addEventListener('click', e => { e.stopPropagation(); sfxClick(); fn(); });
  return b;
}

function shopCard(cls, media, name, desc, btn) {
  const el = document.createElement('div');
  el.className = 'shop-card ' + cls;
  el.appendChild(media);
  const info = document.createElement('div');
  info.className = 'shop-info';
  const nm = document.createElement('div');
  nm.className = 'shop-name';
  nm.textContent = name;
  info.appendChild(nm);
  const de = document.createElement('div');
  de.className = 'shop-desc';
  de.textContent = desc;
  info.appendChild(de);
  el.appendChild(info);
  el.appendChild(btn);
  return el;
}

function renderShop() {
  document.getElementById('shop-coins').textContent = state.coins;
  const list = document.getElementById('shop-list');
  list.innerHTML = '';
  const section = (title, icon) => {
    const h = document.createElement('div');
    h.className = 'shop-section';
    h.innerHTML = (icon ? `<svg class="ic"><use href="#${icon}"/></svg> ` : '') + title;
    list.appendChild(h);
  };

  // — offre du jour —
  section('Offre du jour', 'i-clock');
  const offer = shopDailyOffer();
  const sold = state.shopDaily === offer.day;
  const oimg = document.createElement('img');
  oimg.src = partThumb(offer.part);
  list.appendChild(shopCard(
    'offer' + (sold ? ' sold' : ''), oimg,
    `${partDef(offer.part).name} ${'★'.repeat(offer.part.stars)}`,
    sold ? 'Reviens demain pour une nouvelle offre !' : `niv. ${offer.part.level} · −50% aujourd'hui seulement !`,
    priceBtn(sold ? 'Vendu !' : offer.price, sold || state.coins < offer.price, () => {
      state.coins -= offer.price;
      state.shopDaily = offer.day;
      state.inventory.push(offer.part);
      save();
      sfxBuy();
      haptic();
      openCrate('Bonne affaire !', [offer.part]);
      renderShop();
    })
  ));

  // — caisses —
  section('Caisses de pièces', 'i-gift');
  for (const cr of CRATES) {
    const em = document.createElement('div');
    em.className = 'crate-emoji tier-' + cr.key;
    em.innerHTML = '<svg class="ic"><use href="#i-gift"/></svg>';
    list.appendChild(shopCard(
      'crate-' + cr.key, em, cr.name, cr.desc,
      priceBtn(cr.price, state.coins < cr.price, () => {
        state.coins -= cr.price;
        const parts = cr.roll(seededRng((Date.now() & 0x7fffffff) ^ (cr.price * 31)));
        state.inventory.push(...parts);
        save();
        sfxBuy();
        haptic('HEAVY');
        openCrate(cr.name + ' ouverte !', parts);
        renderShop();
      })
    ));
  }

  // — peintures (débloquées pour toutes les machines) —
  section('Peintures — pour toutes tes machines', 'i-star');
  const pg = document.createElement('div');
  pg.className = 'paint-shop';
  for (const color of PAINTS) {
    const owned = paintOwned(color, PAINTS);
    const b = document.createElement('button');
    b.className = 'paint-swatch big' + (owned ? ' owned' : '');
    b.style.background = `linear-gradient(180deg, ${color}, ${color}cc)`;
    if (owned) b.textContent = '✓';
    else {
      const tag = document.createElement('span');
      tag.className = 'paint-price';
      tag.textContent = PAINT_PRICE;
      b.appendChild(tag);
      b.disabled = state.coins < PAINT_PRICE;
      b.addEventListener('click', () => {
        sfxClick();
        state.coins -= PAINT_PRICE;
        state.paints.push(color);
        save();
        sfxBuy();
        renderShop();
      });
    }
    pg.appendChild(b);
  }
  list.appendChild(pg);

  // — co-pilotes en déblocage anticipé —
  const li = leagueIndex(state.stage);
  const lockedCp = Object.entries(COPILOTS).filter(([id, cp]) => li < cp.unlock && !state.copilotsBought.includes(id));
  if (lockedCp.length) {
    section('Co-pilotes — déblocage anticipé', 'i-copilot');
    for (const [id, cp] of lockedCp) {
      const img = document.createElement('img');
      img.src = copilotThumb(id);
      list.appendChild(shopCard(
        'copilot', img, cp.name, `${cp.passive} · ${cp.active}`,
        priceBtn(COPILOT_PRICE, state.coins < COPILOT_PRICE, () => {
          state.coins -= COPILOT_PRICE;
          state.copilotsBought.push(id);
          state.copilot = id;
          save();
          sfxBuy();
          haptic('HEAVY');
          renderShop();
        })
      ));
    }
  }
}

// Révélation des pièces obtenues (caisse ou offre), une par une.
function openCrate(title, parts) {
  document.getElementById('crate-title').textContent = title;
  const wrap = document.getElementById('crate-parts');
  wrap.innerHTML = '';
  parts.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'crate-part';
    el.style.animationDelay = (0.15 + i * 0.3) + 's';
    const img = document.createElement('img');
    img.src = partThumb(p);
    el.appendChild(img);
    const nm = document.createElement('div');
    nm.className = 'crate-part-name';
    nm.textContent = `${partDef(p).name} ${'★'.repeat(p.stars)} · niv. ${p.level}`;
    el.appendChild(nm);
    wrap.appendChild(el);
  });
  document.getElementById('crate-sheet').classList.remove('hidden');
}

// ---------- La carte du championnat : le parcours des 6 ligues ----------
function renderSeason() {
  const path = document.getElementById('season-path');
  path.innerHTML = '';
  const curLi = leagueIndex(state.stage);
  LEAGUES.forEach((lg, i) => {
    const last = (LEAGUES[i + 1]?.min ?? 25) - 1;
    const el = document.createElement('div');
    const status = i < curLi ? 'done' : (i === curLi ? 'current' : 'locked');
    el.className = 'season-league ' + status;
    el.style.setProperty('--lg', lg.color);
    const head = document.createElement('div');
    head.className = 'sl-head';
    head.innerHTML = `<span class="sl-dot"></span><span class="sl-name">Ligue ${lg.name}</span>` +
      `<span class="sl-range">Ét. ${lg.min}–${last}</span>`;
    el.appendChild(head);
    const sub = document.createElement('div');
    sub.className = 'sl-sub';
    if (status === 'done') sub.textContent = '✓ Conquise !';
    else if (status === 'current') {
      sub.textContent = `Tu es à l'étape ${state.stage} · ${state.medals.length}/${MEDALS_TO_ADVANCE} médailles`;
    } else sub.textContent = `Boss au bout · nouvelles arènes`;
    el.appendChild(sub);
    if (status === 'current') {
      const bar = document.createElement('div');
      bar.className = 'sl-bar';
      const span = last - lg.min + 1;
      const fill = document.createElement('div');
      fill.style.width = Math.round(((state.stage - lg.min) + state.medals.length / MEDALS_TO_ADVANCE) / span * 100) + '%';
      bar.appendChild(fill);
      el.appendChild(bar);
    }
    path.appendChild(el);
  });
  const prestige = document.createElement('div');
  prestige.className = 'season-league prestige' + (state.prestige > 0 ? ' done' : '');
  prestige.innerHTML = `<div class="sl-head"><span class="sl-dot"></span><span class="sl-name"><svg class="ic"><use href="#i-star"/></svg> PRESTIGE</span>` +
    `<span class="sl-range">après l'ét. 24</span></div>` +
    `<div class="sl-sub">${state.prestige > 0 ? `Déjà ${state.prestige} prestige${state.prestige > 1 ? 's' : ''} — légende vivante !` : 'Recommence plus fort : +4% de puissance permanente'}</div>`;
  path.appendChild(prestige);
}

// ---------- Réglages & profil ----------
function renderSettings() {
  document.getElementById('tgl-sound').classList.toggle('on', state.settings.sound);
  document.getElementById('tgl-haptics').classList.toggle('on', state.settings.haptics);
}

function renderProfile() {
  document.getElementById('profile-img').src = avatarThumb(COPILOTS[state.copilot]?.color ?? 0xffd9a0);
  document.getElementById('profile-input').value = pName();
  const li = leagueIndex(state.stage);
  const rows = [
    ['Ligue', LEAGUES[li].name],
    ['Étape', state.stage],
    ['Meilleure étape', state.bestStage],
    ['Victoires', state.totalWins],
    ['Prestige', state.prestige > 0 ? '★'.repeat(state.prestige) : '—'],
    ['Pièces d\'or', state.coins],
    ['Pièces possédées', state.inventory.length],
  ];
  const grid = document.getElementById('profile-stats');
  grid.innerHTML = '';
  for (const [k, v] of rows) {
    const el = document.createElement('div');
    el.className = 'pstat';
    const small = document.createElement('small');
    small.textContent = k;
    el.appendChild(small);
    el.appendChild(document.createTextNode(String(v)));
    grid.appendChild(el);
  }
}

function gotoDaily() {
  const daily = dailyOfToday();
  pendingDaily = daily;
  pendingQuick = true; // routage du résultat vers le garage
  gauntlet = null;
  pendingOpponent = daily.opponent;
  const lo = buildLoadout();
  document.getElementById('vs-me').src = carSnapshot(lo, { dir: 1 });
  document.getElementById('vs-them').src = carSnapshot(daily.opponent.loadout, { dir: -1 });
  document.getElementById('vs-me-name').textContent = pName();
  document.getElementById('vs-me-stats').textContent = statLine(lo);
  document.getElementById('vs-them-name').textContent = daily.opponent.name;
  document.getElementById('vs-them-stats').textContent =
    `${daily.mutator.name} : ${daily.mutator.desc}`;
  document.getElementById('vs-stake').textContent =
    `Récompense : pièce ★★★ garantie + ${80 + state.stage * 20} pièces`;
  show('screen-vs');
  vsDrama();
}

// ---------- les Paris : deux machines s'affrontent, on mise ----------
let betPair = null;
let betAmount = 25;

function machineScore(m) {
  const s = computeCarStats(m.loadout);
  return Math.max(1, s.hp * m.statBoost * Math.max(1, s.atk * m.dmgBoost));
}
function betOdds(pair) {
  const sA = machineScore(pair.a), sB = machineScore(pair.b);
  const pA = sA / (sA + sB);
  const clamp = x => Math.max(1.15, Math.min(5, x));
  return { a: clamp(0.9 / pA), b: clamp(0.9 / (1 - pA)) };
}

function openBets(fresh = true) {
  if (fresh) {
    betPair = {
      a: makeOpponent(state.stage, Math.floor(Math.random() * ROSTER_SIZE), true),
      b: makeOpponent(state.stage, Math.floor(Math.random() * ROSTER_SIZE) + 20, true),
    };
  }
  const odds = betOdds(betPair);
  document.getElementById('bet-img-a').src = carSnapshot(betPair.a.loadout, { dir: 1, w: 360, h: 220 });
  document.getElementById('bet-img-b').src = carSnapshot(betPair.b.loadout, { dir: -1, w: 360, h: 220 });
  document.getElementById('bet-name-a').textContent = betPair.a.name;
  document.getElementById('bet-name-b').textContent = betPair.b.name;
  document.getElementById('bet-stats-a').textContent = statLine(betPair.a.loadout, betPair.a.statBoost);
  document.getElementById('bet-stats-b').textContent = statLine(betPair.b.loadout, betPair.b.statBoost);
  document.getElementById('bet-odds-a').textContent = 'cote ×' + odds.a.toFixed(1);
  document.getElementById('bet-odds-b').textContent = 'cote ×' + odds.b.toFixed(1);
  betPair.odds = odds;

  // mises proposées
  const amounts = [10, 25, 50, 100, 250];
  const wrap = document.getElementById('bet-amounts');
  wrap.innerHTML = '';
  if (betAmount > state.coins) betAmount = amounts.find(a => a <= state.coins) || 0;
  if (betAmount === 0) {
    // impasse : pas de quoi miser — on propose une sortie au lieu de tout griser
    const msg = document.createElement('div');
    msg.className = 'bet-broke';
    msg.textContent = 'Pas assez de pièces pour miser (min. 10).';
    wrap.appendChild(msg);
    const go = document.createElement('button');
    go.className = 'btn primary';
    go.innerHTML = '<svg class="ic"><use href="#i-bolt"/></svg> Gagne un combat Rapide !';
    go.addEventListener('click', () => { sfxClick(); gauntlet = null; gotoVs(true); });
    wrap.appendChild(go);
  } else {
    for (const a of amounts) {
      const chip = document.createElement('button');
      chip.className = 'bet-chip' + (a === betAmount ? ' selected' : '');
      chip.textContent = a;
      chip.disabled = a > state.coins;
      chip.addEventListener('click', () => { sfxClick(); betAmount = a; openBets(false); });
      wrap.appendChild(chip);
    }
  }
  const can = betAmount > 0 && betAmount <= state.coins;
  const btnA = document.getElementById('btn-bet-a');
  const btnB = document.getElementById('btn-bet-b');
  btnA.disabled = !can;
  btnB.disabled = !can;
  const short = n => (n.length > 11 ? n.slice(0, 10) + '…' : n);
  btnA.innerHTML = `${short(betPair.a.name)}<small>gain ${Math.round(betAmount * odds.a)}</small>`;
  btnB.innerHTML = `${short(betPair.b.name)}<small>gain ${Math.round(betAmount * odds.b)}</small>`;
  show('screen-bet');
}

function placeBet(choice) {
  if (betAmount <= 0 || betAmount > state.coins) return;
  state.coins -= betAmount;
  save();
  pendingDaily = null;
  pendingQuick = true; // le bouton « Continuer » du résultat ramène au garage
  pendingBet = { ...betPair, choice, amount: betAmount, odds: betPair.odds };
  show('screen-battle');
  document.getElementById('hud-name-l').textContent = 'A · ' + pendingBet.a.name;
  document.getElementById('hud-name-r').textContent = 'B · ' + pendingBet.b.name;
  document.getElementById('battle-msg').classList.add('hidden');
  battleIntro(pendingBet.a.name, pendingBet.b.name);
  startBattle({
    playerLoadout: pendingBet.a.loadout,
    playerBoost: pendingBet.a.statBoost,
    playerDmgBoost: pendingBet.a.dmgBoost,
    opponent: pendingBet.b,
    copilot: null,
    themeIndex: leagueIndex(state.stage),
    onEnd: onBetEnd,
  });
}

function onBetEnd(result) {
  const bet = pendingBet;
  pendingBet = null;
  const winnerA = result.win; // "win" = la machine de gauche (A) a gagné
  const won = (bet.choice === 'a') === winnerA;
  const winner = winnerA ? bet.a : bet.b;
  const title = document.getElementById('result-title');
  const btnNext = document.getElementById('btn-next');
  const carEl = document.getElementById('result-car');
  cascade([]); // stoppe une éventuelle cascade précédente
  document.getElementById('reward-part').classList.add('hidden');
  document.getElementById('result-league').classList.add('hidden');
  document.getElementById('result-progress').classList.add('hidden');
  document.getElementById('result-bits').innerHTML = '';
  document.getElementById('result-rewards').classList.remove('hidden');
  document.getElementById('btn-result-ok').classList.remove('hidden');
  // la machine victorieuse, en portrait
  carEl.src = carSnapshot(winner.loadout, { dir: winnerA ? 1 : -1, w: 360, h: 200 });
  carEl.classList.remove('hidden');
  const odds = bet.choice === 'a' ? bet.odds.a : bet.odds.b;
  if (won) {
    const payout = Math.round(bet.amount * odds);
    state.coins += payout;
    save();
    sfxWin();
    title.textContent = 'PARI GAGNÉ !';
    title.className = 'result-title win';
    document.getElementById('result-sub').textContent = `${winner.name} l'emporte !`;
    addBit(`Mise ${bet.amount} × cote ${odds.toFixed(1)} = ${payout} pièces`);
    countUp(document.getElementById('reward-coins'), payout);
  } else {
    sfxLose();
    title.textContent = 'PARI PERDU…';
    title.className = 'result-title lose';
    document.getElementById('result-sub').textContent = `${winner.name} l'emporte. Mise perdue (${bet.amount} pièces).`;
    document.getElementById('reward-coins').textContent = '-' + bet.amount;
  }
  btnNext.textContent = 'Nouveau pari';
  btnNext.classList.remove('hidden');
  btnNext.dataset.mode = 'bet';
  document.getElementById('sunburst').classList.toggle('hidden', !won);
  show('screen-result');
  if (won) confetti();
}

// ---------- déroulé d'une partie ----------
// Statistiques comparées : la meilleure valeur en vert ▲, la moins bonne en rouge ▼.
function vsCompare(lo, opp) {
  const me = computeCarStats(lo);
  const os = computeCarStats(opp.loadout);
  const them = { hp: os.hp * opp.statBoost, atk: os.atk * opp.dmgBoost };
  const cls = (a, b) => (a > b * 1.05 ? 'up' : (b > a * 1.05 ? 'down' : ''));
  const span = (v, c) => `<span class="${c}">${Math.round(v)}${c === 'up' ? '▲' : (c === 'down' ? '▼' : '')}</span>`;
  document.getElementById('vs-me-stats').innerHTML =
    `PV ${span(me.hp, cls(me.hp, them.hp))} · ATQ ${span(me.atk, cls(me.atk, them.atk))}`;
  document.getElementById('vs-them-stats').innerHTML =
    `PV ${span(them.hp, cls(them.hp, me.hp))} · ATQ ${span(them.atk, cls(them.atk, me.atk))}`;
}
// Le clang du badge VS après l'entrée des deux cartes.
function vsDrama() {
  setTimeout(() => { sfxClang(); haptic(); }, 480);
}

function gotoVs(quick, opponent = null) {
  pendingDaily = null;
  pendingQuick = quick;
  pendingOpponent = opponent || makeOpponent(Math.max(1, state.stage - 1), Math.floor(Math.random() * ROSTER_SIZE), true);
  const lo = buildLoadout();
  document.getElementById('vs-me').src = carSnapshot(lo, { dir: 1 });
  document.getElementById('vs-them').src = carSnapshot(pendingOpponent.loadout, { dir: -1 });
  document.getElementById('vs-me-name').textContent = pName();
  document.getElementById('vs-them-name').textContent =
    pendingOpponent.name + (quick ? '' : ` · Étape ${state.stage}`);
  vsCompare(lo, pendingOpponent);
  // l'enjeu du combat, visible avant de s'engager
  const stake = document.getElementById('vs-stake');
  stake.innerHTML = quick
    ? `Entraînement · ~${12 + state.stage * 5} pièces`
    : `Enjeu : <svg class="ic"><use href="#i-medal"/></svg> médaille + ~${25 + state.stage * 14} pièces${pendingOpponent.boss ? ' · prime de boss +50% !' : ''}`;
  show('screen-vs');
  vsDrama();
}

function launchBattle() {
  show('screen-battle');
  document.getElementById('hud-name-l').textContent = pName();
  document.getElementById('hud-name-r').textContent = pendingOpponent.name;
  document.getElementById('battle-msg').classList.add('hidden');
  // annonce du duel façon affiche de boxe
  battleIntro(pName(), pendingOpponent.name);
  // premier combat : expliquer que la machine se bat toute seule
  if (state.totalWins === 0 && !pendingBet) {
    const toast = document.getElementById('battle-toast');
    setTimeout(() => {
      toast.textContent = 'Combat automatique — ta machine se débrouille toute seule. Croise les pattes !';
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3200);
    }, 2400);
  }
  startBattle({
    playerLoadout: buildLoadout(),
    playerBoost: prestigeBoost(),
    opponent: pendingOpponent,
    copilot: state.copilot,
    themeIndex: leagueIndex(state.stage),
    mutator: pendingDaily ? pendingDaily.mutator : null,
    onEnd: onBattleEnd,
  });
}

// Affiche de duel au lancement du combat (par-dessus le compte à rebours).
let introTimer = 0;
function battleIntro(left, right) {
  const el = document.getElementById('battle-intro');
  document.getElementById('intro-l').textContent = left;
  document.getElementById('intro-r').textContent = right;
  el.classList.remove('hidden');
  clearTimeout(introTimer);
  introTimer = setTimeout(() => el.classList.add('hidden'), 2100);
}

// Bannière entre deux combats du Grand Combat.
function gauntletBanner(text, then) {
  const el = document.getElementById('gauntlet-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => {
    el.classList.add('hidden');
    then();
  }, 1300);
}

// Conseil actionnable après des défaites répétées.
let defeatStreak = 0;
function defeatAdvice() {
  const lo = buildLoadout();
  const candidates = [lo.body, ...lo.wheels, ...lo.weapons, ...lo.gadgets].filter(Boolean);
  const affordable = candidates
    .map(p => ({ p, cost: upgradeCost(p) }))
    .filter(c => c.cost <= state.coins)
    .sort((a, b) => a.cost - b.cost);
  if (affordable.length) {
    const { p, cost } = affordable[0];
    return `Conseil : améliore ta pièce « ${partDef(p).name} » (${cost} pièces d'or).`;
  }
  return 'Conseil : recycle tes doublons pour financer des améliorations.';
}

function onBattleEnd(result) {
  const title = document.getElementById('result-title');
  const partEl = document.getElementById('reward-part');
  const leagueEl = document.getElementById('result-league');
  const progressEl = document.getElementById('result-progress');
  const btnNext = document.getElementById('btn-next');
  const btnOk = document.getElementById('btn-result-ok');
  const bitsEl = document.getElementById('result-bits');
  const carEl = document.getElementById('result-car');
  const rewardsEl = document.getElementById('result-rewards');
  partEl.classList.add('hidden');
  leagueEl.classList.add('hidden');
  progressEl.classList.add('hidden');
  btnNext.classList.add('hidden');
  bitsEl.innerHTML = '';
  carEl.classList.add('hidden');

  if (result.win) {
    defeatStreak = 0;
    const beatenName = pendingOpponent.name;
    const wasBoss = !!pendingOpponent.boss;
    const r = winRewards(pendingQuick, pendingOpponent.idx);
    // Défi du jour réussi : grosse prime + pièce 3★ garantie
    let dailyPart = null;
    if (pendingDaily && state.dailyDone !== pendingDaily.day) {
      state.dailyDone = pendingDaily.day;
      const bonus = 80 + state.stage * 20;
      state.coins += bonus;
      r.coins += bonus;
      dailyPart = randomPart(seededRng((Date.now() & 0x7fffffff) ^ 0x51ab), state.stage, 3);
      state.inventory.push(dailyPart);
      r.part = r.part || dailyPart;
      save();
    }
    // le boss de fin de ligue paie 50% de plus
    let bossBonus = 0;
    if (wasBoss) {
      bossBonus = Math.round(r.coins * 0.5);
      state.coins += bossBonus;
      save();
    }
    // Grand Combat : on enchaîne tant qu'on n'est pas promu (ou plus d'adversaires)
    if (gauntlet && !r.promoted) {
      gauntlet.fought++;
      gauntlet.coins += r.coins;
      gauntlet.leagueUp = gauntlet.leagueUp || r.leagueUp;
      const next = nextUnbeaten();
      if (next) {
        pendingOpponent = next;
        sfxMedal();
        gauntletBanner(`VICTOIRE ×${gauntlet.fought} !`, launchBattle);
        return;
      }
    }
    haptic('HEAVY');
    if (r.promoted) sfxPromote(); else { sfxWin(); if (r.medal || dailyPart) sfxMedal(); }
    title.textContent = dailyPart ? 'DÉFI RÉUSSI !' : (r.prestiged ? 'PRESTIGE !' : (r.promoted ? 'PROMU !' : 'VICTOIRE !'));
    title.className = 'result-title win';
    document.getElementById('result-sub').textContent = `${beatenName} est K.O. !`;
    const bits = [];
    if (dailyPart) bits.push(`Défi « ${pendingDaily.mutator.name} » dans la poche !`);
    if (wasBoss) bits.push(`Boss vaincu : +${bossBonus} pièces bonus !`);
    if (gauntlet && gauntlet.fought > 0) bits.push(`Série du Grand Combat : ${gauntlet.fought + 1} victoires !`);
    if (r.medal) bits.push('Médaille prise !');
    if (r.prestiged) bits.push(`Championnat terminé ! Retour à l'étape 1 avec +4% de puissance permanente.`);
    else if (r.promoted) bits.push(`Bienvenue à l'étape ${state.stage} !`);
    if (r.prestiged) leagueEl.textContent = `PRESTIGE ★${state.prestige} — LÉGENDE VIVANTE !`;
    let hasNext = false;
    if (!pendingQuick && !r.promoted) {
      progressEl.innerHTML = `<svg class="ic"><use href="#i-medal"/></svg> ${state.medals.length}/${MEDALS_TO_ADVANCE} médailles vers la promotion`;
      const next = nextUnbeaten();
      if (next) {
        pendingOpponent = next;
        btnNext.innerHTML = `<svg class="ic"><use href="#i-sword"/></svg> Suivant : ${next.name}`;
        btnNext.dataset.mode = '';
        btnNext.classList.remove('danger');
        hasNext = true;
      }
    }
    const leagueUp = r.leagueUp || (gauntlet && gauntlet.leagueUp);
    if (leagueUp) leagueEl.textContent = `NOUVELLE LIGUE : ${leagueUp.name.toUpperCase()} ! +${leagueUp.bonus} pièces`;
    const totalCoins = r.coins + bossBonus + (gauntlet ? gauntlet.coins : 0);
    const shown = r.part || (r.extraParts && r.extraParts[0]);
    if (shown) {
      document.getElementById('reward-img').src = partThumb(shown);
      const extra = r.extraParts && r.extraParts.length > 1 ? ` (+${r.extraParts.length - (r.part ? 0 : 1)} autres !)` : '';
      // écho de collection : le drop appartient-il à un set ?
      const setOf = Object.values(SETS).find(s => s.parts.includes(shown.type));
      const setNote = setOf ? ` · Set ${setOf.name} !` : '';
      document.getElementById('reward-name').textContent =
        `${partDef(shown).name} ${'★'.repeat(shown.stars)} · niv. ${shown.level}${extra}${setNote}`;
    }
    // mise en scène : tout arrive en cascade, pas d'un bloc
    rewardsEl.classList.add('hidden');
    btnOk.classList.add('hidden');
    document.getElementById('sunburst').classList.remove('hidden');
    show('screen-result');
    confetti();
    const myCar = carSnapshot(buildLoadout(), { dir: 1, w: 360, h: 200 });
    const steps = [
      [280, () => { carEl.src = myCar; carEl.classList.remove('hidden'); }],
      ...bits.map((b, i) => [520 + i * 260, () => addBit(b)]),
      [640 + bits.length * 260, () => {
        rewardsEl.classList.remove('hidden');
        countUp(document.getElementById('reward-coins'), totalCoins);
      }],
    ];
    let t = 1350 + bits.length * 260;
    if (shown) { steps.push([t, () => { partEl.classList.remove('hidden'); sfxMedal(); }]); t += 450; }
    if (leagueEl.textContent && (r.prestiged || leagueUp)) steps.push([t, () => leagueEl.classList.remove('hidden')]);
    if (!pendingQuick && !r.promoted) steps.push([t, () => progressEl.classList.remove('hidden')]);
    steps.push([t + 250, () => {
      btnOk.classList.remove('hidden');
      if (hasNext) btnNext.classList.remove('hidden');
    }]);
    cascade(steps);
  } else {
    defeatStreak++;
    haptic('MEDIUM');
    sfxLose();
    title.textContent = 'DÉFAITE';
    title.className = 'result-title lose';
    let coins = defeatReward(pendingQuick);
    let sub = result.reason;
    if (gauntlet) {
      sub = `${result.reason} Série du Grand Combat terminée : ${gauntlet.fought} victoire${gauntlet.fought > 1 ? 's' : ''}.`;
      coins += gauntlet.coins;
    } else if (defeatStreak >= 2) {
      sub += ' ' + defeatAdvice();
    } else {
      sub += ' Améliore tes pièces et réessaie !';
    }
    document.getElementById('result-sub').textContent = sub;
    rewardsEl.classList.remove('hidden');
    document.getElementById('reward-coins').textContent = '+' + coins;
    document.getElementById('sunburst').classList.add('hidden');
    btnOk.classList.remove('hidden');
    if (!gauntlet) {
      btnNext.textContent = 'REVANCHE !';
      btnNext.classList.add('danger');
      btnNext.classList.remove('hidden');
      btnNext.dataset.mode = '';
    }
    show('screen-result');
    cascade([]);
  }
  gauntlet = null;
  pendingDaily = null;
}

function boot() {
  load();
  setMuted(!state.settings.sound);
  initGarage();
  runLoading();

  // — hub —
  document.getElementById('hub-fight').addEventListener('click', () => {
    sfxClick();
    renderRoster();
    show('screen-roster');
  });
  document.getElementById('hub-quick').addEventListener('click', () => { sfxClick(); gauntlet = null; gotoVs(true); });

  // — barre d'onglets —
  document.getElementById('tab-hub').addEventListener('click', () => { sfxClick(); show('screen-hub'); });
  document.getElementById('tab-garage').addEventListener('click', () => { sfxClick(); renderGarage(); show('screen-garage'); });
  document.getElementById('tab-arena').addEventListener('click', () => { sfxClick(); renderRoster(); show('screen-roster'); });
  document.getElementById('tab-shop').addEventListener('click', () => { sfxClick(); renderShop(); show('screen-shop'); });
  document.getElementById('tab-bet').addEventListener('click', () => { sfxClick(); openBets(); });
  document.getElementById('hub-daily').addEventListener('click', () => { sfxClick(); gotoDaily(); });
  document.getElementById('btn-garage-back').addEventListener('click', () => { sfxClick(); show('screen-hub'); });
  document.getElementById('btn-shop-back').addEventListener('click', () => { sfxClick(); show('screen-hub'); });

  // — boutique : fermeture de la caisse —
  document.getElementById('crate-close').addEventListener('click', () => {
    sfxClick();
    document.getElementById('crate-sheet').classList.add('hidden');
  });
  document.getElementById('crate-sheet').addEventListener('click', e => {
    if (e.target.id === 'crate-sheet') document.getElementById('crate-sheet').classList.add('hidden');
  });

  // — carte du championnat —
  document.getElementById('btn-season').addEventListener('click', () => {
    sfxClick();
    renderSeason();
    document.getElementById('season-sheet').classList.remove('hidden');
  });
  document.getElementById('season-close').addEventListener('click', () => {
    sfxClick();
    document.getElementById('season-sheet').classList.add('hidden');
  });
  document.getElementById('season-sheet').addEventListener('click', e => {
    if (e.target.id === 'season-sheet') document.getElementById('season-sheet').classList.add('hidden');
  });

  // — réglages —
  document.getElementById('btn-settings').addEventListener('click', () => {
    sfxClick();
    renderSettings();
    document.getElementById('settings-sheet').classList.remove('hidden');
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    sfxClick();
    document.getElementById('settings-sheet').classList.add('hidden');
  });
  document.getElementById('settings-sheet').addEventListener('click', e => {
    if (e.target.id === 'settings-sheet') document.getElementById('settings-sheet').classList.add('hidden');
  });
  document.getElementById('tgl-sound').addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    setMuted(!state.settings.sound);
    save();
    sfxClick(); // silencieux si on vient de couper
    renderSettings();
  });
  document.getElementById('tgl-haptics').addEventListener('click', () => {
    state.settings.haptics = !state.settings.haptics;
    save();
    sfxClick();
    haptic();
    renderSettings();
  });
  // réinitialisation en deux temps
  let resetArmed = false, resetTimer = 0;
  document.getElementById('btn-reset').addEventListener('click', function () {
    sfxClick();
    if (!resetArmed) {
      resetArmed = true;
      this.textContent = 'Tout effacer ? Confirme !';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        resetArmed = false;
        this.textContent = 'Réinitialiser la progression';
      }, 3000);
      return;
    }
    try { localStorage.removeItem('maks_save_v1'); } catch (e) {}
    location.reload();
  });

  // — profil —
  document.getElementById('btn-profile').addEventListener('click', () => {
    sfxClick();
    renderProfile();
    document.getElementById('profile-sheet').classList.remove('hidden');
  });
  document.getElementById('profile-close').addEventListener('click', () => {
    sfxClick();
    document.getElementById('profile-sheet').classList.add('hidden');
    renderHub();
  });
  document.getElementById('profile-sheet').addEventListener('click', e => {
    if (e.target.id === 'profile-sheet') {
      document.getElementById('profile-sheet').classList.add('hidden');
      renderHub();
    }
  });
  document.getElementById('profile-input').addEventListener('change', function () {
    state.playerName = this.value.trim().slice(0, 12) || 'Toi';
    this.value = state.playerName;
    save();
  });

  // — garage / championnat —
  document.getElementById('btn-fight').addEventListener('click', () => {
    sfxClick();
    renderRoster();
    show('screen-roster');
  });
  document.getElementById('btn-quick').addEventListener('click', () => { sfxClick(); gauntlet = null; gotoVs(true); });
  document.getElementById('btn-roster-back').addEventListener('click', () => { sfxClick(); show('screen-hub'); });
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
    if (pendingQuick) show('screen-hub');
    else { renderRoster(); show('screen-roster'); }
  });
  document.getElementById('btn-vs-go').addEventListener('click', () => { sfxClick(); launchBattle(); });
  document.getElementById('btn-result-ok').addEventListener('click', () => {
    sfxClick();
    if (!pendingQuick) { renderRoster(); renderGarage(); show('screen-roster'); }
    else show('screen-hub');
  });
  // « Adversaire suivant » / « Revanche » / « Nouveau pari »
  document.getElementById('btn-next').addEventListener('click', function () {
    sfxClick();
    if (this.dataset.mode === 'bet') openBets();
    else gotoVs(pendingQuick, pendingOpponent); // vraie revanche : le MÊME adversaire
  });
  document.getElementById('btn-bet').addEventListener('click', () => { sfxClick(); openBets(); });
  document.getElementById('daily-banner').addEventListener('click', () => { sfxClick(); gotoDaily(); });
  document.getElementById('btn-bet-back').addEventListener('click', () => { sfxClick(); show('screen-hub'); });
  document.getElementById('btn-bet-shuffle').addEventListener('click', () => { sfxClick(); openBets(true); });
  document.getElementById('btn-bet-a').addEventListener('click', () => { sfxClick(); placeBet('a'); });
  document.getElementById('btn-bet-b').addEventListener('click', () => { sfxClick(); placeBet('b'); });

  // halo d'onboarding sur les boutons de combat tant qu'on n'a jamais combattu
  if (state.totalWins === 0) {
    document.getElementById('btn-fight').classList.add('attention');
    document.getElementById('hub-fight').classList.add('attention');
  }
  for (const id of ['btn-fight', 'hub-fight']) {
    document.getElementById(id).addEventListener('click', function once() {
      document.getElementById('btn-fight').classList.remove('attention');
      document.getElementById('hub-fight').classList.remove('attention');
    }, { once: true });
  }

  const firstGesture = () => {
    unlockAudio();
    // la musique ne peut démarrer qu'après un geste (règle iOS)
    if (!document.getElementById('screen-battle').classList.contains('hidden')) return;
    startMusic('menu');
  };
  window.addEventListener('touchstart', firstGesture, { once: true });
  window.addEventListener('mousedown', firstGesture, { once: true });
  // batterie/politesse : audio suspendu en arrière-plan + check de mise à jour
  document.addEventListener('visibilitychange', () => {
    handleVisibility();
    if (!document.hidden) navigator.serviceWorker?.getRegistration?.().then(r => r?.update()).catch(() => {});
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

// utile pour les tests automatisés et la génération d'icônes
window.__MAKS__ = { state, carSnapshot, buildLoadout, winRewards };
