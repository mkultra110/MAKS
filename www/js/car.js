// Géométrie et dessin des véhicules (partagé entre garage, écran VS et combat).
import { partDef, partMult } from './data.js';
import { computeCarStats } from './state.js';

// Construit la géométrie locale d'un véhicule orienté vers +x.
export function buildCarSpec(lo) {
  const bDef = lo.body ? partDef(lo.body) : { w: 140, h: 50, color: '#888', name: '?' };
  const spec = {
    body: { w: bDef.w, h: bDef.h, color: bDef.color },
    wheels: [], weapons: [], gadgets: lo.gadgets.map(g => g.type),
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

// ---- Dessin ----
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCatFace(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffd9a0';
  // oreilles
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, -s * 0.4); ctx.lineTo(-s * 0.45, -s * 1.15); ctx.lineTo(-s * 0.1, -s * 0.6);
  ctx.moveTo(s * 0.7, -s * 0.4); ctx.lineTo(s * 0.45, -s * 1.15); ctx.lineTo(s * 0.1, -s * 0.6);
  ctx.fill();
  // tête
  ctx.beginPath(); ctx.arc(0, 0, s * 0.75, 0, Math.PI * 2); ctx.fill();
  // yeux
  ctx.fillStyle = '#22223a';
  ctx.beginPath(); ctx.arc(-s * 0.28, -s * 0.1, s * 0.12, 0, Math.PI * 2);
  ctx.arc(s * 0.28, -s * 0.1, s * 0.12, 0, Math.PI * 2); ctx.fill();
  // museau
  ctx.beginPath(); ctx.arc(0, s * 0.2, s * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#22223a'; ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, s * 0.25); ctx.lineTo(-s * 0.95, s * 0.15);
  ctx.moveTo(-s * 0.5, s * 0.38); ctx.lineTo(-s * 0.95, s * 0.42);
  ctx.moveTo(s * 0.5, s * 0.25); ctx.lineTo(s * 0.95, s * 0.15);
  ctx.moveTo(s * 0.5, s * 0.38); ctx.lineTo(s * 0.95, s * 0.42);
  ctx.stroke();
  ctx.restore();
}

export function drawWeapon(ctx, wp, t = 0) {
  ctx.save();
  ctx.translate(wp.ox, wp.oy);
  if (wp.angle) ctx.rotate(wp.angle);
  if (wp.type === 'saw') {
    ctx.rotate(t * 14);
    ctx.fillStyle = '#c8ccd8';
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.5) / teeth) * Math.PI * 2, a2 = ((i + 1) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * wp.r, Math.sin(a0) * wp.r);
      ctx.lineTo(Math.cos(a1) * (wp.r * 1.22), Math.sin(a1) * (wp.r * 1.22));
      ctx.lineTo(Math.cos(a2) * wp.r, Math.sin(a2) * wp.r);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a7f92';
    ctx.beginPath(); ctx.arc(0, 0, wp.r * 0.4, 0, Math.PI * 2); ctx.fill();
  } else if (wp.type === 'blade' || wp.type === 'stinger') {
    ctx.fillStyle = '#d7dbe8';
    ctx.beginPath();
    ctx.moveTo(-wp.w / 2, -wp.h / 2);
    ctx.lineTo(wp.w * 0.32, -wp.h / 2);
    ctx.lineTo(wp.w / 2, 0);
    ctx.lineTo(wp.w * 0.32, wp.h / 2);
    ctx.lineTo(-wp.w / 2, wp.h / 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a8fa4';
    ctx.fillRect(-wp.w / 2, -wp.h / 2, wp.w * 0.22, wp.h);
  } else if (wp.type === 'drill') {
    ctx.fillStyle = '#c8ccd8';
    ctx.beginPath();
    ctx.moveTo(-wp.w / 2, -wp.h / 2); ctx.lineTo(wp.w * 0.1, -wp.h / 2);
    ctx.lineTo(wp.w / 2, 0);
    ctx.lineTo(wp.w * 0.1, wp.h / 2); ctx.lineTo(-wp.w / 2, wp.h / 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a7f92'; ctx.lineWidth = 2;
    const ph = (t * 60) % 12;
    for (let x = -wp.w / 2 + 4 + ph % 12; x < wp.w * 0.35; x += 12) {
      ctx.beginPath(); ctx.moveTo(x, -wp.h / 2 + 2); ctx.lineTo(x + 6, wp.h / 2 - 2); ctx.stroke();
    }
  } else if (wp.type === 'rocket') {
    ctx.fillStyle = '#5a5f76';
    rr(ctx, -wp.w / 2, -wp.h / 2, wp.w, wp.h, 4); ctx.fill();
    ctx.fillStyle = '#ff5060';
    ctx.beginPath(); ctx.moveTo(wp.w / 2 - 2, -wp.h / 2 + 2); ctx.lineTo(wp.w / 2 + 8, 0); ctx.lineTo(wp.w / 2 - 2, wp.h / 2 - 2); ctx.fill();
  } else if (wp.type === 'laser') {
    ctx.fillStyle = '#5a5f76';
    rr(ctx, -wp.w / 2, -wp.h / 2, wp.w, wp.h, 5); ctx.fill();
    ctx.fillStyle = '#45e8ff';
    ctx.beginPath(); ctx.arc(wp.w / 2, 0, wp.h * 0.38, 0, Math.PI * 2); ctx.fill();
  } else if (wp.type === 'minigun') {
    ctx.fillStyle = '#5a5f76';
    rr(ctx, -wp.w / 2, -wp.h / 2, wp.w * 0.55, wp.h, 4); ctx.fill();
    ctx.fillStyle = '#9aa0b8';
    ctx.fillRect(-wp.w / 2 + wp.w * 0.5, -wp.h * 0.28, wp.w * 0.55, wp.h * 0.18);
    ctx.fillRect(-wp.w / 2 + wp.w * 0.5, wp.h * 0.1, wp.w * 0.55, wp.h * 0.18);
  }
  ctx.restore();
}

export function drawWheel(ctx, x, y, r, rot, type) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#2c2f3e';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  if (type === 'spiked') {
    ctx.fillStyle = '#2c2f3e';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.14) * r, Math.sin(a - 0.14) * r);
      ctx.lineTo(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5));
      ctx.lineTo(Math.cos(a + 0.14) * r, Math.sin(a + 0.14) * r);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#8f94aa';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2c2f3e'; ctx.lineWidth = Math.max(2, r * 0.14);
  for (let i = 0; i < 4; i++) {
    const a = rot * 0 + (i / 4) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); ctx.stroke();
  }
  ctx.restore();
}

// Dessine le châssis + armes dans le repère local du corps (face vers +x quand dir=1).
export function drawBodyLocal(ctx, spec, dir = 1, t = 0) {
  ctx.save();
  ctx.scale(dir, 1);
  const { w, h, color } = spec.body;
  // châssis
  ctx.fillStyle = color;
  rr(ctx, -w / 2, -h / 2, w, h, Math.min(12, h * 0.3)); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  rr(ctx, -w / 2, -h / 2, w, h * 0.4, Math.min(12, h * 0.3)); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,10,.4)'; ctx.lineWidth = 2.5;
  rr(ctx, -w / 2, -h / 2, w, h, Math.min(12, h * 0.3)); ctx.stroke();
  // fenêtre + chat pilote
  const ws = Math.min(h * 0.42, 22);
  ctx.fillStyle = 'rgba(20,24,50,.85)';
  ctx.beginPath(); ctx.arc(-w * 0.12, -h * 0.05, ws, 0, Math.PI * 2); ctx.fill();
  drawCatFace(ctx, -w * 0.12, -h * 0.05, ws * 0.72);
  // gadgets visibles à l'arrière
  if (spec.gadgets.includes('booster') || spec.gadgets.includes('backpedal')) {
    ctx.fillStyle = '#5a5f76';
    rr(ctx, -w / 2 - 14, -8, 16, 16, 3); ctx.fill();
    ctx.fillStyle = spec.gadgets.includes('booster') ? '#ffb020' : '#45e8ff';
    ctx.beginPath(); ctx.moveTo(-w / 2 - 14, -5); ctx.lineTo(-w / 2 - 24 - Math.sin(t * 30) * 4, 0); ctx.lineTo(-w / 2 - 14, 5); ctx.fill();
  }
  if (spec.gadgets.includes('repair')) {
    ctx.fillStyle = '#fff'; rr(ctx, w * 0.14, -h / 2 - 12, 18, 12, 3); ctx.fill();
    ctx.fillStyle = '#e04050';
    ctx.fillRect(w * 0.14 + 7, -h / 2 - 10, 4, 8); ctx.fillRect(w * 0.14 + 5, -h / 2 - 8, 8, 4);
  }
  if (spec.gadgets.includes('armor')) {
    ctx.strokeStyle = '#ffd060'; ctx.lineWidth = 3;
    rr(ctx, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 12); ctx.stroke();
  }
  // armes
  for (const wp of spec.weapons) drawWeapon(ctx, wp, t);
  ctx.restore();
}

// Pose statique (garage / VS) : les roues touchent le sol (y = cy).
export function drawCarStatic(ctx, spec, cx, cy, scale, dir = 1) {
  const maxR = Math.max(...spec.wheels.map(w => w.r), 20);
  ctx.save();
  ctx.translate(cx, cy - (spec.body.h / 2 + 4 + maxR) * scale);
  ctx.scale(scale, scale);
  for (const w of spec.wheels) {
    drawWheel(ctx, w.ox * dir, w.oy + (maxR - w.r), w.r, 0, w.type);
  }
  drawBodyLocal(ctx, spec, dir, 0);
  ctx.restore();
}

// Vignette d'une pièce seule (inventaire).
export function drawPartThumb(canvas, part) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const d = partDef(part);
  if (part.kind === 'body') {
    const s = Math.min(W / (d.w + 30), H / (d.h + 30));
    ctx.scale(s, s);
    drawBodyLocal(ctx, { body: { w: d.w, h: d.h, color: d.color }, weapons: [], gadgets: [] }, 1, 0);
  } else if (part.kind === 'wheel') {
    const s = Math.min(W, H) / (d.r * 2.6);
    ctx.scale(s, s);
    drawWheel(ctx, 0, 0, d.r, 0.5, part.type);
  } else if (part.kind === 'weapon') {
    const size = d.r ? d.r * 2.6 : d.w * 1.25;
    const s = Math.min(W / size, H / size) * (d.r ? 1 : 1.15);
    ctx.scale(s, s);
    drawWeapon(ctx, { ...d, type: part.type, ox: 0, oy: 0, angle: 0 }, 0.4);
  } else {
    ctx.font = Math.floor(H * 0.55) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const icons = { booster: '🚀', backpedal: '🔙', repair: '🩹', armor: '🛡️' };
    ctx.fillText(icons[part.type] || '🔧', 0, 0);
  }
  ctx.restore();
}
