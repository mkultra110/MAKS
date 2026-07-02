// Sauvegarde, inventaire, montage du véhicule, progression et adversaires.
import {
  BODIES, WHEELS, WEAPONS, GADGETS, partDef, partMult, bodyEnergy,
  newPart, seededRng, pick, randomPart, rollStars, CAT_NAMES,
  LEAGUES, leagueIndex,
} from './data.js';

const SAVE_KEY = 'maks_save_v1';
export const ROSTER_SIZE = 14;        // 14 adversaires par étape, comme dans CATS
export const MEDALS_TO_ADVANCE = 8;   // médailles pour être promu (top du classement)

export const state = {
  coins: 0,
  stage: 1,
  medals: [],              // indices des adversaires battus à l'étape courante
  totalWins: 0,
  lastLeague: 0,           // indice de la dernière ligue célébrée
  copilot: 'ronron',
  inventory: [],           // liste de pièces
  equipped: { body: null, wheels: [null, null], weapons: [], gadgets: [] }, // ids
};

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
      if (state.copilot === undefined) state.copilot = 'ronron';
      if (state.lastLeague === undefined) state.lastLeague = leagueIndex(state.stage);
      if (!Array.isArray(state.medals)) state.medals = [];
      return;
    } catch (e) {}
  }
  firstBoot();
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
  const capacity = lo.body ? bodyEnergy(lo.body) : 0;
  return { hp: Math.round(hp), atk: Math.round(atk), used, capacity, heal, hasBooster, hasBackpedal };
}

export function loadoutValid(lo) {
  if (!lo.body || lo.wheels.length < 2 || lo.weapons.length < 1) return false;
  const s = computeCarStats(lo);
  return s.used <= s.capacity;
}

// ---- Équiper une pièce (échange automatique si nécessaire) ----
export function equip(part) {
  const e = state.equipped;
  if (part.kind === 'body') {
    e.body = part.id;
    trimToSlots();
  } else if (part.kind === 'wheel') {
    const idx = e.wheels[0] === null ? 0 : (e.wheels[1] === null ? 1 : 0);
    if (e.wheels.includes(part.id)) return;
    e.wheels[idx] = part.id;
  } else if (part.kind === 'weapon') {
    if (e.weapons.includes(part.id)) return;
    const max = e.body ? partDef(getPart(e.body)).weaponSlots : 1;
    if (e.weapons.length >= max) e.weapons.shift();
    e.weapons.push(part.id);
  } else if (part.kind === 'gadget') {
    if (e.gadgets.includes(part.id)) return;
    const max = e.body ? partDef(getPart(e.body)).gadgetSlots : 0;
    if (max === 0) return;
    if (e.gadgets.length >= max) e.gadgets.shift();
    e.gadgets.push(part.id);
  }
  save();
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
function trimToSlots() {
  const e = state.equipped;
  const b = getPart(e.body);
  if (!b) return;
  const d = partDef(b);
  e.weapons = e.weapons.slice(-d.weaponSlots);
  e.gadgets = e.gadgets.slice(-d.gadgetSlots);
}

export function removePart(part) {
  unequip(part.id);
  if (state.equipped.body === part.id) state.equipped.body = null;
  state.inventory = state.inventory.filter(p => p.id !== part.id);
  save();
}

// ---- Génération d'adversaires (déterministe par étape/place dans le groupe) ----
// Chaque étape du championnat est un groupe de 14 « joueurs » : leur machine,
// leur nom et leur avatar sont reproductibles (comme des builds d'autres joueurs).
const AVATAR_COLORS = [0xffd9a0, 0xff9a3e, 0xb0b8d0, 0x8f7bff, 0xf4a9c8, 0x9adf9f, 0x7ad4e0, 0xd9c08a];

export function makeOpponent(stage, round, quick = false) {
  const seed = quick ? (Date.now() & 0x7fffffff) : (stage * 977 + round * 131 + 7);
  const rng = seededRng(seed);
  const power = 1 + (stage - 1) * 0.22 + round * 0.045;
  const mkLevel = () => Math.max(1, Math.round(1 + (stage - 1) * 0.9 + rng() * 2 - (quick ? 1 : 0)));

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
  return {
    name: quick ? pick(rng, CAT_NAMES) : CAT_NAMES[(stage * 3 + round * 5) % CAT_NAMES.length],
    avatar: AVATAR_COLORS[Math.floor(rng() * AVATAR_COLORS.length)],
    idx: quick ? null : round,
    loadout: lo,
    statBoost: Math.max(0.75, power * 0.72), // multiplicateur global IA
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
  let coins = Math.round((quick ? 12 : 20) + stage * (quick ? 5 : 9) + Math.random() * 10);
  let part = null, leagueUp = null, medal = false, promoted = false;
  if (!quick) {
    state.totalWins++;
    if (opponentIdx !== null && !state.medals.includes(opponentIdx)) {
      state.medals.push(opponentIdx);
      medal = true;
    }
    if (state.medals.length >= MEDALS_TO_ADVANCE) {
      state.stage++;
      state.medals = [];
      promoted = true;
      coins += 25 + stage * 6; // prime de promotion
      const li = leagueIndex(state.stage);
      if (li > state.lastLeague) {
        state.lastLeague = li;
        leagueUp = { ...LEAGUES[li], bonus: 60 * li };
        coins += leagueUp.bonus;
      }
    }
    // une pièce toutes les 2 victoires de championnat
    if (state.totalWins % 2 === 0) {
      part = randomPart(seededRng((Date.now() & 0x7fffffff) ^ state.totalWins), stage);
      state.inventory.push(part);
    }
  }
  state.coins += coins;
  save();
  return { coins, part, leagueUp, medal, promoted };
}
