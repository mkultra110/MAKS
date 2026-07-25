// Modèles 3D procéduraux : véhicules, pièces, arène, effets.
// DA « SAMEDI MATIN » : cel-shading, aplats saturés, encre #26183A.
import * as THREE from 'three';
import { partDef, COPILOTS } from './data.js';
import { toonGradient, outlineForGroup, makeBlobShadow, INK } from './render3d.js';

export const S = 0.02; // 50 px physiques = 1 unité 3D

// ---------- matériaux partagés (tous en toon, le PBR est banni) ----------
const MATS = {};
export function mat(key, opts) {
  if (!MATS[key]) {
    MATS[key] = new THREE.MeshToonMaterial({
      color: opts.color,
      transparent: opts.transparent || false,
      opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      gradientMap: toonGradient((opts.metalness ?? 0) > 0.6),
    });
    MATS[key].userData.shared = true; // jamais disposé (cache global)
  }
  return MATS[key];
}
export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}
const METAL = () => mat('metal', { color: 0xE8EEF8, metalness: 0.85 });
const METAL_DARK = () => mat('metalDark', { color: 0x3A3160 });
const TIRE = () => mat('tire', { color: 0x33305C });
const RIM = () => mat('rim', { color: 0xfff6e0 });
const CREAM = () => mat('cream', { color: 0xFFF6E0 });
const WOOD = () => mat('wood', { color: 0xB5793C });
const PINK = () => mat('catPink', { color: 0xFF7AB8 });

// Vibreur rouge/crème répétable (bords de piste, crêtes de collines).
const KERB_TEX = {};
export function kerbTexture(repeatX = 8) {
  const key = Math.round(repeatX);
  if (KERB_TEX[key]) return KERB_TEX[key];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#FF4D5E'; x.fillRect(0, 0, 64, 32);
  x.fillStyle = '#FFF6E0'; x.fillRect(64, 0, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(key, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  KERB_TEX[key] = tex;
  return tex;
}

// Étoile autocollante à contour d'encre (casque du pilote).
let STAR_DECAL = null;
function helmetStarTexture() {
  if (STAR_DECAL) return STAR_DECAL;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  x.fillStyle = '#FFF6E0';
  x.strokeStyle = '#26183A';
  x.lineWidth = 8;
  x.lineJoin = 'round';
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? 24 : 54;
    x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  x.closePath();
  x.fill(); x.stroke();
  STAR_DECAL = new THREE.CanvasTexture(c);
  STAR_DECAL.colorSpace = THREE.SRGBColorSpace;
  STAR_DECAL.userData.shared = true;
  return STAR_DECAL;
}

// ---------- géométrie : boîte arrondie (extrusion d'un rectangle arrondi) ----------
const GEO_CACHE = {};
export function roundedBox(w, h, d, r) {
  const key = `rb:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}:${r.toFixed(2)}`;
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const bevel = Math.min(r * 0.6, d * 0.25);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
  });
  geo.translate(0, 0, -(d - bevel * 2) / 2);
  geo.userData.shared = true; // cache global, jamais disposé
  GEO_CACHE[key] = geo;
  return geo;
}

// ---------- silhouettes de châssis : un profil latéral distinct par type ----------
// x = avant, y = haut ; fractions du volume (bw × bh*1.55), extrudées sur la profondeur.
const BODY_PROFILES = {
  classic: (s, w, h) => { // berline à museau plongeant + bulle cabine
    s.moveTo(-.5 * w, -.28 * h); s.lineTo(-.5 * w, .08 * h); s.lineTo(-.36 * w, .10 * h);
    s.quadraticCurveTo(-.18 * w, .30 * h, .02 * w, .30 * h);
    s.quadraticCurveTo(.22 * w, .12 * h, .5 * w, .02 * h);
    s.lineTo(.5 * w, -.28 * h);
  },
  titan: (s, w, h) => { // camion à cabine haute, épaules carrées
    s.moveTo(-.5 * w, -.30 * h); s.lineTo(-.5 * w, .26 * h); s.lineTo(-.30 * w, .26 * h);
    s.lineTo(-.26 * w, .38 * h); s.lineTo(.10 * w, .38 * h); s.lineTo(.16 * w, .26 * h);
    s.lineTo(.44 * w, .22 * h); s.lineTo(.5 * w, -.02 * h); s.lineTo(.5 * w, -.30 * h);
  },
  surfer: (s, w, h) => { // goutte d'eau basse et longue
    s.moveTo(-.5 * w, -.24 * h); s.lineTo(-.48 * w, .02 * h);
    s.quadraticCurveTo(-.2 * w, .16 * h, .1 * w, .14 * h);
    s.quadraticCurveTo(.4 * w, .06 * h, .5 * w, -.06 * h);
    s.lineTo(.5 * w, -.24 * h);
  },
  whale: (s, w, h) => { // ventre rond, dos bombé
    s.moveTo(-.5 * w, -.26 * h);
    s.quadraticCurveTo(-.52 * w, .18 * h, -.3 * w, .30 * h);
    s.quadraticCurveTo(.15 * w, .34 * h, .38 * w, .14 * h);
    s.quadraticCurveTo(.52 * w, -.04 * h, .5 * w, -.26 * h);
  },
  pony: (s, w, h) => { // citadine compacte au toit bulle
    s.moveTo(-.5 * w, -.26 * h); s.lineTo(-.5 * w, .14 * h);
    s.quadraticCurveTo(-.34 * w, .34 * h, -.02 * w, .34 * h);
    s.quadraticCurveTo(.3 * w, .20 * h, .5 * w, .00 * h);
    s.lineTo(.5 * w, -.26 * h);
  },
};

function bodyGeometry(type, bw, bh, depth) {
  const key = `body:${type}:${bw.toFixed(2)}:${bh.toFixed(2)}:${depth.toFixed(2)}`;
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  const prof = BODY_PROFILES[type];
  if (!prof) return roundedBox(bw, bh, depth, Math.min(bh * 0.3, 0.24));
  const shape = new THREE.Shape();
  prof(shape, bw, bh * 1.55);
  shape.closePath();
  const bevel = Math.min(0.2, depth * 0.28); // flancs gonflés : jouet en plastique épais
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  geo.userData.shared = true;
  GEO_CACHE[key] = geo;
  return geo;
}

// ---------- tête de chat pilote ----------
export function catHead(size = 0.28, color = 0xffd9a0) {
  const g = new THREE.Group();
  const skin = mat('catSkin' + color, { color, emissive: color, emissiveIntensity: 0.1 });
  const dark = mat('catDark', { color: 0x2a2438, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(size, 18, 14), skin);
  g.add(head);
  // oreilles + intérieur rose bonbon
  const earGeo = new THREE.ConeGeometry(size * 0.40, size * 0.72, 4);
  const earInGeo = new THREE.ConeGeometry(size * 0.22, size * 0.40, 4);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.position.set(sx * size * 0.55, size * 0.82, 0);
    ear.rotation.z = -sx * 0.35;
    g.add(ear);
    const inner = new THREE.Mesh(earInGeo, PINK());
    inner.position.set(sx * size * 0.55, size * 0.82, size * 0.06);
    inner.rotation.z = -sx * 0.35;
    g.add(inner);
  }
  // grands yeux + reflets blancs (exclus du contour, sinon l'encre les mange)
  const eyeGeo = new THREE.SphereGeometry(size * 0.22, 8, 8);
  const glintGeo = new THREE.SphereGeometry(size * 0.07, 6, 5);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, dark);
    eye.position.set(sx * size * 0.36, size * 0.10, size * 0.80);
    g.add(eye);
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(sx * size * 0.42, size * 0.16, size * 0.98);
    glint.userData.noOutline = true;
    glint.userData.noShadow = true;
    g.add(glint);
  }
  // joues roses
  const cheekGeo = new THREE.SphereGeometry(size * 0.13, 8, 6);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, PINK());
    cheek.scale.set(1, 0.7, 0.5);
    cheek.position.set(sx * size * 0.62, -size * 0.10, size * 0.72);
    g.add(cheek);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(size * 0.09, 8, 8), dark);
  nose.position.set(0, size * -0.18, size * 0.92);
  g.add(nose);
  // sourire à l'encre
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.16, size * 0.035, 6, 10, Math.PI),
    new THREE.MeshBasicMaterial({ color: INK })
  );
  smile.rotation.z = Math.PI;
  smile.position.set(0, -size * 0.34, size * 0.86);
  smile.userData.noOutline = true;
  smile.userData.noShadow = true;
  g.add(smile);
  return g;
}

// ---------- mascotte : le chat entier, assis, pour le hub ----------
// userData : { head, tail, body } pour l'animation idle (12 fps) côté main.js.
export function catMascot(color = 0xffd9a0) {
  const g = new THREE.Group();
  const skin = mat('catSkin' + color, { color, emissive: color, emissiveIntensity: 0.1 });
  const cream = mat('catBelly', { color: 0xfff6e0 });
  const stripeMat = toonMat(new THREE.Color(color).multiplyScalar(0.82));

  // corps poire (Lathe) — c'est LUI que main.js fait respirer (userData.body)
  const pts = [[0.001, 0], [0.30, 0.02], [0.40, 0.16], [0.36, 0.40], [0.20, 0.62], [0.10, 0.70]]
    .map(([px, py]) => new THREE.Vector2(px, py));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), skin);
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.30, 12, 10), cream);
  belly.scale.set(0.78, 0.95, 0.42);
  belly.position.set(0, 0.34, 0.22);
  g.add(belly);
  // rayures de dos
  for (const [i, ry] of [[0, 0.25], [1, 0.45]]) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.37 - i * 0.03, 0.035, 6, 10, Math.PI * 0.55), stripeMat);
    stripe.position.y = ry;
    stripe.rotation.x = Math.PI / 2;
    stripe.rotation.z = Math.PI * 0.72; // arc côté dos (-z)
    g.add(stripe);
  }

  // pattes avant + pieds à coussinets
  const pawGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const padMat = new THREE.MeshBasicMaterial({ color: 0xFF7AB8 });
  for (const sx of [-1, 1]) {
    const paw = new THREE.Mesh(pawGeo, skin);
    paw.position.set(sx * 0.24, 0.14, 0.3);
    paw.scale.set(1, 1.35, 1);
    g.add(paw);
    const foot = new THREE.Mesh(pawGeo, cream);
    foot.position.set(sx * 0.26, 0.09, 0.34);
    foot.scale.set(0.9, 0.55, 1.1);
    foot.rotation.x = 0.9;
    g.add(foot);
    // grand coussinet + 3 orteils (dessinés, exclus du contour)
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), padMat);
    pad.scale.set(1, 0.55, 0.8);
    pad.position.set(sx * 0.26, 0.10, 0.43);
    pad.userData.noOutline = true;
    pad.userData.noShadow = true;
    g.add(pad);
    for (let t = 0; t < 3; t++) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), padMat);
      toe.position.set(sx * 0.26 + (t - 1) * 0.045, 0.155, 0.44);
      toe.userData.noOutline = true;
      toe.userData.noShadow = true;
      g.add(toe);
    }
  }

  // tête bébé (45% du bonhomme) : sous-groupe animé → contour séparé
  const head = catHead(0.36, color);
  head.scale.set(1.12, 1, 1.02);
  head.position.y = 1.05;
  head.userData.skipInParentOutline = true;
  const headOutline = outlineForGroup(head, 0.02);
  if (headOutline) head.add(headOutline);
  g.add(head);

  // queue expressive : 7 segments en S, pivot à la base pour le balancement
  const tail = new THREE.Group();
  tail.position.set(0, 0.20, -0.30);
  const segGeo = new THREE.SphereGeometry(0.105, 10, 8);
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Mesh(segGeo, i === 6 ? cream : skin);
    seg.scale.setScalar(1 - i * 0.08);
    seg.position.set(
      Math.sin(i * 0.9) * 0.05,
      Math.sin(i / 6 * 2.1) * 0.5,
      -Math.cos(i / 6 * 2.1) * 0.42 - 0.04
    );
    tail.add(seg);
  }
  tail.userData.skipInParentOutline = true;
  const tailOutline = outlineForGroup(tail, 0.016);
  if (tailOutline) tail.add(tailOutline);
  g.add(tail);

  const outline = outlineForGroup(g, 0.022);
  if (outline) g.add(outline);
  g.userData = { head, tail, body };
  return g;
}

// ---------- armes ----------
// Visage espiègle de la scie (deux faces du disque).
let SAW_FACE = null;
function sawFaceTexture() {
  if (SAW_FACE) return SAW_FACE;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#26183A';
  for (const [ex, tilt] of [[44, -0.35], [84, 0.35]]) {
    x.save();
    x.translate(ex, 56);
    x.rotate(tilt);
    x.beginPath();
    x.ellipse(0, 0, 8, 12, 0, 0, 7);
    x.fill();
    x.restore();
  }
  x.strokeStyle = '#26183A';
  x.lineWidth = 10;
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(34, 78);
  x.quadraticCurveTo(64, 96, 94, 84);
  x.stroke();
  x.fillStyle = '#ffffff';
  for (const tx of [48, 64, 80]) {
    x.beginPath();
    x.moveTo(tx - 5, 84); x.lineTo(tx + 5, 84); x.lineTo(tx, 94);
    x.closePath();
    x.fill();
  }
  SAW_FACE = new THREE.CanvasTexture(c);
  SAW_FACE.colorSpace = THREE.SRGBColorSpace;
  SAW_FACE.userData.shared = true;
  return SAW_FACE;
}
// Rayures diagonales de la perceuse (fond OPAQUE : le transparent rend noir en toon).
let DRILL_MAT = null;
function drillMat() {
  if (DRILL_MAT) return DRILL_MAT;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#FFB800';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#FFF6E0';
  x.save();
  x.translate(64, 64);
  x.rotate(Math.PI / 4);
  for (let i = -4; i < 5; i++) x.fillRect(i * 32 - 8, -128, 16, 256);
  x.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  DRILL_MAT = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: tex });
  DRILL_MAT.userData.shared = true;
  return DRILL_MAT;
}
function weaponModel(wp) {
  const g = new THREE.Group();
  const anim = { spin: [], axis: 'z' };
  const w = (wp.w || 0) * S, h = (wp.h || 0) * S, r = (wp.r || 0) * S;

  if (wp.type === 'saw') {
    const disc = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.09, 24), CREAM());
    plate.rotation.x = Math.PI / 2;
    disc.add(plate);
    const toothGeo = new THREE.ConeGeometry(r * 0.16, r * 0.42, 4);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tooth = new THREE.Mesh(toothGeo, METAL());
      tooth.position.set(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08, 0);
      tooth.rotation.z = a - Math.PI / 2 - 0.5;
      disc.add(tooth);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.46, r * 0.46, 0.13, 16), mat('sawHub', { color: 0xFF4D5E }));
    hub.rotation.x = Math.PI / 2;
    disc.add(hub);
    // le visage espiègle, sur les deux faces
    for (const fz of [0.075, -0.075]) {
      const faceMesh = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.4, 20),
        new THREE.MeshBasicMaterial({ map: sawFaceTexture(), transparent: true })
      );
      faceMesh.position.z = fz;
      if (fz < 0) faceMesh.rotation.y = Math.PI;
      faceMesh.userData.noShadow = true;
      disc.add(faceMesh);
    }
    // la scie tourne : son contour tourne avec elle (exclue du contour parent)
    disc.userData.skipInParentOutline = true;
    const discOutline = outlineForGroup(disc, 0.016);
    if (discOutline) disc.add(discOutline);
    // disque de flou de rotation
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(r * 1.28, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
    );
    blur.userData.noShadow = true;
    blur.name = 'spinblur';
    blur.visible = false; // seulement quand ça tourne (combat)
    g.add(blur);
    g.add(disc);
    anim.spin.push(disc);
  } else if (wp.type === 'blade' || wp.type === 'stinger') {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, -h / 2); shape.lineTo(w * 0.28, -h / 2);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w * 0.28, h / 2); shape.lineTo(-w / 2, h / 2);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
    geo.translate(0, 0, -0.0275);
    g.add(new THREE.Mesh(geo, METAL()));
    const guard = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 1.5, 0.14), mat('guardPow', { color: 0xFF4D5E }));
    guard.position.x = -w / 2 + w * 0.1;
    g.add(guard);
  } else if (wp.type === 'drill') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.62, w, 14), drillMat());
    cone.rotation.z = -Math.PI / 2;
    g.add(cone);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.5, h * 0.55, 0.22, 12), METAL_DARK());
    base.rotation.z = Math.PI / 2;
    base.position.x = -w / 2;
    g.add(base);
    anim.spin.push(cone); anim.axis = 'x';
  } else if (wp.type === 'rocket') {
    for (const dy of [-h * 0.28, h * 0.28]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.3, h * 0.3, w, 12), mat('tubeGo', { color: 0x2FD573 }));
      tube.rotation.z = Math.PI / 2;
      tube.position.y = dy;
      g.add(tube);
      const ringR = new THREE.Mesh(new THREE.TorusGeometry(h * 0.32, 0.02, 6, 12), CREAM());
      ringR.rotation.y = Math.PI / 2;
      ringR.position.set(w / 2, dy, 0);
      g.add(ringR);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(h * 0.24, 0.16, 10),
        mat('rocketTip', { color: 0xff4b5e, roughness: 0.4, metalness: 0.2 }));
      tip.rotation.z = -Math.PI / 2;
      tip.position.set(w / 2 + 0.07, dy, 0);
      g.add(tip);
    }
  } else if (wp.type === 'laser') {
    const box = new THREE.Mesh(roundedBox(w, h, h * 1.1, h * 0.2), mat('prune', { color: 0xA66CFF }));
    g.add(box);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(h * 0.42, 12, 10),
      mat('laserLens', { color: 0x53e8ff, emissive: 0x2fd4ff, emissiveIntensity: 2.2, roughness: 0.2 }));
    lens.position.x = w / 2;
    g.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h * 0.46, 0.02, 6, 16), METAL());
    ring.rotation.y = Math.PI / 2;
    ring.position.x = w / 2 - 0.02;
    g.add(ring);
  } else if (wp.type === 'minigun') {
    const body = new THREE.Mesh(roundedBox(w * 0.5, h, h, h * 0.2), mat('cyanBody', { color: 0x49C4F0 }));
    body.position.x = -w * 0.25;
    g.add(body);
    const barrels = new THREE.Group();
    const bGeo = new THREE.CylinderGeometry(0.03, 0.03, w * 0.72, 8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const barrel = new THREE.Mesh(bGeo, METAL());
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(w * 0.3, Math.cos(a) * 0.055, Math.sin(a) * 0.055);
      barrels.add(barrel);
    }
    g.add(barrels);
    // disque de flou des canons
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })
    );
    blur.rotation.y = Math.PI / 2;
    blur.position.x = w * 0.66;
    blur.userData.noShadow = true;
    blur.name = 'spinblur';
    blur.visible = false;
    g.add(blur);
    anim.spin.push(barrels); anim.axis = 'x';
  } else if (wp.type === 'hammer') {
    // masse : long manche + tête parallélépipédique cerclée
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.15, h * 0.18, w * 0.78, 8), WOOD());
    handle.rotation.z = Math.PI / 2;
    handle.position.x = -w * 0.11;
    g.add(handle);
    const head = new THREE.Mesh(roundedBox(w * 0.34, h * 1.9, h * 1.5, h * 0.16), mat('prune', { color: 0xA66CFF }));
    head.position.x = w / 2 - w * 0.17;
    g.add(head);
    // cerclages sombres qui dessinent le contour de la tête
    for (const dx of [-w * 0.1, w * 0.1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.05, h * 1.96, h * 1.56), CREAM());
      band.position.x = w / 2 - w * 0.17 + dx;
      g.add(band);
    }
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(h * 0.24, 8, 8), mat('sunBall', { color: 0xFFB800 }));
    pommel.position.x = -w / 2;
    g.add(pommel);
  } else if (wp.type === 'shotgun') {
    // tromblon : crosse + canon court évasé vers l'avant
    const stock = new THREE.Mesh(roundedBox(w * 0.42, h, h, h * 0.2), WOOD());
    stock.position.x = -w * 0.26;
    g.add(stock);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.28, h * 0.32, w * 0.46, 10), METAL());
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x = w * 0.04;
    g.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.62, h * 0.3, w * 0.3, 12), mat('sunBall', { color: 0xFFB800 }));
    muzzle.rotation.z = -Math.PI / 2; // s'évase vers +x
    muzzle.position.x = w / 2 - w * 0.13;
    g.add(muzzle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h * 0.62, 0.02, 6, 14), METAL_DARK());
    ring.rotation.y = Math.PI / 2;
    ring.position.x = w / 2 + 0.01;
    g.add(ring);
  } else if (wp.type === 'mortar') {
    // mortier : tube trapu incliné vers le ciel + socle
    const barrel = new THREE.Group();
    barrel.rotation.z = -0.65;
    barrel.position.set(-w * 0.06, h * 0.2, 0);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.44, h * 0.52, w * 0.9, 12), mat('tubeGo', { color: 0x2FD573 }));
    barrel.add(tube);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(h * 0.46, 0.03, 6, 14), CREAM());
    mouth.rotation.x = Math.PI / 2;
    mouth.position.y = w * 0.45;
    barrel.add(mouth);
    g.add(barrel);
    const base = new THREE.Mesh(roundedBox(w * 0.52, h * 0.5, h * 1.2, h * 0.12), METAL());
    base.position.y = -h * 0.32;
    g.add(base);
  }
  g.userData.anim = anim;
  return g;
}

// Pulsation de la lentille laser (matériau partagé : un seul appel par frame).
export function pulseLaserLens(t) {
  const m = MATS['laserLens'];
  if (m) m.emissiveIntensity = 1.9 + Math.sin(t * 7) * 0.9;
}

// ---------- roue ----------
// Cache d'une géométrie de roue par rayon (partagée entre toutes les machines).
function wheelGeo(key, make) {
  if (!GEO_CACHE[key]) {
    GEO_CACHE[key] = make();
    GEO_CACHE[key].userData.shared = true;
  }
  return GEO_CACHE[key];
}

const WHEEL_FACE_COLORS = { basic: 0xFFF6E0, big: 0xFF7AB8, tiny: 0x49C4F0, spiked: 0xFFB800 };

function wheelModel(w) {
  const g = new THREE.Group();
  const r = w.r * S;
  const width = Math.max(0.22, r * 0.45);
  const rk = r.toFixed(2);
  // pneu bonbon : gomme prune, épaule ronde côté extérieur, flanc coloré par type
  const tire = new THREE.Mesh(wheelGeo(`wtire:${rk}`, () => new THREE.CylinderGeometry(r, r, width, 20)), TIRE());
  tire.rotation.x = Math.PI / 2;
  g.add(tire);
  const shoulder = new THREE.Mesh(wheelGeo(`wshoulder:${rk}`, () => new THREE.TorusGeometry(r * 0.86, width * 0.5, 8, 20)), TIRE());
  shoulder.position.z = width / 2;
  g.add(shoulder);
  const faceColor = WHEEL_FACE_COLORS[w.type] ?? 0xFFF6E0;
  const face = new THREE.Mesh(
    wheelGeo(`wface:${rk}`, () => new THREE.CylinderGeometry(r * 0.8, r * 0.8, width + 0.03, 20)),
    mat('wheelFace:' + w.type, { color: faceColor })
  );
  face.rotation.x = Math.PI / 2;
  g.add(face);
  // croix d'encre : on voit la rotation
  const spokeGeo = wheelGeo(`wspoke:${rk}`, () => new THREE.BoxGeometry(r * 0.62, r * 0.16, width + 0.05));
  for (let i = 0; i < 2; i++) {
    const spoke = new THREE.Mesh(spokeGeo, mat('rimInk', { color: 0x26183a }));
    spoke.rotation.z = i * Math.PI / 2;
    g.add(spoke);
  }
  const hub = new THREE.Mesh(wheelGeo(`whub:${rk}`, () => new THREE.SphereGeometry(r * 0.22, 10, 8)), RIM());
  hub.scale.z = 0.6;
  hub.position.z = width / 2 + 0.02;
  g.add(hub);
  if (w.type === 'spiked') {
    const spikeGeo = wheelGeo(`wspike:${rk}`, () => new THREE.ConeGeometry(r * 0.14, r * 0.36, 5));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(spikeGeo, METAL());
      spike.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      spike.rotation.z = a - Math.PI / 2;
      g.add(spike);
    }
  }
  return g;
}

const BODY_COLORS = {
  classic: 0x2f8fff, titan: 0x8c4dff, surfer: 0x21c96b, whale: 0xff8a1e, pony: 0xff5c9e,
};

// ---------- véhicule complet ----------
// Repère : x vers l'avant (dir appliqué via scale), y vers le haut, z vers la caméra.
export function createCarModel(spec, { shadows = true } = {}) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);
  const bw = spec.body.w * S, bh = spec.body.h * S;
  const depth = Math.max(1.0, bh * 1.15);
  const paint = spec.loadout?.body?.paint;
  const color = paint ? new THREE.Color(paint) : (BODY_COLORS[spec.loadout?.body?.type] ?? 0x8899aa);

  // peinture cartoon : aplat saturé cel-shadé
  const bodyMat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  const chassis = new THREE.Mesh(bodyGeometry(spec.loadout?.body?.type, bw, bh, depth), bodyMat);
  bodyGroup.add(chassis);
  // bas de caisse sombre (bi-ton)
  const plate = new THREE.Mesh(roundedBox(bw * 0.96, bh * 0.36, depth * 0.9, 0.06), METAL_DARK());
  plate.position.y = -bh / 2 + bh * 0.08;
  bodyGroup.add(plate);
  // néon sous châssis (vend l'arène nocturne)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(bw * 0.8, depth * 0.9),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -bh / 2 - 0.16;
  glow.userData.noShadow = true;
  bodyGroup.add(glow);

  // phare avant lumineux
  const headlight = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, Math.min(bh * 0.22, 0.2), depth * 0.42),
    mat('headlight', { color: 0xfff6d0, emissive: 0xffe9a0, emissiveIntensity: 1.8, roughness: 0.4 })
  );
  headlight.position.set(bw / 2 - 0.01, bh * 0.2, 0);
  bodyGroup.add(headlight);

  // décalco de course sur les flancs : bande diagonale + numéro d'équipe
  const raceNum = (((spec.loadout?.body?.stars || 1) * 7 + (spec.loadout?.body?.level || 1)) % 89) + 10;
  const decal = raceDecalTexture(raceNum);
  for (const sz of [-1, 1]) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(bw * 0.52, bh * 0.72),
      new THREE.MeshBasicMaterial({ map: decal, transparent: true, opacity: 0.92 })
    );
    face.position.set(bw * 0.16, -bh * 0.04, sz * (depth / 2 + 0.012));
    face.rotation.y = sz === 1 ? 0 : Math.PI;
    face.userData.noShadow = true;
    bodyGroup.add(face);
  }

  // touches propres à chaque type de châssis
  const bodyType = spec.loadout?.body?.type;
  if (bodyType === 'classic' || bodyType === 'pony') {
    // aileron arrière
    const wingMat = toonMat(0x2b2f45);
    for (const dz of [-depth * 0.3, depth * 0.3]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.07), wingMat);
      strut.position.set(-bw / 2 + 0.16, bh / 2 + 0.1, dz);
      bodyGroup.add(strut);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, depth * 0.85), wingMat);
    wing.position.set(-bw / 2 + 0.14, bh / 2 + 0.24, 0);
    wing.rotation.z = -0.12;
    bodyGroup.add(wing);
  }
  if (bodyType === 'titan') {
    // rivets + pots d'échappement
    const rivetGeo = new THREE.SphereGeometry(0.045, 8, 8);
    for (let i = 0; i < 4; i++) {
      for (const sz of [-1, 1]) {
        const rivet = new THREE.Mesh(rivetGeo, METAL());
        rivet.position.set(-bw * 0.38 + i * bw * 0.25, bh / 2 - 0.05, sz * (depth / 2 - 0.02));
        bodyGroup.add(rivet);
      }
    }
    for (const dz of [-depth * 0.28, depth * 0.28]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.42, 8), METAL_DARK());
      pipe.position.set(-bw / 2 + 0.14, bh / 2 + 0.2, dz);
      bodyGroup.add(pipe);
    }
  }
  if (bodyType === 'surfer') {
    // pare-brise incliné très bas
    const shield = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, depth * 0.7),
      new THREE.MeshToonMaterial({ color: 0xa8d8f0, gradientMap: toonGradient(), transparent: true, opacity: 0.55 })
    );
    shield.position.set(bw * 0.28, bh / 2 + 0.14, 0);
    shield.rotation.z = 0.5;
    bodyGroup.add(shield);
  }
  if (bodyType === 'whale') {
    // nageoire dorsale
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.quadraticCurveTo(-0.3, 0.5, -0.55, 0.55);
    finShape.quadraticCurveTo(-0.28, 0.2, -0.5, 0); finShape.closePath();
    const fin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false }),
      bodyMat
    );
    fin.position.set(-bw * 0.2, bh / 2, -0.04);
    bodyGroup.add(fin);
  }
  if (bodyType === 'pony') {
    // antenne à boule
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), METAL_DARK());
    rod.position.set(-bw / 2 + 0.1, bh / 2 + 0.25, depth * 0.3);
    bodyGroup.add(rod);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      mat('antennaBall', { color: 0xff5f9e, emissive: 0xff5f9e, emissiveIntensity: 0.8 }));
    ball.position.set(-bw / 2 + 0.1, bh / 2 + 0.52, depth * 0.3);
    bodyGroup.add(ball);
  }

  // cockpit OUVERT : baquet, chat casqué bien visible, écharpe au vent
  const cabR = Math.min(bh * 0.62, 0.62);
  const cabX = -bw * 0.12;
  const catColor = COPILOTS[spec.copilot]?.color ?? 0xffd9a0;
  const seat = new THREE.Mesh(new THREE.TorusGeometry(cabR * 0.7, 0.085, 10, 18), CREAM());
  seat.rotation.x = Math.PI / 2;
  seat.position.set(cabX, bh * 0.5, 0);
  bodyGroup.add(seat);
  const bust = new THREE.Mesh(
    new THREE.SphereGeometry(cabR * 0.42, 12, 10),
    mat('catSkin' + catColor, { color: catColor, emissive: catColor, emissiveIntensity: 0.1 })
  );
  bust.scale.set(1, 0.75, 0.9);
  bust.position.set(cabX, bh * 0.5, 0);
  bodyGroup.add(bust);
  const cat = catHead(cabR * 0.78, catColor); // le co-pilote choisi, STAR de la machine
  cat.position.set(cabX, bh * 0.5 + cabR * 0.55, 0);
  cat.rotation.y = Math.PI / 5; // regarde vers l'avant
  bodyGroup.add(cat);
  // casque POW + étoile autocollante
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(cabR * 0.84, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
    toonMat(0xFF4D5E)
  );
  helmet.position.y = cabR * 0.08;
  cat.add(helmet);
  const star = new THREE.Mesh(
    new THREE.CircleGeometry(cabR * 0.28, 12),
    new THREE.MeshBasicMaterial({ map: helmetStarTexture(), transparent: true })
  );
  star.position.set(cabR * 0.62, cabR * 0.30, 0);
  star.rotation.y = Math.PI / 2;
  star.rotation.z = -0.25;
  star.userData.noShadow = true;
  helmet.add(star);
  // écharpe rose + fanion au vent
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(cabR * 0.4, cabR * 0.12, 8, 12), PINK());
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(cabX, bh * 0.5 + cabR * 0.55 - cabR * 0.62, 0);
  bodyGroup.add(scarf);
  const pennant = new THREE.Mesh(new THREE.BoxGeometry(cabR * 0.7, cabR * 0.22, 0.03), PINK());
  pennant.position.set(cabX - cabR * 0.55, bh * 0.5, 0);
  pennant.rotation.z = 0.25;
  bodyGroup.add(pennant);
  // pare-brise plat incliné (transparent : auto-exclu du contour)
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, cabR * 0.8, depth * 0.5),
    new THREE.MeshToonMaterial({ color: 0xBFE8FF, gradientMap: toonGradient(), transparent: true, opacity: 0.45 })
  );
  windshield.rotation.z = -0.5;
  windshield.position.set(cabX + cabR * 0.8, bh * 0.52, 0);
  bodyGroup.add(windshield);

  // armes
  const spins = [];
  for (const wp of spec.weapons) {
    const wm = weaponModel(wp);
    wm.position.set(wp.ox * S, -wp.oy * S, 0);
    if (wp.angle) wm.rotation.z = -wp.angle;
    // léger décalage z pour éviter le z-fighting entre armes superposées
    wm.position.z = 0.02;
    bodyGroup.add(wm);
    if (wm.userData.anim.spin.length) spins.push(wm.userData.anim);
  }

  // gadgets
  const flames = [];
  if (spec.gadgets.includes('booster') || spec.gadgets.includes('backpedal')) {
    const isBooster = spec.gadgets.includes('booster');
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.3, 10), METAL_DARK());
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-bw / 2 - 0.14, 0, 0);
    bodyGroup.add(nozzle);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.55, 8),
      new THREE.MeshBasicMaterial({ color: isBooster ? 0xffb020 : 0x4fd7ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.z = Math.PI / 2;
    flame.position.set(-bw / 2 - 0.5, 0, 0);
    bodyGroup.add(flame);
    flames.push(flame);
  }
  if (spec.gadgets.includes('repair')) {
    const kit = new THREE.Mesh(roundedBox(0.42, 0.26, 0.42, 0.06), mat('medkit', { color: 0xf4f6ff, roughness: 0.5 }));
    kit.position.set(bw * 0.2, bh / 2 + 0.13, 0);
    bodyGroup.add(kit);
    const crossMat = mat('medCross', { color: 0xe8415e, roughness: 0.5 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.05), crossMat);
    c1.position.set(bw * 0.2, bh / 2 + 0.13, 0.21);
    bodyGroup.add(c1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.05), crossMat);
    c2.position.set(bw * 0.2, bh / 2 + 0.13, 0.21);
    bodyGroup.add(c2);
  }
  if (spec.gadgets.includes('armor')) {
    const shell = new THREE.Mesh(
      roundedBox(bw + 0.12, bh + 0.12, depth + 0.12, Math.min(bh * 0.3, 0.26)),
      new THREE.MeshToonMaterial({ color: 0xffb800, gradientMap: toonGradient(), transparent: true, opacity: 0.22 })
    );
    bodyGroup.add(shell);
  }

  // roues : paire gauche/droite, épaule et moyeu tournés vers l'extérieur des deux côtés
  const wheelMeshes = spec.wheels.map(w => {
    const wWidth = Math.max(0.22, w.r * S * 0.45);
    const wz = depth / 2 + wWidth * 0.3;
    const pair = new THREE.Group();
    for (const dz of [-wz, wz]) {
      const wm = wheelModel(w);
      wm.position.z = dz;
      if (dz < 0) wm.rotation.y = Math.PI;
      pair.add(wm);
    }
    root.add(pair);
    return pair;
  });

  // ombres : on exclut les petits détails marqués noShadow (coût inutile)
  headlight.userData.noShadow = true;
  for (const f of flames) f.userData.noShadow = true;
  if (shadows) {
    root.traverse(o => {
      if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = false; }
    });
  }

  // garde-boue au ton foncé, pare-chocs crème, bande de toit : le jouet en plastique épais
  if (spec.wheels.length) {
    const fenderMat = toonMat(new THREE.Color(color).offsetHSL(0, 0.02, -0.13));
    const baseY = Math.max(...spec.wheels.map(w => w.r), 20) * S + (spec.body.h / 2 + 4) * S;
    for (const w of spec.wheels) {
      const wWidth = Math.max(0.22, w.r * S * 0.45);
      const fk = `fender:${w.r}`;
      if (!GEO_CACHE[fk]) {
        GEO_CACHE[fk] = new THREE.TorusGeometry(w.r * S + 0.09, 0.085, 10, 14, Math.PI);
        GEO_CACHE[fk].userData.shared = true;
      }
      for (const dz of [-(depth / 2 + wWidth * 0.3), depth / 2 + wWidth * 0.3]) {
        const fender = new THREE.Mesh(GEO_CACHE[fk], fenderMat);
        fender.position.set(w.ox * S, w.r * S - baseY, dz);
        bodyGroup.add(fender);
      }
    }
  }
  for (const sx of [-1, 1]) {
    const bumper = new THREE.Mesh(roundedBox(0.16, bh * 0.26, depth * 0.98, 0.06), CREAM());
    bumper.position.set(sx * (bw / 2 - 0.02), -bh * 0.24, 0);
    bodyGroup.add(bumper);
  }
  const stripe = new THREE.Mesh(chassis.geometry, toonMat(0xFFF6E0));
  stripe.scale.set(1.02, 1.02, 0.36);
  bodyGroup.add(stripe);

  // contour d'encre fusionné : UN mesh pour le corps, un par paire de roues
  const bodyOutline = outlineForGroup(bodyGroup, 0.022);
  if (bodyOutline) bodyGroup.add(bodyOutline);
  for (const pair of wheelMeshes) {
    const po = outlineForGroup(pair, 0.018);
    if (po) pair.add(po);
  }
  // ombre cartoon
  const blob = makeBlobShadow(bw * 0.42);

  // Demi-encombrement RÉEL (corps + roues + armes) : le cadrage de combat en dépend.
  let radX = spec.body.w / 2, radY = spec.body.h / 2;
  for (const w of spec.wheels) {
    radX = Math.max(radX, Math.abs(w.ox) + w.r);
    radY = Math.max(radY, w.oy + w.r);
  }
  for (const wp of spec.weapons) {
    const ext = wp.shape === 'circle' ? wp.r : Math.max(wp.w, wp.h) / 2;
    radX = Math.max(radX, Math.abs(wp.ox) + ext);
    radY = Math.max(radY, Math.abs(wp.oy) + ext);
  }

  root.userData = {
    spec, bodyGroup, wheelMeshes, spins, flames, bodyMat, blob, glow,
    radX: radX * S, radY: radY * S,
  };
  return root;
}

// Pose statique : roues au sol, châssis au repos (garage, vitrines).
export function poseCarStatic(model, dir = 1) {
  const { spec, bodyGroup, wheelMeshes, blob } = model.userData;
  if (blob && !blob.parent) {
    blob.position.y = 0.02;
    model.add(blob);
  }
  const maxR = Math.max(...spec.wheels.map(w => w.r), 20) * S;
  const bodyY = maxR + (spec.body.h / 2 + 4) * S;
  bodyGroup.position.set(0, bodyY, 0);
  bodyGroup.scale.x = dir;
  spec.wheels.forEach((w, i) => {
    wheelMeshes[i].position.set(w.ox * S * dir, w.r * S, 0);
  });
}

// Modèle d'une pièce seule (vignettes d'inventaire).
export function createPartModel(part) {
  const d = partDef(part);
  const g = new THREE.Group();
  if (part.kind === 'body') {
    const spec = {
      body: { w: d.w, h: d.h }, wheels: [], weapons: [], gadgets: [],
      loadout: { body: part },
    };
    const car = createCarModel(spec, { shadows: false });
    car.userData.bodyGroup.position.y = 0;
    g.add(car);
    g.userData.fit = Math.max(d.w, d.h * 2.2) * S;
  } else if (part.kind === 'wheel') {
    g.add(wheelModel({ ...d, type: part.type }));
    g.userData.fit = d.r * 2.4 * S;
  } else if (part.kind === 'weapon') {
    g.add(weaponModel({ ...d, type: part.type }));
    g.userData.fit = (d.r ? d.r * 2.8 : d.w * 1.15) * S;
  } else {
    // gadgets : petits objets emblématiques
    if (part.type === 'booster' || part.type === 'backpedal') {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.5, 12), METAL_DARK());
      nozzle.rotation.z = Math.PI / 2;
      g.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 10),
        new THREE.MeshBasicMaterial({ color: part.type === 'booster' ? 0xffb020 : 0x4fd7ff, transparent: true, opacity: 0.95 }));
      flame.rotation.z = Math.PI / 2;
      flame.position.x = -0.6;
      g.add(flame);
      g.userData.fit = 1.5;
    } else if (part.type === 'repair') {
      const kit = new THREE.Mesh(roundedBox(0.8, 0.5, 0.8, 0.1), mat('medkit', { color: 0xf4f6ff, roughness: 0.5 }));
      g.add(kit);
      const crossMat = mat('medCross', { color: 0xe8415e, roughness: 0.5 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.06), crossMat);
      c1.position.z = 0.41; g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.06), crossMat);
      c2.position.z = 0.41; g.add(c2);
      g.userData.fit = 1.2;
    } else {
      const shield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.12, 6),
        toonMat(0xffb800)
      );
      shield.rotation.x = Math.PI / 2;
      g.add(shield);
      g.userData.fit = 1.3;
    }
  }
  const outline = outlineForGroup(g, 0.02);
  if (outline) g.add(outline);
  return g;
}

// ---------- textures utilitaires ----------
let STAR_TEX = null;
function starDecalTexture() {
  if (STAR_TEX) return STAR_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const a2 = a + Math.PI / 5;
    x.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
    x.lineTo(Math.cos(a2) * 20, Math.sin(a2) * 20);
  }
  x.closePath(); x.fill();
  STAR_TEX = new THREE.CanvasTexture(c);
  STAR_TEX.colorSpace = THREE.SRGBColorSpace;
  STAR_TEX.userData.shared = true; // texture globale, jamais disposée
  return STAR_TEX;
}

// Décalco de course (bande blanche diagonale + numéro), cachée par numéro.
const RACE_TEX = {};
function raceDecalTexture(num) {
  if (RACE_TEX[num]) return RACE_TEX[num];
  const c = document.createElement('canvas');
  c.width = 192; c.height = 256;
  const x = c.getContext('2d');
  x.save();
  x.translate(96, 128);
  x.rotate(-0.32);
  x.fillStyle = 'rgba(255,255,255,.34)';
  x.fillRect(-140, -52, 280, 104);
  x.fillStyle = 'rgba(255,255,255,.2)';
  x.fillRect(-140, 62, 280, 16);
  x.restore();
  x.fillStyle = 'rgba(255,255,255,.95)';
  x.font = `800 108px 'Baloo 2', sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.save();
  x.translate(96, 122); x.rotate(-0.32);
  x.strokeStyle = 'rgba(10,10,30,.5)'; x.lineWidth = 10;
  x.strokeText(String(num), 0, 0);
  x.fillText(String(num), 0, 0);
  x.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  RACE_TEX[num] = tex;
  return tex;
}

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#26183A'; x.lineWidth = 12;
  x.strokeRect(6, 6, 500, 116);
  x.fillStyle = fg;
  x.font = '800 64px "Baloo 2", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- arène ----------
function groundTexture(color = '#2b2b50') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 512, 512);
  // dalles
  x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i * 128); x.lineTo(512, i * 128); x.stroke();
  }
  // usure
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,20'},${0.02 + Math.random() * 0.04})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 14, 2 + Math.random() * 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ambiances d'arène : une par ligue (Bois → Légende).
export const ARENA_THEMES = [
  { name: 'Bois',    sky: ['#59C7F2', '#8FDCF7', '#C9F0FF'], sun: true,  ground: 0x3fbf63, track: 0x4a4460, build: 0x2e86c0, fog: 0xc9f0ff, stars: false, weather: null },
  { name: 'Bronze',  sky: ['#FF7847', '#FFB35C', '#FFE08A'], sun: true,  ground: 0xc97a3e, track: 0x5a4050, build: 0x8a4a5a, fog: 0xffe08a, stars: false, weather: { type: 'embers', color: 0xff8a40 } },
  { name: 'Argent',  sky: ['#7FB8E8', '#BFE8FF', '#EAF8FF'], sun: false, ground: 0xdfeef8, track: 0x5a6a80, build: 0x9fc4e0, fog: 0xeaf8ff, stars: false, weather: { type: 'snow', color: 0xffffff } },
  { name: 'Or',      sky: ['#E8A02E', '#FFC95C', '#FFEBAD'], sun: true,  ground: 0xd9b45c, track: 0x6a5a40, build: 0xb08030, fog: 0xffebad, stars: false, weather: { type: 'dust', color: 0xffd88a } },
  { name: 'Diamant', sky: ['#1E2260', '#33409A', '#4A6ACF'], sun: false, ground: 0x2a3a7a, track: 0x3a4a90, build: 0x1a2050, fog: 0x4a6acf, stars: true,  weather: { type: 'neon', color: 0x45e8ff } },
  { name: 'Légende', sky: ['#B2202E', '#E84040', '#FF8A5C'], sun: false, ground: 0x7a2a30, track: 0x4a2028, build: 0x5a1a20, fog: 0xff8a5c, stars: false, weather: { type: 'embers', color: 0xff4030 } },
];

export function skyTexture(theme = ARENA_THEMES[0]) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  // 3 bandes horizontales DURES : zéro dégradé, c'est un dessin animé
  x.fillStyle = theme.sky[0]; x.fillRect(0, 0, 512, 100);
  x.fillStyle = theme.sky[1]; x.fillRect(0, 100, 512, 80);
  x.fillStyle = theme.sky[2]; x.fillRect(0, 180, 512, 76);
  if (theme.stars) {
    // étoiles à 4 branches dessinées
    x.fillStyle = '#ffffff';
    for (let i = 0; i < 14; i++) {
      const px = (i * 137 + 40) % 512, py = (i * 61 + 12) % 130, s = 3 + (i % 3) * 2;
      x.beginPath();
      x.moveTo(px, py - s); x.quadraticCurveTo(px, py, px + s, py);
      x.quadraticCurveTo(px, py, px, py + s); x.quadraticCurveTo(px, py, px - s, py);
      x.quadraticCurveTo(px, py, px, py - s);
      x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- décor du ciel en vrais plans 3D (nets sur tous les formats d'écran) ----------
let CLOUD_TEX = null, SUN_TEX = null;
function cloudTexture() {
  if (CLOUD_TEX) return CLOUD_TEX;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.strokeStyle = '#26183A'; x.lineWidth = 7; x.fillStyle = '#ffffff';
  x.beginPath();
  x.arc(70, 100, 38, Math.PI * 0.5, Math.PI * 1.5);
  x.arc(105, 70, 42, Math.PI * 0.95, Math.PI * 1.9);
  x.arc(160, 62, 40, Math.PI * 1.15, Math.PI * 2.05);
  x.arc(195, 100, 34, Math.PI * 1.5, Math.PI * 0.5);
  x.closePath();
  x.fill(); x.stroke();
  x.fillStyle = '#CFE9F5';
  x.fillRect(48, 118, 168, 14);
  CLOUD_TEX = new THREE.CanvasTexture(c);
  CLOUD_TEX.colorSpace = THREE.SRGBColorSpace;
  CLOUD_TEX.userData.shared = true;
  return CLOUD_TEX;
}
function sunTexture() {
  if (SUN_TEX) return SUN_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.translate(128, 128);
  x.strokeStyle = '#26183A'; x.lineWidth = 8; x.fillStyle = '#FFD84D';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    x.beginPath();
    x.moveTo(Math.cos(a) * 78, Math.sin(a) * 78);
    x.lineTo(Math.cos(a) * 112, Math.sin(a) * 112);
    x.stroke();
  }
  x.beginPath(); x.arc(0, 0, 66, 0, Math.PI * 2); x.fill(); x.stroke();
  SUN_TEX = new THREE.CanvasTexture(c);
  SUN_TEX.colorSpace = THREE.SRGBColorSpace;
  SUN_TEX.userData.shared = true;
  return SUN_TEX;
}
// Vol d'oiseaux en accents circonflexes (scènes calmes).
let BIRD_TEX = null;
function birdTexture() {
  if (BIRD_TEX) return BIRD_TEX;
  const c = document.createElement('canvas');
  c.width = 192; c.height = 96;
  const x = c.getContext('2d');
  x.strokeStyle = '#26183A';
  x.lineWidth = 6;
  x.lineCap = 'round';
  for (const [bx, by] of [[30, 40], [95, 25], [150, 55]]) {
    x.beginPath();
    x.moveTo(bx - 18, by + 8);
    x.quadraticCurveTo(bx - 9, by - 8, bx, by + 2);
    x.quadraticCurveTo(bx + 9, by - 8, bx + 18, by + 8);
    x.stroke();
  }
  BIRD_TEX = new THREE.CanvasTexture(c);
  BIRD_TEX.colorSpace = THREE.SRGBColorSpace;
  BIRD_TEX.userData.shared = true;
  return BIRD_TEX;
}

// Ajoute soleil + nuages (+ options basses altitudes / oiseaux) à une scène.
export function addSkyDecor(scene, theme = ARENA_THEMES[0], { sunPos = [14, 16, -42], lowClouds = false, birds = false } = {}) {
  const mk = (tex, w, h) => new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false })
  );
  if (theme.sun) {
    const sun = mk(sunTexture(), 9, 9);
    sun.position.set(...sunPos);
    scene.add(sun);
  }
  if (!theme.stars) {
    const clouds = [[-16, 13, -44, 8], [6, 16, -46, 6], [22, 11, -43, 5]];
    if (lowClouds) clouds.push([15, 6.5, -38, 7], [-14, 5.6, -36, 5.5]);
    for (const [cx, cy, cz, s] of clouds) {
      const cl = mk(cloudTexture(), s, s * 0.62);
      cl.position.set(cx, cy, cz);
      scene.add(cl);
    }
  }
  if (birds) {
    const flock = mk(birdTexture(), 3.4, 1.7);
    flock.position.set(4.5, 10.2, -28);
    scene.add(flock);
  }
}

export function createArena(scene, arenaW, theme = ARENA_THEMES[0]) {
  const W = arenaW * S; // largeur de l'arène en unités 3D
  const env = new THREE.Group();
  scene.add(env);

  // sol : herbe en aplat cartoon
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 3, 70),
    toonMat(theme.ground)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -15);
  floor.receiveShadow = true;
  env.add(floor);

  // bande centrale de combat
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(W, 6),
    toonMat(theme.track)
  );
  track.rotation.x = -Math.PI / 2;
  track.position.y = 0.005;
  track.receiveShadow = true;
  env.add(track);
  // VIBREURS rouge/crème le long de la piste + jupe d'encre
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const kerbMat = new THREE.MeshBasicMaterial({ map: kerbTexture(Math.round(W / 0.9)) });
  const kerbSkirt = new THREE.MeshBasicMaterial({ color: 0x26183A });
  for (const dz of [-3.1, 3.1]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, 0.55), kerbMat);
    kerb.position.set(0, 0.08, dz);
    env.add(kerb);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.62), kerbSkirt);
    skirt.position.set(0, 0.03, dz);
    env.add(skirt);
  }
  // grille de départ en damier au centre
  const gridC = document.createElement('canvas');
  gridC.width = 128; gridC.height = 512;
  const gx = gridC.getContext('2d');
  for (let gy = 0; gy < 16; gy++) {
    for (let gxx = 0; gxx < 4; gxx++) {
      gx.fillStyle = (gy + gxx) % 2 ? '#26183A' : '#FFF6E0';
      gx.fillRect(gxx * 32, gy * 32, 32, 32);
    }
  }
  const gridTex = new THREE.CanvasTexture(gridC);
  gridTex.colorSpace = THREE.SRGBColorSpace;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 6), new THREE.MeshBasicMaterial({ map: gridTex }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, 0.014, 0);
  env.add(grid);
  // tirets latéraux (on saute le centre : la grille y est)
  for (let i = 0; i < 10; i++) {
    if (Math.abs((i - 4.5) * (W / 10)) < 1.4) continue;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.18), lineMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = (i % 2 ? 1 : -1) * 0.03; // jitter fait main
    dash.position.set((i - 4.5) * (W / 10), 0.012, 0);
    env.add(dash);
  }
  // traces de gomme
  const skidGeo = new THREE.PlaneGeometry(2.4, 0.34);
  const skidMat = new THREE.MeshBasicMaterial({ color: 0x26183A, transparent: true, opacity: 0.16, depthWrite: false });
  const skidX = [-6, -2.5, 0.8, 3.4, 6.5], skidZ = [-1.2, 0.8, -0.4, 1.4, 0.2];
  for (let i = 0; i < 5; i++) {
    const skid = new THREE.Mesh(skidGeo, skidMat);
    skid.rotation.x = -Math.PI / 2;
    skid.rotation.z = (i % 2 ? 1 : -1) * 0.15;
    skid.position.set(skidX[i], 0.011, skidZ[i]);
    env.add(skid);
  }

  // logo MAKS décalé (le centre est pris par la grille de départ)
  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 40),
    new THREE.MeshBasicMaterial({ map: bannerTexture('MAKS', 'rgba(0,0,0,0)', 'rgba(255,201,62,.28)'), transparent: true })
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(-W / 4, 0.012, 0);
  env.add(logo);

  // panneaux publicitaires le long de la piste
  const ADS = [
    ['MIAOU-COLA', '#FF4D5E', '#FFF6E0'],
    ['MAKS ARENA', '#FFB800', '#26183A'],
    ['GRIFFE & FILS', '#2FD573', '#26183A'],
    ['CAT-TURBO', '#FFF6E0', '#26183A'],
    ['RONRON GP', '#49C4F0', '#26183A'],
  ];
  if (!GEO_CACHE['adleg']) {
    GEO_CACHE['adleg'] = new THREE.CylinderGeometry(0.07, 0.09, 0.8, 6);
    GEO_CACHE['adleg'].userData.shared = true;
  }
  for (let i = 0; i < ADS.length; i++) {
    const [text, bg, fg] = ADS[i];
    const adGroup = new THREE.Group();
    adGroup.position.set((i - (ADS.length - 1) / 2) * 6.2, 0, -6.4);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 1.35),
      new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg) })
    );
    panel.position.y = 0.95;
    panel.rotation.x = -0.05;
    panel.rotation.z = (i % 2 ? 1 : -1) * 0.02;
    adGroup.add(panel);
    for (const lx of [-2.2, 2.2]) {
      const leg = new THREE.Mesh(GEO_CACHE['adleg'], toonMat(0x26183A));
      leg.position.set(lx, 0.35, -0.05);
      adGroup.add(leg);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 0.3), toonMat(0x26183A));
    cap.position.set(0, 1.68, 0);
    adGroup.add(cap);
    env.add(adGroup);
  }

  // tribunes bicolores + nez de marche crème + garde-corps soleil
  const standMatA = toonMat(0xA66CFF), standMatB = toonMat(0x8452D9);
  for (let tier = 0; tier < 3; tier++) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(W + 14, 1.1, 2.2), tier % 2 ? standMatB : standMatA);
    stand.position.set(0, 1.5 + tier * 1.15, -8.4 - tier * 2.1);
    env.add(stand);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(W + 14, 0.16, 2.3), CREAM());
    nose.position.set(0, 1.5 + tier * 1.15 + 0.63, -8.4 - tier * 2.1);
    env.add(nose);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(W + 14, 0.45, 0.14), toonMat(0xFFB800));
  rail.position.set(0, 1.35, -7.25);
  env.add(rail);
  const railTop = new THREE.Mesh(new THREE.BoxGeometry(W + 14, 0.08, 0.16), new THREE.MeshBasicMaterial({ color: 0x26183A }));
  railTop.position.set(0, 1.60, -7.25);
  env.add(railTop);
  // foule : silhouettes-quilles à oreilles, en rangs, couleurs palette
  const fanPts = [[0.001, 0], [0.17, 0.02], [0.20, 0.12], [0.14, 0.26], [0.16, 0.34], [0.155, 0.46], [0.09, 0.56], [0.001, 0.60]]
    .map(([px, py]) => new THREE.Vector2(px, py));
  const fanGeo = new THREE.LatheGeometry(fanPts, 10);
  const fanMat = new THREE.MeshToonMaterial({ gradientMap: toonGradient() });
  const N_FANS = 130;
  const crowd = new THREE.InstancedMesh(fanGeo, fanMat, N_FANS);
  const fanData = [];
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let cSeed = 13;
  const crnd = () => { cSeed = (cSeed * 16807) % 2147483647; return cSeed / 2147483647; };
  const FAN_COLORS = [0xFF4D5E, 0x2FD573, 0xFFB800, 0x49C4F0, 0xFF7AB8, 0xFFF6E0, 0xA66CFF];
  for (let i = 0; i < N_FANS; i++) {
    const tier = i % 3;
    const slot = Math.floor(i / 3);
    const fx = -(W + 12) / 2 + ((slot % 22) + 0.5) * ((W + 12) / 22) + (crnd() - 0.5) * 0.5;
    const fz = -8.4 - tier * 2.1 + (slot < 22 ? -0.45 : 0.45);
    const fy = 2.05 + tier * 1.15;
    fanData.push({ x: fx, y: fy, z: fz, phase: crnd() * Math.PI * 2, speed: 2 + crnd() * 4, amp: 0.1 + crnd() * 0.22 });
    dummy.position.set(fx, fy, fz);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    crowd.setColorAt(i, color.setHex(FAN_COLORS[i % 7]));
  }
  crowd.instanceColor.needsUpdate = true;
  env.add(crowd);
  env.userData.crowd = { mesh: crowd, data: fanData, dummy };
  // pancartes de supporters
  const SIGNS = [['GO !', '#2FD573', '#26183A'], ['MIAOU', '#FF7AB8', '#26183A'], ['POW', '#FF4D5E', '#FFF6E0']];
  const SIGN_POS = [[-7.5, 2.9, -8.0], [-2.6, 4.05, -10.1], [1.8, 2.9, -8.0], [5.4, 5.2, -12.2], [8.8, 4.05, -10.1]];
  for (let i = 0; i < 5; i++) {
    const [txt, bg, fg] = SIGNS[i % 3];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.55),
      new THREE.MeshBasicMaterial({ map: bannerTexture(txt, bg, fg) })
    );
    sign.position.set(...SIGN_POS[i]);
    sign.rotation.z = (i % 2 ? 1 : -1) * 0.1;
    env.add(sign);
  }

  // skyline en 2 plans peints (remplace 16 boxes + 48 fenêtres : −64 draw calls)
  function skylineTexture(tint, seed) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const x = c.getContext('2d');
    let s = seed;
    const srnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let bx = 8;
    for (let i = 0; i < 9 && bx < 990; i++) {
      const bwPx = 70 + srnd() * 80;
      const bhPx = 90 + srnd() * 140;
      x.fillStyle = tint;
      x.strokeStyle = '#26183A';
      x.lineWidth = 6;
      x.fillRect(bx, 256 - bhPx, bwPx, bhPx);
      x.strokeRect(bx, 256 - bhPx, bwPx, bhPx);
      // toits variés : créneaux / antenne / château d'eau
      if (i % 3 === 0) {
        for (let k = 0; k < 3; k++) x.fillRect(bx + 8 + k * (bwPx / 3), 256 - bhPx - 12, bwPx / 5, 12);
      } else if (i % 3 === 1) {
        x.fillRect(bx + bwPx / 2 - 2, 256 - bhPx - 26, 4, 26);
        x.beginPath(); x.arc(bx + bwPx / 2, 256 - bhPx - 30, 8, 0, 7); x.fill();
      } else {
        x.fillRect(bx + bwPx / 2 - 12, 256 - bhPx - 18, 24, 18);
        x.beginPath(); x.arc(bx + bwPx / 2, 256 - bhPx - 18, 12, Math.PI, 0); x.fill();
      }
      // fenêtres
      const cols = 3 + (i % 2);
      for (let cx2 = 0; cx2 < cols; cx2++) {
        for (let cy2 = 0; cy2 < Math.floor((bhPx - 24) / 30); cy2++) {
          x.fillStyle = srnd() < 0.65 ? '#FFD84D' : '#26183A';
          x.fillRect(bx + 10 + cx2 * ((bwPx - 20) / cols), 256 - bhPx + 12 + cy2 * 30, 14, 18);
        }
      }
      bx += bwPx + 10 + srnd() * 30;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const farTint = '#' + new THREE.Color(theme.build).lerp(new THREE.Color(theme.fog), 0.45).getHexString();
  const farPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 3, 11),
    new THREE.MeshBasicMaterial({ map: skylineTexture(farTint, 11), transparent: true })
  );
  farPlane.position.set(0, 5.5, -34);
  env.add(farPlane);
  const nearPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2.4, 12),
    new THREE.MeshBasicMaterial({ map: skylineTexture('#' + new THREE.Color(theme.build).getHexString(), 29), transparent: true })
  );
  nearPlane.position.set(0, 6, -24);
  env.add(nearPlane);

  // GRANDE ROUE au loin (les draw calls gagnés sur la skyline)
  const ferrisPivot = new THREE.Group();
  ferrisPivot.position.set(W / 2 + 7, 4.2, -19);
  env.add(ferrisPivot);
  const ferris = new THREE.Group();
  ferris.add(new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.14, 8, 28), toonMat(0xFFB800)));
  const rayGeo = new THREE.BoxGeometry(0.1, 3.0, 0.1);
  const rayMat = toonMat(0xFFB800);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.position.set(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0);
    ray.rotation.z = a - Math.PI / 2;
    ferris.add(ray);
  }
  const ferrisHub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10), toonMat(0x26183A));
  ferrisHub.rotation.x = Math.PI / 2;
  ferris.add(ferrisHub);
  const CABIN_COLORS = [0xFF4D5E, 0x2FD573, 0x49C4F0, 0xFF7AB8, 0xA66CFF, 0xFFB800, 0xFFF6E0, 0x2FD573];
  for (let i = 0; i < 8; i++) {
    const a2 = i * Math.PI / 4 + Math.PI / 8;
    const cabin = new THREE.Mesh(roundedBox(0.6, 0.5, 0.5, 0.12), toonMat(CABIN_COLORS[i]));
    cabin.position.set(Math.cos(a2) * 3.0, Math.sin(a2) * 3.0, 0.1);
    ferris.add(cabin);
  }
  ferrisPivot.add(ferris);
  const legGeo = new THREE.ConeGeometry(0.35, 4.2, 6);
  const legMat = toonMat(0xA66CFF);
  for (const lx of [-1.4, 1.4]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, -2.1, 0);
    leg.rotation.z = lx > 0 ? -0.32 : 0.32;
    ferrisPivot.add(leg);
  }
  env.userData.ferris = ferris; // battle.js le fait tourner à 12 fps

  // météo d'ambiance : un seul THREE.Points animé par le combat
  if (theme.weather) {
    const N = 220;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const additive = theme.weather.type === 'embers' || theme.weather.type === 'neon';
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: theme.weather.color,
      size: theme.weather.type === 'neon' ? 0.14 : 0.09,
      transparent: true, opacity: 0.7, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    env.add(points);
    env.userData.weather = { points, type: theme.weather.type };
  }

  // pylônes de projecteurs
  for (const px of [-W / 2 - 1.5, W / 2 + 1.5]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9, 8), METAL_DARK());
    pole.position.set(px, 4.5, -5);
    env.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
    lamp.position.set(px, 9, -5);
    lamp.lookAt(0, 0, 0);
    env.add(lamp);
  }
  return env;
}

// ---------- mur de la mort ----------
export function createDeathWall(side) {
  const g = new THREE.Group();
  // le mur est une MENACE cartoon : rouge POW, chevrons, dents de requin crème
  const wall = new THREE.Mesh(
    roundedBox(1.2, 13, 7, 0.2),
    new THREE.MeshToonMaterial({ color: 0xFF4D5E, gradientMap: toonGradient() })
  );
  wall.position.y = 6.5;
  g.add(wall);
  // bande de chevrons jaune/encre côté arène
  const chevC = document.createElement('canvas');
  chevC.width = 64; chevC.height = 512;
  const cx = chevC.getContext('2d');
  cx.save();
  cx.translate(32, 256);
  cx.rotate(Math.PI / 4);
  for (let i = -8; i < 9; i++) {
    cx.fillStyle = i % 2 ? '#26183A' : '#FFB800';
    cx.fillRect(-400, i * 64, 800, 64);
  }
  cx.restore();
  const chevTex = new THREE.CanvasTexture(chevC);
  chevTex.wrapT = THREE.RepeatWrapping;
  chevTex.repeat.set(1, 4);
  chevTex.colorSpace = THREE.SRGBColorSpace;
  const chevrons = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 12.4), new THREE.MeshBasicMaterial({ map: chevTex }));
  chevrons.position.set(side * 0.62, 6.5, 0);
  chevrons.rotation.y = -side * Math.PI / 2;
  g.add(chevrons);
  // dents de requin crème + pointes d'encre
  const toothGeo = new THREE.ConeGeometry(0.5, 1.4, 6);
  const tipGeo = new THREE.ConeGeometry(0.16, 0.4, 6);
  const tipMat = toonMat(0x26183A);
  for (let k = 0; k < 10; k++) {
    const ty = 1.0 + k * 1.25;
    const dz = k % 2 ? 1.2 : -1.2;
    const tooth = new THREE.Mesh(toothGeo, CREAM());
    tooth.position.set(side * 0.9, ty, dz);
    tooth.rotation.z = -side * Math.PI / 2;
    g.add(tooth);
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(side * 1.45, ty, dz);
    tip.rotation.z = -side * Math.PI / 2;
    g.add(tip);
  }
  // panneau danger : triangle + crâne de chat
  const signC = document.createElement('canvas');
  signC.width = signC.height = 256;
  const sx = signC.getContext('2d');
  sx.fillStyle = '#FFB800';
  sx.strokeStyle = '#26183A';
  sx.lineWidth = 14;
  sx.lineJoin = 'round';
  sx.beginPath();
  sx.moveTo(128, 22); sx.lineTo(238, 226); sx.lineTo(18, 226);
  sx.closePath();
  sx.fill(); sx.stroke();
  sx.fillStyle = '#FFF6E0';
  sx.beginPath(); sx.arc(128, 160, 40, 0, 7); sx.fill();
  sx.beginPath();
  sx.moveTo(96, 138); sx.lineTo(88, 106); sx.lineTo(116, 124);
  sx.moveTo(160, 138); sx.lineTo(168, 106); sx.lineTo(140, 124);
  sx.fill();
  sx.strokeStyle = '#26183A';
  sx.lineWidth = 8;
  sx.lineCap = 'round';
  for (const ex of [110, 146]) {
    sx.beginPath();
    sx.moveTo(ex - 8, 150); sx.lineTo(ex + 8, 166);
    sx.moveTo(ex + 8, 150); sx.lineTo(ex - 8, 166);
    sx.stroke();
  }
  const signTex = new THREE.CanvasTexture(signC);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.position.set(side * 0.63, 9.8, 0);
  sign.rotation.y = -side * Math.PI / 2;
  g.add(sign);
  // socle d'encre
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 7.4), toonMat(0x26183A));
  base.position.y = 0.25;
  g.add(base);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 13),
    new THREE.MeshBasicMaterial({ color: 0xFF4D5E, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  glow.position.set(side * 1.3, 6.5, 0);
  glow.rotation.y = -side * Math.PI / 2;
  g.add(glow);
  g.userData.glow = glow;
  g.userData.wallMat = wall.material;
  return g;
}
