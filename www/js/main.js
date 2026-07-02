// Point d'entrée : navigation entre écrans et déroulé d'une partie.
import * as THREE from 'three';
import { partDef, upgradeCost, LEAGUES, leagueIndex, SETS, MUTATORS, seededRng, randomPart } from './data.js';
import {
  state, load, buildLoadout, computeCarStats, makeOpponent, makeRoster,
  winRewards, defeatReward, prestigeBoost, save, ROSTER_SIZE, MEDALS_TO_ADVANCE,
} from './state.js';
import { buildCarSpec } from './car.js';
import { createRenderer, createStudioScene, disposeModel } from './render3d.js';
import { createCarModel, poseCarStatic } from './models3d.js';
import { carSnapshot, partThumb, avatarThumb } from './thumbs.js';
import { initGarage, renderGarage, startPreview, stopPreview } from './garage.js';
import { startBattle } from './battle.js';
import { unlockAudio, handleVisibility, sfxClick, sfxWin, sfxLose, sfxMedal, sfxPromote } from './sfx.js';

// Vibrations : plugin Capacitor Haptics si présent (app native), sinon vibrate.
function haptic(style = 'MEDIUM') {
  try {
    const h = window.Capacitor?.Plugins?.Haptics;
    if (h) h.impact({ style });
    else navigator.vibrate?.(style === 'HEAVY' ? 60 : 25);
  } catch (e) {}
}

const PLAYER_NAME = 'Toi';
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
  if (id !== 'screen-splash') stopSplash();
  // iris wipe cartoon
  const iris = document.getElementById('iris');
  if (iris) {
    iris.classList.remove('play');
    void iris.offsetWidth;
    iris.classList.add('play');
  }
}

// ---------- écran d'accueil : vitrine 3D ----------
let splash = null;
function startSplash() {
  const canvas = document.getElementById('splash-canvas');
  const renderer = createRenderer(canvas);
  const scene = createStudioScene(renderer);
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
  // libère complètement le contexte WebGL de l'accueil (on n'y revient jamais)
  splash.scene.background?.dispose?.();
  disposeModel(splash.scene, { textures: true });
  splash.scene.clear();
  splash.renderer.dispose();
  splash.renderer.forceContextLoss?.();
  splash = null;
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
  // score du joueur pour situer la difficulté de chaque adversaire
  const ps = computeCarStats(buildLoadout());
  const playerScore = Math.max(1, ps.hp * ps.atk);
  for (const opp of roster) {
    const beaten = state.medals.includes(opp.idx);
    const os = computeCarStats(opp.loadout);
    const ratio = (os.hp * opp.statBoost * os.atk * opp.dmgBoost) / playerScore;
    const diff = opp.boss ? 'boss' : (ratio < 0.75 ? 'easy' : (ratio > 1.4 ? 'hard' : ''));
    const el = document.createElement('div');
    el.className = 'roster-card' + (beaten ? ' beaten' : '') + (diff ? ' ' + diff : '');
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

// ---------- Défi du jour : un combat à mutateur, une récompense 3★ par jour ----------
let pendingDaily = null;

function todayKey() { return new Date().toISOString().slice(0, 10); }
function dailyOfToday() {
  const day = todayKey();
  const seed = [...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0x7fffffff;
  const rng = seededRng(seed);
  const mutator = MUTATORS[Math.floor(rng() * MUTATORS.length)];
  const opponent = makeOpponent(state.stage, Math.floor(rng() * ROSTER_SIZE));
  return { day, mutator, opponent: { ...opponent, name: '🎯 ' + opponent.name, idx: null } };
}

function renderDailyBanner() {
  const el = document.getElementById('daily-banner');
  if (!el) return;
  el.classList.remove('hidden');
  if (state.dailyDone === todayKey()) {
    el.className = 'daily-banner done';
    el.textContent = '✓ Défi du jour réussi — reviens demain !';
  } else {
    const { mutator } = dailyOfToday();
    el.className = 'daily-banner';
    el.textContent = `🎯 Défi du jour : ${mutator.name} — gagne une pièce 3★ !`;
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
  document.getElementById('vs-me-name').textContent = PLAYER_NAME;
  document.getElementById('vs-me-stats').textContent = statLine(lo);
  document.getElementById('vs-them-name').textContent = daily.opponent.name;
  document.getElementById('vs-them-stats').textContent =
    `${daily.mutator.name} : ${daily.mutator.desc}`;
  show('screen-vs');
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
  for (const a of amounts) {
    const chip = document.createElement('button');
    chip.className = 'bet-chip' + (a === betAmount ? ' selected' : '');
    chip.textContent = a;
    chip.disabled = a > state.coins;
    chip.addEventListener('click', () => { sfxClick(); betAmount = a; openBets(false); });
    wrap.appendChild(chip);
  }
  const can = betAmount > 0 && betAmount <= state.coins;
  document.getElementById('btn-bet-a').disabled = !can;
  document.getElementById('btn-bet-b').disabled = !can;
  document.getElementById('btn-bet-a').textContent = `Parier ${betAmount} sur A`;
  document.getElementById('btn-bet-b').textContent = `Parier ${betAmount} sur B`;
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
  const winnerName = winnerA ? bet.a.name : bet.b.name;
  const title = document.getElementById('result-title');
  const btnNext = document.getElementById('btn-next');
  document.getElementById('reward-part').classList.add('hidden');
  document.getElementById('result-league').classList.add('hidden');
  document.getElementById('result-progress').classList.add('hidden');
  if (won) {
    const payout = Math.round(bet.amount * (bet.choice === 'a' ? bet.odds.a : bet.odds.b));
    state.coins += payout;
    save();
    sfxWin();
    title.textContent = 'PARI GAGNÉ !';
    title.className = 'result-title win';
    document.getElementById('result-sub').textContent = `${winnerName} l'emporte — tu empoches ${payout} pièces !`;
    countUp(document.getElementById('reward-coins'), payout);
  } else {
    sfxLose();
    title.textContent = 'PARI PERDU…';
    title.className = 'result-title lose';
    document.getElementById('result-sub').textContent = `${winnerName} l'emporte. Mise perdue (${bet.amount} pièces).`;
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
function gotoVs(quick, opponent = null) {
  pendingDaily = null;
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
    playerBoost: prestigeBoost(),
    opponent: pendingOpponent,
    copilot: state.copilot,
    themeIndex: leagueIndex(state.stage),
    mutator: pendingDaily ? pendingDaily.mutator : null,
    onEnd: onBattleEnd,
  });
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
  partEl.classList.add('hidden');
  leagueEl.classList.add('hidden');
  progressEl.classList.add('hidden');
  btnNext.classList.add('hidden');

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
    const bits = [`${beatenName} est K.O. !`];
    if (dailyPart) bits.push(`Défi « ${pendingDaily.mutator.name} » dans la poche !`);
    if (wasBoss) bits.push(`Boss vaincu : +${bossBonus} pièces bonus !`);
    if (gauntlet && gauntlet.fought > 0) bits.push(`Série du Grand Combat : ${gauntlet.fought + 1} victoires !`);
    if (r.medal) bits.push('Médaille prise !');
    if (r.prestiged) bits.push(`Championnat terminé ! Retour à l'étape 1 avec +4% de puissance permanente — les adversaires seront bien plus féroces.`);
    else if (r.promoted) bits.push(`Bienvenue à l'étape ${state.stage} !`);
    document.getElementById('result-sub').textContent = bits.join(' ');
    if (r.prestiged) {
      leagueEl.textContent = `PRESTIGE ⭐${state.prestige} — LÉGENDE VIVANTE !`;
      leagueEl.classList.remove('hidden');
    }
    if (!pendingQuick && !r.promoted) {
      progressEl.textContent = `🏅 ${state.medals.length}/${MEDALS_TO_ADVANCE} médailles vers la promotion`;
      progressEl.classList.remove('hidden');
      const next = nextUnbeaten();
      if (next) {
        pendingOpponent = next;
        btnNext.textContent = `⚔ Adversaire suivant : ${next.name}`;
        btnNext.classList.remove('hidden');
        btnNext.dataset.mode = '';
      }
    }
    const leagueUp = r.leagueUp || (gauntlet && gauntlet.leagueUp);
    if (leagueUp) {
      leagueEl.textContent = `NOUVELLE LIGUE : ${leagueUp.name.toUpperCase()} ! +${leagueUp.bonus} pièces`;
      leagueEl.classList.remove('hidden');
    }
    const totalCoins = r.coins + bossBonus + (gauntlet ? gauntlet.coins : 0);
    countUp(document.getElementById('reward-coins'), totalCoins);
    const shown = r.part || (r.extraParts && r.extraParts[0]);
    if (shown) {
      partEl.classList.remove('hidden');
      document.getElementById('reward-img').src = partThumb(shown);
      const extra = r.extraParts && r.extraParts.length > 1 ? ` (+${r.extraParts.length - (r.part ? 0 : 1)} autres !)` : '';
      // écho de collection : le drop appartient-il à un set ?
      const setOf = Object.values(SETS).find(s => s.parts.includes(shown.type));
      const setNote = setOf ? ` · Set ${setOf.name} !` : '';
      document.getElementById('reward-name').textContent =
        `${partDef(shown).name} ${'★'.repeat(shown.stars)} · niv. ${shown.level}${extra}${setNote}`;
    }
    document.getElementById('sunburst').classList.remove('hidden');
    show('screen-result');
    confetti();
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
    document.getElementById('reward-coins').textContent = '+' + coins;
    document.getElementById('sunburst').classList.add('hidden');
    if (!gauntlet) {
      btnNext.textContent = '🔄 Revanche !';
      btnNext.classList.remove('hidden');
      btnNext.dataset.mode = '';
    }
    show('screen-result');
  }
  gauntlet = null;
  pendingDaily = null;
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
  // « Adversaire suivant » / « Revanche » / « Nouveau pari »
  document.getElementById('btn-next').addEventListener('click', function () {
    sfxClick();
    if (this.dataset.mode === 'bet') openBets();
    else gotoVs(pendingQuick, pendingQuick ? null : pendingOpponent);
  });
  document.getElementById('btn-bet').addEventListener('click', () => { sfxClick(); openBets(); });
  document.getElementById('daily-banner').addEventListener('click', () => { sfxClick(); gotoDaily(); });
  document.getElementById('btn-bet-back').addEventListener('click', () => { sfxClick(); renderGarage(); show('screen-garage'); });
  document.getElementById('btn-bet-shuffle').addEventListener('click', () => { sfxClick(); openBets(true); });
  document.getElementById('btn-bet-a').addEventListener('click', () => { sfxClick(); placeBet('a'); });
  document.getElementById('btn-bet-b').addEventListener('click', () => { sfxClick(); placeBet('b'); });

  // halo d'onboarding sur le bouton championnat tant qu'on n'a jamais combattu
  if (state.totalWins === 0) document.getElementById('btn-fight').classList.add('attention');
  document.getElementById('btn-fight').addEventListener('click', function once() {
    this.classList.remove('attention');
  }, { once: true });

  window.addEventListener('touchstart', unlockAudio, { once: true });
  window.addEventListener('mousedown', unlockAudio, { once: true });
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
