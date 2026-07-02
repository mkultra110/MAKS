// Modèles 3D procéduraux : véhicules, pièces, arène, effets.
import * as THREE from 'three';
import { partDef } from './data.js';

export const S = 0.02; // 50 px physiques = 1 unité 3D

// ---------- matériaux partagés ----------
const MATS = {};
export function mat(key, opts) {
  if (!MATS[key]) MATS[key] = new THREE.MeshStandardMaterial(opts);
  return MATS[key];
}
const METAL = () => mat('metal', { color: 0xd8dce8, metalness: 0.85, roughness: 0.32 });
const METAL_DARK = () => mat('metalDark', { color: 0x565c72, metalness: 0.7, roughness: 0.45 });
const TIRE = () => mat('tire', { color: 0x23273a, metalness: 0.1, roughness: 0.9 });
const RIM = () => mat('rim', { color: 0xaeb6d4, metalness: 0.8, roughness: 0.35 });

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
  GEO_CACHE[key] = geo;
  return geo;
}

// ---------- tête de chat pilote ----------
export function catHead(size = 0.28) {
  const g = new THREE.Group();
  const skin = mat('catSkin', { color: 0xffd9a0, roughness: 0.7 });
  const dark = mat('catDark', { color: 0x2a2438, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(size, 18, 14), skin);
  g.add(head);
  const earGeo = new THREE.ConeGeometry(size * 0.34, size * 0.6, 4);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.position.set(sx * size * 0.55, size * 0.78, 0);
    ear.rotation.z = -sx * 0.35;
    g.add(ear);
  }
  const eyeGeo = new THREE.SphereGeometry(size * 0.13, 8, 8);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, dark);
    eye.position.set(sx * size * 0.38, size * 0.08, size * 0.82);
    g.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(size * 0.09, 8, 8), dark);
  nose.position.set(0, size * -0.18, size * 0.92);
  g.add(nose);
  return g;
}

// ---------- armes ----------
function weaponModel(wp) {
  const g = new THREE.Group();
  const anim = { spin: [], axis: 'z' };
  const w = (wp.w || 0) * S, h = (wp.h || 0) * S, r = (wp.r || 0) * S;

  if (wp.type === 'saw') {
    const disc = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.09, 24), METAL());
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
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.36, r * 0.36, 0.12, 16), METAL_DARK());
    hub.rotation.x = Math.PI / 2;
    disc.add(hub);
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
    const guard = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 1.5, 0.14), METAL_DARK());
    guard.position.x = -w / 2 + w * 0.1;
    g.add(guard);
  } else if (wp.type === 'drill') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 0.62, w, 14), METAL());
    cone.rotation.z = -Math.PI / 2;
    // rainures
    const grooveGeo = new THREE.TorusGeometry(h * 0.42, 0.018, 6, 18);
    for (let i = 0; i < 3; i++) {
      const groove = new THREE.Mesh(grooveGeo, METAL_DARK());
      groove.rotation.y = Math.PI / 2;
      groove.position.x = -w * 0.3 + i * w * 0.22;
      groove.scale.setScalar(1 - i * 0.22);
      g.add(groove);
    }
    g.add(cone);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.5, h * 0.55, 0.22, 12), METAL_DARK());
    base.rotation.z = Math.PI / 2;
    base.position.x = -w / 2;
    g.add(base);
    anim.spin.push(cone); anim.axis = 'x';
  } else if (wp.type === 'rocket') {
    for (const dy of [-h * 0.28, h * 0.28]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.3, h * 0.3, w, 12), METAL_DARK());
      tube.rotation.z = Math.PI / 2;
      tube.position.y = dy;
      g.add(tube);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(h * 0.24, 0.16, 10),
        mat('rocketTip', { color: 0xff4b5e, roughness: 0.4, metalness: 0.2 }));
      tip.rotation.z = -Math.PI / 2;
      tip.position.set(w / 2 + 0.07, dy, 0);
      g.add(tip);
    }
  } else if (wp.type === 'laser') {
    const box = new THREE.Mesh(roundedBox(w, h, h * 1.1, h * 0.2), METAL_DARK());
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
    const body = new THREE.Mesh(roundedBox(w * 0.5, h, h, h * 0.2), METAL_DARK());
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
    anim.spin.push(barrels); anim.axis = 'x';
  }
  g.userData.anim = anim;
  return g;
}

// ---------- roue ----------
function wheelModel(w) {
  const g = new THREE.Group();
  const r = w.r * S;
  const width = Math.max(0.26, r * 0.6);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 22), TIRE());
  tire.rotation.x = Math.PI / 2;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.02, 16), RIM());
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, width + 0.05, 10), TIRE());
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  // rayons pour voir la rotation
  const spokeGeo = new THREE.BoxGeometry(r * 0.95, r * 0.14, width + 0.03);
  for (let i = 0; i < 2; i++) {
    const spoke = new THREE.Mesh(spokeGeo, TIRE());
    spoke.rotation.z = i * Math.PI / 2;
    g.add(spoke);
  }
  if (w.type === 'spiked') {
    const spikeGeo = new THREE.ConeGeometry(r * 0.14, r * 0.36, 5);
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
  classic: 0x3f9bff, titan: 0x9a63ff, surfer: 0x35d97c, whale: 0xff8f31, pony: 0xff5f9e,
};

// ---------- véhicule complet ----------
// Repère : x vers l'avant (dir appliqué via scale), y vers le haut, z vers la caméra.
export function createCarModel(spec, { shadows = true } = {}) {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);
  const bw = spec.body.w * S, bh = spec.body.h * S;
  const depth = Math.max(1.0, bh * 1.15);
  const color = BODY_COLORS[spec.loadout?.body?.type] ?? 0x8899aa;

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.42 });
  const chassis = new THREE.Mesh(roundedBox(bw, bh, depth, Math.min(bh * 0.3, 0.24)), bodyMat);
  bodyGroup.add(chassis);
  // plaque inférieure sombre
  const plate = new THREE.Mesh(roundedBox(bw * 0.96, bh * 0.3, depth * 0.9, 0.06), METAL_DARK());
  plate.position.y = -bh / 2 + bh * 0.1;
  bodyGroup.add(plate);

  // cabine vitrée + chat
  const cabR = Math.min(bh * 0.62, 0.62);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(cabR, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x2c3a66, metalness: 0.15, roughness: 0.08, transparent: true, opacity: 0.42 })
  );
  glass.position.set(-bw * 0.12, bh * 0.36, 0);
  bodyGroup.add(glass);
  const cat = catHead(cabR * 0.62);
  cat.position.set(-bw * 0.12, bh * 0.42, 0);
  cat.rotation.y = Math.PI / 5; // regarde vers l'avant
  bodyGroup.add(cat);

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
      new THREE.MeshStandardMaterial({ color: 0xffc93e, metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.22 })
    );
    bodyGroup.add(shell);
  }

  // roues : chaque roue physique = une paire gauche/droite qui dépasse du châssis
  const wheelZ = depth / 2 + 0.1;
  const wheelMeshes = spec.wheels.map(w => {
    const pair = new THREE.Group();
    for (const dz of [-wheelZ, wheelZ]) {
      const wm = wheelModel(w);
      wm.position.z = dz;
      pair.add(wm);
    }
    root.add(pair);
    return pair;
  });

  if (shadows) root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  root.userData = { spec, bodyGroup, wheelMeshes, spins, flames };
  return root;
}

// Pose statique : roues au sol, châssis au repos (garage, vitrines).
export function poseCarStatic(model, dir = 1) {
  const { spec, bodyGroup, wheelMeshes } = model.userData;
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
        new THREE.MeshStandardMaterial({ color: 0xffc93e, metalness: 0.75, roughness: 0.3 })
      );
      shield.rotation.x = Math.PI / 2;
      g.add(shield);
      g.userData.fit = 1.3;
    }
  }
  return g;
}

// ---------- arène ----------
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#2b2b50'; x.fillRect(0, 0, 512, 512);
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

export function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0e0e28');
  g.addColorStop(0.45, '#232055');
  g.addColorStop(0.75, '#4a2a68');
  g.addColorStop(1, '#7a3a70');
  x.fillStyle = g; x.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createArena(scene, arenaW) {
  const W = arenaW * S; // largeur de l'arène en unités 3D
  const env = new THREE.Group();
  scene.add(env);

  // sol
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 3, 40),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.92, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  env.add(floor);

  // bande centrale de combat
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(W, 6),
    new THREE.MeshStandardMaterial({ color: 0x33335e, roughness: 0.85 })
  );
  track.rotation.x = -Math.PI / 2;
  track.position.y = 0.005;
  track.receiveShadow = true;
  env.add(track);
  // lignes de bord
  for (const dz of [-3, 3]) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffc93e, transparent: true, opacity: 0.5 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, dz);
    env.add(line);
  }

  // gratte-ciels lointains (silhouettes)
  const bMat = new THREE.MeshStandardMaterial({ color: 0x191736, roughness: 1 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0.7 });
  let rndSeed = 7;
  const rnd = () => { rndSeed = (rndSeed * 16807) % 2147483647; return rndSeed / 2147483647; };
  for (let i = 0; i < 16; i++) {
    const bw = 2.2 + rnd() * 3.4, bh = 4 + rnd() * 9, bz = -14 - rnd() * 16;
    const bx = (i - 8) * 4.4 + rnd() * 2.4;
    const bld = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), bMat);
    bld.position.set(bx, bh / 2, bz);
    env.add(bld);
    // quelques fenêtres éclairées
    for (let k = 0; k < 5; k++) {
      if (rnd() < 0.4) continue;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), winMat);
      win.position.set(bx - bw / 2 + rnd() * bw, 0.8 + rnd() * (bh - 1.4), bz + bw / 2 + 0.02);
      env.add(win);
    }
  }

  // lune
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe6b0 })
  );
  moon.position.set(W * 0.3, 13, -30);
  env.add(moon);

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
    // faisceau
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(3.4, 11, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(px * 0.8, 4.5, -4);
    beam.rotation.z = px > 0 ? 0.5 : -0.5;
    env.add(beam);
  }
  return env;
}

// ---------- mur de la mort ----------
export function createDeathWall(side) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(
    roundedBox(1.2, 13, 7, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x3c3c6e, metalness: 0.5, roughness: 0.5 })
  );
  wall.position.y = 6.5;
  g.add(wall);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xd8dce8, metalness: 0.85, roughness: 0.3 });
  const spikeGeo = new THREE.ConeGeometry(0.28, 0.9, 6);
  for (let y = 0.8; y < 12; y += 1.2) {
    for (const dz of [-1.6, 0, 1.6]) {
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(side * 0.9, y, dz);
      spike.rotation.z = -side * Math.PI / 2;
      g.add(spike);
    }
  }
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 13),
    new THREE.MeshBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  glow.position.set(side * 1.3, 6.5, 0);
  glow.rotation.y = -side * Math.PI / 2;
  g.add(glow);
  g.userData.glow = glow;
  g.userData.wallMat = wall.material;
  return g;
}
