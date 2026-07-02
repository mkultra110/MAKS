// Sauvegarde, inventaire, montage du véhicule, progression et adversaires.
import {
  BODIES, WHEELS, WEAPONS, GADGETS, partDef, partMult, bodyEnergy,
  newPart, seededRng, pick, randomPart, rollStars, CAT_NAMES,
  LEAGUES, leagueIndex, SETS,
} from './data.js';

const SAVE_KEY = 'maks_save_v1';
export const ROSTER_SIZE = 14;        // 14 adversaires par étape, comme dans CATS
export const MEDALS_TO_ADVANCE = 8;   // médailles pour être promu (top du classement)
export const FINAL_STAGE = 24;        // après l'étape 24 : PRESTIGE (reset + bonus permanent)

export const state = {
  coins: 0,
  stage: 1,
  medals: [],              // indices des adversaires battus à l'étape courante
  totalWins: 0,
  lastLeague: 0,           // indice de la dernière ligue célébrée
  prestige: 0,             // nombre de prestiges (bonus permanent +4%/prestige)
  dailyDone: '',           // date (AAAA-MM-JJ) du dernier Défi du jour réussi
  copilot: 'ronron',
  inventory: [],           // liste de pièces
  equipped: { body: null, wheels: [null, null], weapons: [], gadgets: [] }, // ids
};

// Bonus permanent de prestige appliqué à la machine du joueur.
export function prestigeBoost() {
  return 1 + (state.prestige || 0) * 0.04;
}

export function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* stockage privé iOS */ }
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {}
  if (raw) {
    try {
      const s = JSON.parse(raw);
      Object.assign(state, s);
      // normalisation défensive : une sauvegarde corrompue ne doit jamais bloquer le boot
      if (state.copilot === undefined) state.copilot = 'ronron';
      if (state.lastLeague === undefined) state.lastLeague = leagueIndex(state.stage);
      if (!Array.isArray(state.medals)) state.medals = [];
      if (!Number.isFinite(state.prestige)) state.prestige = 0;
      if (typeof state.dailyDone !== 'string') state.dailyDone = '';
      if (!Number.isFinite(state.coins) || state.coins < 0) state.coins = 0;
      if (!Number.isFinite(state.stage) || state.stage < 1) state.stage = 1;
      if (!Array.isArray(state.inventory)) throw new Error('inventory');
      state.inventory = state.inventory.filter(p =>
        p && typeof p === 'object' && p.id && KIND_DEFS_OK(p));
      const e = state.equipped;
      if (!e || typeof e !== 'object') throw new Error('equipped');
      const has = id => state.inventory.some(p => p.id === id);
      e.body = has(e.body) ? e.body : null;
      e.wheels = Array.isArray(e.wheels) ? e.wheels.map(id => (has(id) ? id : null)).slice(0, 2) : [null, null];
      while (e.wheels.length < 2) e.wheels.push(null);
      e.weapons = Array.isArray(e.weapons) ? e.weapons.filter(has) : [];
      e.gadgets = Array.isArray(e.gadgets) ? e.gadgets.filter(has) : [];
      if (!state.inventory.length) throw new Error('empty');
      return;
    } catch (e) {}
  }
  firstBoot();
}

function KIND_DEFS_OK(p) {
  const defs = { body: BODIES, wheel: WHEELS, weapon: WEAPONS, gadget: GADGETS }[p.kind];
  return !!(defs && defs[p.type]) && Number.isFinite(p.stars) && Number.isFinite(p.level);
}

function firstBoot() {
  state.coins = 60;
  const body = newPart('body', 'classic');
  const w1 = newPart('wheel', 'basic');
  const w2 = newPart('wheel', 'basic');
  const blade = newPart('weapon', 'blade');
  const rocket = newPart('weapon', 'rocket');
  const booster = newPart('gadget', 'booster');
  state.inventory = [body, w1, w2, blade, rocket, booster];
  state.equipped = { body: body.id, wheels: [w1.id, w2.id], weapons: [blade.id, rocket.id], gadgets: [booster.id] };
  save();
}

export function getPart(id) { return state.inventory.find(p => p.id === id) || null; }

export function isEquipped(id) {
  const e = state.equipped;
  return e.body === id || e.wheels.includes(id) || e.weapons.includes(id) || e.gadgets.includes(id);
}

// ---- Montage : transforme les ids équipés en "loadout" complet ----
export function buildLoadout() {
  const e = state.equipped;
  const body = getPart(e.body);
  return {
    body,
    wheels: e.wheels.map(getPart).filter(Boolean),
    weapons: e.weapons.map(getPart).filter(Boolean),
    gadgets: e.gadgets.map(getPart).filter(Boolean),
  };
}

// Statistiques de combat d'un loadout (joueur ou IA).
export function computeCarStats(lo) {
  const bDef = lo.body ? partDef(lo.body) : null;
  let hp = 0, atk = 0, used = 0;
  if (lo.body) hp += bDef.hp * partMult(lo.body);
  for (const w of lo.wheels) hp += partDef(w).hp * partMult(w);
  for (const w of lo.weapons) {
    const d = partDef(w), m = partMult(w);
    atk += (d.kind === 'melee' ? d.dps : d.dmg / d.cooldown) * m;
    used += d.energy;
  }
  let heal = 0, hasBooster = false, hasBackpedal = false;
  for (const g of lo.gadgets) {
    const d = partDef(g);
    used += d.energy;
    if (d.hpBoost) hp *= 1 + d.hpBoost;
    if (d.heal) heal += d.heal;
    if (g.type === 'booster') hasBooster = true;
    if (g.type === 'backpedal') hasBackpedal = true;
  }
  // bonus de set PV (les bonus melee/ranged/speed s'appliquent dans le combat)
  for (const s of activeSets(lo)) {
    if (s.active && s.bonus.hp) hp *= s.bonus.hp;
  }
  const capacity = lo.body ? bodyEnergy(lo.body) : 0;
  return { hp: Math.round(hp), atk: Math.round(atk), used, capacity, heal, hasBooster, hasBackpedal };
}

// État des sets pour un montage : nombre de types équipés par set.
export function activeSets(lo) {
  const types = new Set();
  if (lo.body) types.add(lo.body.type);
  for (const p of [...lo.wheels, ...lo.weapons, ...lo.gadgets]) {
    if (p) types.add(p.type);
  }
  return Object.entries(SETS).map(([key, s]) => {
    const count = s.parts.filter(t => types.has(t)).length;
    return { key, name: s.name, desc: s.desc, count, need: 3, active: count >= 3, bonus: s.bonus };
  });
}

export function loadoutValid(lo) {
  if (!lo.body || lo.wheels.length < 2 || lo.weapons.length < 1) return false;
  const s = computeCarStats(lo);
  return s.used <= s.capacity;
}

// ---- Équiper une pièce (échange automatique si nécessaire) ----
// Retourne la liste des ids éjectés (échange ou slots en moins), pour l'UI.
export function equip(part) {
  const e = state.equipped;
  const ejected = [];
  if (part.kind === 'body') {
    const before = [...e.weapons, ...e.gadgets];
    e.body = part.id;
    trimToSlots();
    for (const id of before) {
      if (!e.weapons.includes(id) && !e.gadgets.includes(id)) ejected.push(id);
    }
  } else if (part.kind === 'wheel') {
    if (e.wheels.includes(part.id)) return ejected;
    const idx = e.wheels[0] === null ? 0 : (e.wheels[1] === null ? 1 : 0);
    if (e.wheels[idx]) ejected.push(e.wheels[idx]);
    e.wheels[idx] = part.id;
  } else if (part.kind === 'weapon') {
    if (e.weapons.includes(part.id)) return ejected;
    const max = e.body ? partDef(getPart(e.body)).weaponSlots : 1;
    if (e.weapons.length >= max) ejected.push(e.weapons.shift());
    e.weapons.push(part.id);
  } else if (part.kind === 'gadget') {
    if (e.gadgets.includes(part.id)) return ejected;
    const max = e.body ? partDef(getPart(e.body)).gadgetSlots : 0;
    if (max === 0) return ejected;
    if (e.gadgets.length >= max) ejected.push(e.gadgets.shift());
    e.gadgets.push(part.id);
  }
  save();
  return ejected;
}

export function unequip(id) {
  const e = state.equipped;
  if (e.body === id) return; // le corps reste obligatoire
  e.wheels = e.wheels.map(w => (w === id ? null : w));
  e.weapons = e.weapons.filter(w => w !== id);
  e.gadgets = e.gadgets.filter(g => g !== id);
  save();
}

// Coupe les armes/gadgets excédentaires après changement de corps.
// NB : slice(-0) renverrait le tableau ENTIER, d'où les gardes > 0.
function trimToSlots() {
  const e = state.equipped;
  const b = getPart(e.body);
  if (!b) return;
  const d = partDef(b);
  e.weapons = d.weaponSlots > 0 ? e.weapons.slice(-d.weaponSlots) : [];
  e.gadgets = d.gadgetSlots > 0 ? e.gadgets.slice(-d.gadgetSlots) : [];
}

export function removePart(part) {
  unequip(part.id);
  if (state.equipped.body === part.id) state.equipped.body = null;
  // ne retire qu'UNE occurrence (défense contre d'éventuels ids dupliqués)
  const i = state.inventory.findIndex(p => p.id === part.id);
  if (i >= 0) state.inventory.splice(i, 1);
  save();
}

// ---- Génération d'adversaires (déterministe par étape/place dans le groupe) ----
// Chaque étape du championnat est un groupe de 14 « joueurs » : leur machine,
// leur nom et leur avatar sont reproductibles (comme des builds d'autres joueurs).
const AVATAR_COLORS = [0xffd9a0, 0xff9a3e, 0xb0b8d0, 0x8f7bff, 0xf4a9c8, 0x9adf9f, 0x7ad4e0, 0xd9c08a];

// Les étapes qui précèdent un changement de ligue se terminent par un BOSS
// (le 14e adversaire) : plus fort, mais sa victoire rapporte gros.
export function isBossStage(stage) {
  return leagueIndex(stage + 1) > leagueIndex(stage);
}

export function makeOpponent(stage, round, quick = false) {
  const seed = quick ? ((Date.now() & 0x7fffffff) ^ (round * 7919)) : (stage * 977 + round * 131 + 7);
  const rng = seededRng(seed);
  const boss = !quick && round === ROSTER_SIZE - 1 && isBossStage(stage);
  const prestigeMult = 1 + (state.prestige || 0) * 0.35; // adversaires plus féroces après un prestige
  const power = (1 + (stage - 1) * 0.13 + round * 0.03) * (boss ? 1.12 : 1) * prestigeMult;
  const mkLevel = () => Math.max(1, Math.round(1 + (stage - 1) * 0.6 + rng() * 2 - (quick ? 1 : 0)) + (boss ? 1 : 0));

  const bodyType = pick(rng, Object.keys(BODIES));
  const body = newPart('body', bodyType, rollStars(rng, stage), mkLevel());
  const bDef = BODIES[bodyType];

  const wheelType = pick(rng, Object.keys(WHEELS));
  const wheels = [
    newPart('wheel', wheelType, rollStars(rng, stage), mkLevel()),
    newPart('wheel', wheelType, rollStars(rng, stage), mkLevel()),
  ];

  const capacity = bDef.energy + Math.floor((body.stars - 1) / 2);
  const weapons = [], gadgets = [];
  let used = 0;
  const wTypes = Object.keys(WEAPONS).sort(() => rng() - 0.5);
  for (const t of wTypes) {
    if (weapons.length >= bDef.weaponSlots) break;
    if (used + WEAPONS[t].energy <= capacity) {
      weapons.push(newPart('weapon', t, rollStars(rng, stage), mkLevel()));
      used += WEAPONS[t].energy;
    }
  }
  if (bDef.gadgetSlots > 0 && rng() < 0.6) {
    const gTypes = Object.keys(GADGETS).filter(t => GADGETS[t].energy + used <= capacity);
    if (gTypes.length) {
      const t = pick(rng, gTypes);
      gadgets.push(newPart('gadget', t, 1, 1));
    }
  }
  const lo = { body, wheels, weapons, gadgets };
  const baseName = quick ? pick(rng, CAT_NAMES) : CAT_NAMES[(stage * 3 + round * 5) % CAT_NAMES.length];
  return {
    name: boss ? `👑 ${baseName} le Champion` : baseName,
    boss,
    avatar: AVATAR_COLORS[Math.floor(rng() * AVATAR_COLORS.length)],
    idx: quick ? null : round,
    loadout: lo,
    // anti « double-dip » : les PV scalent linéairement, les dégâts en racine —
    // sinon la puissance effective (PV × dégâts) explose en power².
    statBoost: Math.max(0.7, power * 0.78),
    dmgBoost: Math.max(0.75, Math.sqrt(power * 0.78)),
  };
}

// Le groupe complet des 14 adversaires de l'étape courante.
export function makeRoster(stage) {
  const roster = [];
  for (let i = 0; i < ROSTER_SIZE; i++) roster.push(makeOpponent(stage, i));
  return roster;
}

// ---- Bonus passifs du co-pilote ----
export function copilotMods(id) {
  switch (id) {
    case 'ronron': return { hp: 1.10, melee: 1, ranged: 1, speed: 1 };
    case 'tigrou': return { hp: 1, melee: 1.12, ranged: 1, speed: 1 };
    case 'zigzag': return { hp: 1, melee: 1, ranged: 1, speed: 1.10 };
    case 'pixel':  return { hp: 1, melee: 1, ranged: 1.12, speed: 1 };
    default: return { hp: 1, melee: 1, ranged: 1, speed: 1 };
  }
}

// ---- Récompenses ----
// opponentIdx : place de l'adversaire battu dans le groupe (championnat), null en combat rapide.
export function winRewards(quick, opponentIdx = null) {
  const stage = state.stage;
  let coins = quick
    ? Math.round(12 + stage * 5 + Math.random() * 10)
    : Math.round(25 + stage * 14 + Math.random() * 10);
  let part = null, extraParts = [], leagueUp = null, medal = false, promoted = false;
  if (!quick) {
    state.totalWins++;
    if (opponentIdx !== null && !state.medals.includes(opponentIdx)) {
      state.medals.push(opponentIdx);
      medal = true;
      // chaque médaille rapporte une pièce
      part = randomPart(seededRng((Date.now() & 0x7fffffff) ^ state.totalWins), stage);
      state.inventory.push(part);
    }
    if (state.medals.length >= MEDALS_TO_ADVANCE) {
      state.stage++;
      state.medals = [];
      promoted = true;
      coins += 50 + stage * 15; // prime de promotion
      // fin du championnat : PRESTIGE — retour à l'étape 1, bonus permanent
      if (state.stage > FINAL_STAGE) {
        state.prestige = (state.prestige || 0) + 1;
        state.stage = 1;
        state.lastLeague = 0;
        coins += 800;
        state.coins += coins;
        save();
        return { coins, part, extraParts, leagueUp: null, medal, promoted, prestiged: true };
      }
      // 2 pièces bonus avec plancher d'étoiles qui monte avec les étapes
      const floor = Math.min(5, 1 + Math.floor(stage / 3));
      for (let i = 0; i < 2; i++) {
        const p = randomPart(seededRng((Date.now() & 0x7fffffff) ^ (state.totalWins * 31 + i)), stage, floor);
        state.inventory.push(p);
        extraParts.push(p);
      }
      const li = leagueIndex(state.stage);
      if (li > state.lastLeague) {
        state.lastLeague = li;
        leagueUp = { ...LEAGUES[li], bonus: 60 * li };
        coins += leagueUp.bonus;
      }
    }
  }
  state.coins += coins;
  save();
  return { coins, part, extraParts, leagueUp, medal, promoted };
}

// Lot de consolation en cas de défaite.
export function defeatReward(quick) {
  const coins = quick ? 5 : Math.round((25 + 9 * state.stage) * 0.3);
  state.coins += coins;
  save();
  return coins;
}
