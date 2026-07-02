// Catalogue des pièces, formules d'équilibrage et générateurs aléatoires.

export const BODIES = {
  classic: { name: 'Classique', hp: 140, energy: 6, weaponSlots: 2, gadgetSlots: 1, w: 150, h: 54, color: '#45a8ff' },
  titan:   { name: 'Titan',     hp: 210, energy: 5, weaponSlots: 1, gadgetSlots: 1, w: 128, h: 80, color: '#b06cff' },
  surfer:  { name: 'Surfeur',   hp: 145, energy: 6, weaponSlots: 2, gadgetSlots: 0, w: 190, h: 42, color: '#3ee07a' },
  whale:   { name: 'Baleine',   hp: 270, energy: 5, weaponSlots: 1, gadgetSlots: 1, w: 172, h: 66, color: '#ff9a3e' },
  pony:    { name: 'Poney',     hp: 125, energy: 8, weaponSlots: 2, gadgetSlots: 1, w: 118, h: 46, color: '#ff6c9c' },
};

export const WHEELS = {
  basic:  { name: 'Roue',         hp: 22, r: 21, speed: 1.0  },
  spiked: { name: 'Roue cloutée', hp: 38, r: 23, speed: 0.9  },
  big:    { name: 'Grande roue',  hp: 28, r: 29, speed: 1.05 },
  tiny:   { name: 'Roulette',     hp: 16, r: 15, speed: 1.28 },
};

// Cible d'équilibrage : mêlée ≈ 11-12 dégâts/s par point d'énergie,
// distance ≈ 4.8-5.4 (compensée par la portée).
export const WEAPONS = {
  blade:  { name: 'Lame',        kind: 'melee',  energy: 2, dps: 24, w: 64, h: 12 },
  saw:    { name: 'Scie',        kind: 'melee',  energy: 3, dps: 34, r: 26 },
  drill:  { name: 'Perceuse',    kind: 'melee',  energy: 3, dps: 32, w: 58, h: 20, push: true },
  stinger:{ name: 'Dard',        kind: 'melee',  energy: 2, dps: 22, w: 52, h: 10, up: true },
  rocket: { name: 'Roquettes',   kind: 'rocket', energy: 3, dmg: 36, cooldown: 2.3, w: 44, h: 18 },
  laser:  { name: 'Laser',       kind: 'laser',  energy: 4, dmg: 26, cooldown: 1.35, range: 560, w: 36, h: 18 },
  minigun:{ name: 'Mitrailleuse',kind: 'gun',    energy: 3, dmg: 4.5, cooldown: 0.28, range: 520, w: 42, h: 16 },
};

export const GADGETS = {
  booster:  { name: 'Booster',        energy: 1, desc: 'Propulsion vers l’avant' },
  backpedal:{ name: 'Rétrofusée',     energy: 1, desc: 'Garde ses distances' },
  repair:   { name: 'Kit de soin',    energy: 2, desc: '+3 PV / seconde', heal: 3 },
  armor:    { name: 'Blindage',       energy: 2, desc: '+20% PV max', hpBoost: 0.2 },
};

export const KIND_DEFS = { body: BODIES, wheel: WHEELS, weapon: WEAPONS, gadget: GADGETS };
export const KIND_LABEL = { body: 'Corps', wheel: 'Roue', weapon: 'Arme', gadget: 'Gadget' };

// Multiplicateur de puissance d'une pièce selon étoiles + niveau.
export function partMult(part) {
  return (1 + 0.35 * (part.stars - 1)) * (1 + 0.10 * (part.level - 1));
}
export function maxLevel(part) { return 1 + 5 * part.stars; } // 1★=6 … 5★=26
export function upgradeCost(part) {
  return Math.round(12 * Math.pow(part.level, 1.3) * (0.6 + 0.4 * part.stars));
}
// Recyclage : base par étoile + 50% des améliorations investies.
export function recycleValue(part) {
  let invested = 0;
  for (let l = 1; l < part.level; l++) {
    invested += Math.round(12 * Math.pow(l, 1.3) * (0.6 + 0.4 * part.stars));
  }
  return Math.round(25 * part.stars + invested * 0.5);
}

export function partDef(part) { return KIND_DEFS[part.kind][part.type]; }

// Statistiques affichables d'une pièce.
export function partStats(part) {
  const d = partDef(part), m = partMult(part), s = [];
  if (part.kind === 'body') {
    s.push(['PV', Math.round(d.hp * m)], ['Énergie', d.energy + Math.floor((part.stars - 1) / 2)],
           ['Armes', d.weaponSlots], ['Gadgets', d.gadgetSlots]);
  } else if (part.kind === 'wheel') {
    s.push(['PV', Math.round(d.hp * m)], ['Vitesse', 'x' + d.speed.toFixed(2)]);
  } else if (part.kind === 'weapon') {
    if (d.kind === 'melee') s.push(['Dégâts/s', Math.round(d.dps * m)]);
    else s.push(['Dégâts', Math.round(d.dmg * m)], ['Cadence', d.cooldown + 's']);
    s.push(['Coût ⚡', d.energy]);
  } else {
    s.push(['Effet', d.desc], ['Coût ⚡', d.energy]);
  }
  return s;
}

export function bodyEnergy(part) {
  return partDef(part).energy + Math.floor((part.stars - 1) / 2);
}

// ---- RNG avec graine (mulberry32) : les adversaires sont reproductibles ----
export function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// Ids uniques entre sessions (l'inventaire persiste en localStorage).
let uid = 0;
export function newPart(kind, type, stars = 1, level = 1) {
  const id = 'p' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) + '_' + (uid++);
  return { id, kind, type, stars, level };
}

// Étoiles aléatoires pondérées par l'étape du championnat.
export function rollStars(rng, stage) {
  const bonus = Math.min(stage * 0.045, 0.55);
  const r = rng();
  if (r < 0.04 + bonus * 0.25) return Math.min(5, 3 + Math.floor(rng() * 3));
  if (r < 0.22 + bonus) return 2;
  return 1;
}

export function randomPart(rng, stage, minStars = 1) {
  const kind = pick(rng, ['weapon', 'weapon', 'weapon', 'body', 'wheel', 'wheel', 'gadget']);
  const type = pick(rng, Object.keys(KIND_DEFS[kind]));
  const stars = Math.max(minStars, rollStars(rng, stage));
  const level = 1 + Math.floor(rng() * Math.min(stage, 6));
  return newPart(kind, type, stars, level);
}

// ---- Co-pilotes : un passif permanent + une capacité automatique par combat ----
export const COPILOTS = {
  ronron: {
    name: 'Ronron', color: 0xffd9a0, unlock: 0,
    passive: '+10% PV max', active: 'Soigne 30% des PV quand ils passent sous 35%',
  },
  tigrou: {
    name: 'Tigrou', color: 0xff9a3e, unlock: 1,
    passive: '+12% dégâts de mêlée', active: 'Frénésie : dégâts ×1,5 pendant 4 s au premier coup porté',
  },
  zigzag: {
    name: 'Zigzag', color: 0xb0b8d0, unlock: 2,
    passive: '+10% vitesse', active: 'Méga-boost au coup d’envoi',
  },
  pixel: {
    name: 'Pixel', color: 0x8f7bff, unlock: 3,
    passive: '+12% dégâts à distance', active: 'Surcharge : cadence de tir +40% à 30 s restantes',
  },
};

// ---- Ligues (par étape de championnat) ----
export const LEAGUES = [
  { name: 'Bois',    min: 1,  color: '#a9825a' },
  { name: 'Bronze',  min: 3,  color: '#d18a4e' },
  { name: 'Argent',  min: 6,  color: '#c9d4e8' },
  { name: 'Or',      min: 10, color: '#ffc93e' },
  { name: 'Diamant', min: 15, color: '#7ae0ff' },
  { name: 'Légende', min: 21, color: '#ff5d7a' },
];
export function leagueIndex(stage) {
  let i = 0;
  LEAGUES.forEach((l, k) => { if (stage >= l.min) i = k; });
  return i;
}

// ---- Peintures de châssis ----
export const PAINTS = [
  '#3f9bff', '#9a63ff', '#35d97c', '#ff8f31', '#ff5f9e',
  '#ff4b5e', '#ffc93e', '#4fd7ff', '#e8ecf8', '#39405c',
];

export const CAT_NAMES = [
  'Griffou', 'Moustache', 'Ronron', 'Félix le Fou', 'Patapouf', 'Tigrou',
  'Mistigri', 'Chaussette', 'Baron Miaou', 'Kitty Krash', 'Sir Poilu',
  'Grognon', 'Caramel', 'Ninja', 'Turbo-Chat', 'Le Parrain', 'Vandale',
  'Croquette', 'Zigzag', 'Pixel', 'Marquis Griffe', 'Boule de Nerfs',
];
