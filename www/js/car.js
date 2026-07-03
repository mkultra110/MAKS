// Géométrie logique des véhicules (source de vérité pour la physique ET les modèles 3D).
import { partDef, partMult } from './data.js';
import { computeCarStats } from './state.js';

// Construit la géométrie locale d'un véhicule orienté vers +x (unités : pixels physiques, y vers le bas).
export function buildCarSpec(lo) {
  const bDef = lo.body ? partDef(lo.body) : { w: 140, h: 50, color: '#888', name: '?' };
  const spec = {
    body: { w: bDef.w, h: bDef.h },
    wheels: [], weapons: [], gadgets: lo.gadgets.map(g => g.type),
    copilot: lo.copilot, // colore le chat de la cabine
    stats: computeCarStats(lo),
    loadout: lo,
  };
  const n = Math.max(lo.wheels.length, 1);
  lo.wheels.forEach((w, i) => {
    const d = partDef(w);
    const ox = n === 1 ? 0 : -bDef.w / 2 + bDef.w * (0.18 + 0.64 * (i / (n - 1)));
    spec.wheels.push({ type: w.type, part: w, r: d.r, ox, oy: bDef.h / 2 + 4, speed: d.speed });
  });
  lo.weapons.forEach((w, i) => {
    const d = partDef(w);
    const m = partMult(w);
    const base = { type: w.type, kind: d.kind, part: w, def: d, mult: m };
    if (w.type === 'saw') {
      spec.weapons.push({ ...base, shape: 'circle', r: d.r, ox: bDef.w / 2 + d.r - 8, oy: -4 });
    } else if (d.up) { // dard sur le toit
      spec.weapons.push({ ...base, shape: 'rect', w: d.w, h: d.h, ox: 6, oy: -bDef.h / 2 - d.w * 0.32, angle: -Math.PI / 3 });
    } else if (i === 0) { // avant
      spec.weapons.push({ ...base, shape: 'rect', w: d.w, h: d.h, ox: bDef.w / 2 + d.w / 2 - 8, oy: -2, angle: 0 });
    } else { // toit
      spec.weapons.push({ ...base, shape: 'rect', w: d.w, h: d.h, ox: 0, oy: -bDef.h / 2 - d.h / 2 + 2, angle: 0 });
    }
  });
  return spec;
}
