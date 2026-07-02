// Catalogue des pièces, formules d'équilibrage et générateurs aléatoires.

export const BODIES = {
  classic: { name: 'Classique', hp: 130, energy: 6, weaponSlots: 2, gadgetSlots: 1, w: 150, h: 54, color: '#45a8ff' },
  titan:   { name: 'Titan',     hp: 210, energy: 5, weaponSlots: 1, gadgetSlots: 1, w: 128, h: 80, color: '#b06cff' },
  surfer:  { name: 'Surfeur',   hp: 155, energy: 7, weaponSlots: 2, gadgetSlots: 0, w: 190, h: 42, color: '#3ee07a' },
  whale:   { name: 'Baleine',   hp: 270, energy: 4, weaponSlots: 1, gadgetSlots: 1, w: 172, h: 66, color: '#ff9a3e' },
  pony:    { name: 'Poney',     hp: 95,  energy: 8, weaponSlots: 2, gadgetSlots: 1, w: 118, h: 46, color: '#ff6c9c' },
};

export const WHEELS = {
  basic:  { name: 'Roue',         hp: 22, r: 21, speed: 1.0  },
  spiked: { name: 'Roue cloutée', hp: 38, r: 23, speed: 0.9  },
  big:    { name: 'Grande roue',  hp: 28, r: 29, speed: 1.15 },
  tiny:   { name: 'Roulette',     hp: 13, r: 15, speed: 1.28 },
};

export const WEAPONS = {
  blade:  { name: 'Lame',        kind: 'melee',  energy: 2, dps: 24, w: 64, h: 12 },
  saw:    { name: 'Scie',        kind: 'melee',  energy: 3, dps: 34, r: 26 },
  drill:  { name: 'Perceuse',    kind: 'melee',  energy: 3, dps: 28, w: 58, h: 20, push: true },
  stinger:{ name: 'Dard',        kind: 'melee',  energy: 2, dps: 19, w: 52, h: 10, up: true },
  rocket: { name: 'Roquettes',   kind: 'rocket', energy: 3, dmg: 30, cooldown: 2.3, w: 44, h: 18 },
  laser:  { name: 'Laser',       kind: 'laser',  energy: 4, dmg: 17, cooldown: 1.35, range: 560, w: 36, h: 18 },
  minigun:{ name: 'Mitrailleuse',kind: 'gun',    energy: 3, dmg: 6, cooldown: 0.28, range: 520, w: 42, h: 16 },
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
  return Math.round(15 * Math.pow(part.level, 1.5) * (0.6 + 0.4 * part.stars));
}
export function recycleValue(part) {
  return Math.round(12 * part.stars + 4 * (part.level - 1));
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

let uid = Date.now() % 100000;
export function newPart(kind, type, stars = 1, level = 1) {
  return { id: 'p' + (uid++) + '_' + Math.floor(Math.random() * 9999), kind, type, stars, level };
}

// Étoiles aléatoires pondérées par l'étape du championnat.
export function rollStars(rng, stage) {
  const bonus = Math.min(stage * 0.045, 0.55);
  const r = rng();
  if (r < 0.04 + bonus * 0.25) return Math.min(5, 3 + Math.floor(rng() * 3));
  if (r < 0.22 + bonus) return 2;
  return 1;
}

export function randomPart(rng, stage) {
  const kind = pick(rng, ['weapon', 'weapon', 'weapon', 'body', 'wheel', 'wheel', 'gadget']);
  const type = pick(rng, Object.keys(KIND_DEFS[kind]));
  const stars = rollStars(rng, stage);
  const level = 1 + Math.floor(rng() * Math.min(stage, 6));
  return newPart(kind, type, stars, level);
}

export const CAT_NAMES = [
  'Griffou', 'Moustache', 'Ronron', 'Félix le Fou', 'Patapouf', 'Tigrou',
  'Mistigri', 'Chaussette', 'Baron Miaou', 'Kitty Krash', 'Sir Poilu',
  'Grognon', 'Caramel', 'Ninja', 'Turbo-Chat', 'Le Parrain', 'Vandale',
  'Croquette', 'Zigzag', 'Pixel', 'Marquis Griffe', 'Boule de Nerfs',
];
