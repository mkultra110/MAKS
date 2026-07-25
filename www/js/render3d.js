// Rendu 3D partagé : création de renderers, scènes studio, éclairages.
// Direction artistique « ATELIER NOCTURNE » : garage industriel la nuit,
// acier brossé sombre, UNE source chaude ambrée, cel-shading 3 tons, contours encre.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from './lib/BufferGeometryUtils.js';
import { skyTexture } from './models3d.js';

export const INK = 0x26183a; // l'encre signature (jamais du noir pur)
export const FLOOR_Y = -0.85; // niveau du sol des scènes hub/garage (le podium culmine à y=0)

// Palette « ATELIER NOCTURNE » (miroir de la maquette UI).
const PAL = {
  night: 0x0A0807,
  ink2: 0x151110,
  steel0: 0x221E1A,
  steel1: 0x2E2925,
  steel2: 0x3C3630,
  steel3: 0x524940,
  steelHi: 0x776759,
  amber: 0xFF8A1F,
  amberHi: 0xFFC24A,
  amberLo: 0xB8420A,
  ember: 0xFF5A2B,
  signal: 0xFFC400,
  signalHi: 0xFFE685,
  cream: 0xF7E9D2,
  cream2: 0xCBB89C,
  weld: 0x5FD9F2,
  rust: 0x8A4A18,
  edge: 0x0B0907, // contour d'atelier : noir chaud, pas l'encre violette
};

// gradientMap 3 tons partagée : ombre 41%, mi-ton 76%, lumière 100%
let GRAD3 = null, GRAD2 = null;
export function toonGradient(hard = false) {
  if (hard) {
    if (!GRAD2) {
      GRAD2 = new THREE.DataTexture(new Uint8Array([140, 255]), 2, 1, THREE.RedFormat);
      GRAD2.minFilter = GRAD2.magFilter = THREE.NearestFilter;
      GRAD2.needsUpdate = true;
      GRAD2.userData.shared = true;
    }
    return GRAD2;
  }
  if (!GRAD3) {
    GRAD3 = new THREE.DataTexture(new Uint8Array([105, 194, 255]), 3, 1, THREE.RedFormat);
    GRAD3.minFilter = GRAD3.magFilter = THREE.NearestFilter;
    GRAD3.needsUpdate = true;
    GRAD3.userData.shared = true;
  }
  return GRAD3;
}

// Contour « inverted hull » fusionné : UN seul mesh de contour par groupe,
// épaisseur constante en unités monde (pas un scale qui amincit les grosses pièces).
export function outlineForGroup(group, thickness = 0.022) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const geos = [];
  group.traverse(o => {
    if (!o.isMesh || o.userData.noOutline || o.userData.noShadow) return;
    if (o.material?.transparent) return;
    // les sous-groupes animés (scie…) gèrent leur propre contour
    for (let p = o; p && p !== group; p = p.parent) {
      if (p.userData.skipInParentOutline) return;
    }
    const g = o.geometry.clone();
    const rel = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld);
    g.applyMatrix4(rel);
    // ne garder que la position (attributs homogènes pour la fusion)
    const pos = g.getAttribute('position');
    const bare = new THREE.BufferGeometry();
    bare.setAttribute('position', pos);
    if (g.index) bare.setIndex(g.index);
    geos.push(bare);
  });
  if (!geos.length) return null;
  let merged = mergeGeometries(geos.map(g => g.toNonIndexed ? g.toNonIndexed() : g), false);
  merged = mergeVertices(merged);           // évite que le hull éclate aux arêtes dures
  merged.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = position + normal * ${thickness.toFixed(4)};`
    );
  };
  const mesh = new THREE.Mesh(merged, mat);
  mesh.userData.noOutline = true;
  mesh.userData.noShadow = true;
  return mesh;
}

// Même contour, mais teinté « noir d'atelier » : l'encre violette du jeu jurerait
// sur le métal sombre du garage.
function atelierOutline(group, thickness = 0.026) {
  const o = outlineForGroup(group, thickness);
  if (o) o.material.color.setHex(PAL.edge);
  return o;
}

// Fusionne N copies d'une même géométrie en UN seul mesh : les petites pièces
// répétées (boulons, vérins, roulettes, aérations) ne coûtent qu'un draw call.
function mergedCopies(geo, mat, placements) {
  const parts = placements.map(([px, py, pz, rx = 0, ry = 0, rz = 0]) => {
    const g = geo.clone();
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    m.setPosition(px, py, pz);
    g.applyMatrix4(m);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return new THREE.Mesh(merged, mat);
}

// Ombre cartoon : ellipse d'encre plate posée au sol.
export function makeBlobShadow(radius = 1.4) {
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.28, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.scale.x = 1.6;
  blob.userData.noOutline = true;
  blob.userData.noShadow = true;
  return blob;
}

// ---------------------------------------------------------------------------
// Textures d'atelier : dessinées au canvas, mémoïsées au niveau module et
// marquées `shared` pour que disposeModel() n'y touche jamais.
const TEX_CACHE = new Map();
function cachedTexture(key, w, h, draw, { repeat = null, wrapS = false, wrapT = false } = {}) {
  const hit = TEX_CACHE.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (wrapS) tex.wrapS = THREE.RepeatWrapping;
  if (wrapT) tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.userData.shared = true;
  TEX_CACHE.set(key, tex);
  return tex;
}

// petit générateur déterministe (mêmes taches d'huile à chaque lancement)
function seeded(seed) {
  let s = seed || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// Fond d'atelier : dégradé très sombre + halo ambré diffus + vignettage.
// (remplace le ciel de jour : `skyTexture` vit dans models3d.js, intouchable ici)
function atelierBackdrop() {
  return cachedTexture('bg:atelier', 1024, 640, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#080707');
    g.addColorStop(0.42, '#120F0D');
    g.addColorStop(0.74, '#1D1712');
    g.addColorStop(1, '#0B0908');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // nervures verticales de tôle, à peine lisibles dans la pénombre
    for (let i = 0; i < 32; i++) {
      const px = (i + 0.5) * (w / 32);
      x.fillStyle = 'rgba(255,196,140,.030)';
      x.fillRect(px - 3, 0, 3, h);
      x.fillStyle = 'rgba(0,0,0,.34)';
      x.fillRect(px, 0, 5, h);
    }
    // halo de la baladeuse (le seul point chaud du fond)
    const halo = x.createRadialGradient(w * 0.5, h * 0.62, 0, w * 0.5, h * 0.62, w * 0.44);
    halo.addColorStop(0, 'rgba(255,138,31,.20)');
    halo.addColorStop(0.45, 'rgba(255,110,20,.07)');
    halo.addColorStop(1, 'rgba(255,110,20,0)');
    x.fillStyle = halo;
    x.fillRect(0, 0, w, h);
    // vignettage : les angles retombent dans la nuit
    const vig = x.createRadialGradient(w * 0.5, h * 0.55, h * 0.28, w * 0.5, h * 0.55, w * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.85)');
    x.fillStyle = vig;
    x.fillRect(0, 0, w, h);
    // poussière en suspension dans le faisceau
    const rnd = seeded(97);
    for (let i = 0; i < 90; i++) {
      const px = w * 0.5 + (rnd() - 0.5) * w * 0.7, py = h * (0.25 + rnd() * 0.7);
      x.fillStyle = `rgba(255,206,150,${0.03 + rnd() * 0.06})`;
      x.beginPath(); x.arc(px, py, 0.8 + rnd() * 1.6, 0, 7); x.fill();
    }
  });
}

// Équirectangulaire d'atelier pour les reflets (PMREM) : plafond noir,
// bandeau chaud à hauteur des lampes, sol sombre.
function atelierEnvTexture() {
  return cachedTexture('env:atelier', 512, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#050404');
    g.addColorStop(0.34, '#171210');
    g.addColorStop(0.46, '#3A2616');
    g.addColorStop(0.58, '#1A1310');
    g.addColorStop(1, '#070605');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // trois lampes chaudes réparties : de vrais points spéculaires sur les carrosseries
    for (const cx of [0.22, 0.54, 0.84]) {
      const lamp = x.createRadialGradient(w * cx, h * 0.4, 0, w * cx, h * 0.4, w * 0.14);
      lamp.addColorStop(0, 'rgba(255,214,138,.95)');
      lamp.addColorStop(0.35, 'rgba(255,138,31,.35)');
      lamp.addColorStop(1, 'rgba(255,120,20,0)');
      x.fillStyle = lamp;
      x.fillRect(0, 0, w, h);
    }
  });
}

// Environnement de réflexions (PMREM). Sans thème → l'atelier ; avec thème
// (arènes de combat) → le ciel d'origine, que battle.js utilise toujours.
const ENV_CACHE = {};
export function envMapFor(renderer, theme = null) {
  const key = theme?.name || 'studio';
  if (!ENV_CACHE[key]) {
    const tex = theme ? skyTexture(theme) : atelierEnvTexture();
    const prevMapping = tex.mapping;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    ENV_CACHE[key] = pmrem.fromEquirectangular(tex).texture;
    ENV_CACHE[key].userData.shared = true; // jamais disposé (cache global)
    pmrem.dispose();
    if (tex.userData?.shared) tex.mapping = prevMapping; // texture mutualisée : on la rend intacte
    else tex.dispose();
  }
  return ENV_CACHE[key];
}

export function createRenderer(canvas, { shadows = false, alpha = false, antialias = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // cartoon : ombres blob (pas de shadow map) et couleurs plates exactes
  renderer.shadowMap.enabled = shadows;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

// Libère géométries/matériaux (et textures si demandé) d'un sous-arbre,
// en épargnant les ressources marquées `userData.shared` (caches globaux).
export function disposeModel(root, { textures = false } = {}) {
  root.traverse(o => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.userData?.shared) continue;
      if (textures) {
        for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap']) {
          const tex = m[key];
          if (tex && !tex.userData?.shared) tex.dispose?.();
        }
      }
      m.dispose?.();
    }
  });
}

export function sizeToCanvas(renderer, camera) {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Éclairage d'atelier : une ambiante de nuit très basse et froide, UN projecteur
// chaud ambré braqué sur le podium, un appoint large et un liseré froid qui
// dessine l'acier. Volontairement peu de sources : les aplats toon restent nets.
export function studioLights(scene) {
  // la nuit qui filtre par la verrière : froide, presque rien
  scene.add(new THREE.AmbientLight(0x3C556E, 0.42));
  // LA source : baladeuse ambrée suspendue au-dessus du pont élévateur
  const spot = new THREE.SpotLight(0xFFC98A, 1.38, 0, 0.8, 0.55, 0);
  spot.position.set(0.25, 6.4, 1.0); // dans l'axe de la baladeuse visible
  spot.target.position.set(0, 0, 0);
  scene.add(spot);
  scene.add(spot.target);
  // appoint chaud très large : hors du cône, l'atelier ne tombe pas dans le noir absolu
  const sun = new THREE.DirectionalLight(0xFF9A3C, 0.42);
  sun.position.set(3.5, 6.5, 5);
  scene.add(sun);
  // liseré froid côté opposé : c'est lui qui révèle les arêtes de tôle
  const rim = new THREE.DirectionalLight(0x6FA8D0, 0.24);
  rim.position.set(-5.5, 3.2, -6);
  scene.add(rim);
  return { sun, spot, rim };
}

// ---------------------------------------------------------------------------
// Sol de garage : béton sombre, flaque de lumière, marquages de zone jaunes,
// plaques de tôle rivetées, traces d'huile.
function garageFloorTexture() {
  return cachedTexture('floor:garage', 1024, 1024, (x, w) => {
    const rnd = seeded(31);
    const C = w / 2; // le centre du canvas = le centre du podium
    x.fillStyle = '#141110';
    x.fillRect(0, 0, w, w);
    // béton taché : marbrures larges
    for (let i = 0; i < 180; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * C;
      x.fillStyle = rnd() > 0.5 ? 'rgba(60,54,48,.16)' : 'rgba(6,5,5,.30)';
      x.beginPath();
      x.ellipse(C + Math.cos(a) * d, C + Math.sin(a) * d, 20 + rnd() * 90, 14 + rnd() * 60, rnd() * 3, 0, 7);
      x.fill();
    }
    // plaques de tôle : joints droits + rivets
    x.strokeStyle = 'rgba(0,0,0,.55)';
    x.lineWidth = 5;
    for (let i = 1; i < 6; i++) {
      x.beginPath(); x.moveTo(0, i * 170); x.lineTo(w, i * 170); x.stroke();
      x.beginPath(); x.moveTo(i * 170, 0); x.lineTo(i * 170, w); x.stroke();
    }
    x.strokeStyle = 'rgba(150,124,96,.10)';
    x.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      x.beginPath(); x.moveTo(0, i * 170 + 4); x.lineTo(w, i * 170 + 4); x.stroke();
      x.beginPath(); x.moveTo(i * 170 + 4, 0); x.lineTo(i * 170 + 4, w); x.stroke();
    }
    for (let ix = 1; ix < 6; ix++) {
      for (let iy = 1; iy < 6; iy++) {
        x.fillStyle = 'rgba(163,138,110,.16)';
        x.beginPath(); x.arc(ix * 170, iy * 170, 4, 0, 7); x.fill();
      }
    }
    // marquage de zone au pochoir : rectangle jaune usé autour du pont
    x.save();
    x.translate(C, C);
    x.strokeStyle = 'rgba(255,196,0,.30)';
    x.lineWidth = 9;
    x.setLineDash([46, 26]);
    x.strokeRect(-215, -215, 430, 430);
    x.setLineDash([]);
    // équerres d'angle pleines
    x.strokeStyle = 'rgba(255,196,0,.46)';
    x.lineWidth = 11;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      x.beginPath();
      x.moveTo(sx * 215, sy * 130);
      x.lineTo(sx * 215, sy * 215);
      x.lineTo(sx * 130, sy * 215);
      x.stroke();
    }
    // cercle de sécurité autour de l'embase
    x.strokeStyle = 'rgba(255,196,0,.22)';
    x.lineWidth = 7;
    x.setLineDash([20, 18]);
    x.beginPath(); x.arc(0, 0, 108, 0, 7); x.stroke();
    x.setLineDash([]);
    // pochoir texte
    x.fillStyle = 'rgba(255,196,0,.26)';
    x.font = '800 30px "Baloo 2", sans-serif';
    x.textAlign = 'center';
    x.fillText('ZONE 01  ·  ATELIER MAKS', 0, 262);
    x.restore();
    // traces d'huile : flaques noires à léger reflet ambré
    for (const [ox, oy, orr] of [[C + 210, C + 170, 46], [C - 250, C + 120, 34], [C + 120, C - 250, 28], [C - 160, C - 220, 22]]) {
      x.fillStyle = 'rgba(0,0,0,.62)';
      x.beginPath(); x.ellipse(ox, oy, orr, orr * 0.66, 0.6, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,138,31,.10)';
      x.beginPath(); x.ellipse(ox - orr * 0.2, oy - orr * 0.16, orr * 0.5, orr * 0.28, 0.6, 0, 7); x.fill();
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2, d = orr * (1.1 + rnd() * 0.7);
        x.fillStyle = 'rgba(0,0,0,.5)';
        x.beginPath(); x.arc(ox + Math.cos(a) * d, oy + Math.sin(a) * d, 3 + rnd() * 6, 0, 7); x.fill();
      }
    }
    // caniveau / grille d'évacuation
    x.fillStyle = 'rgba(0,0,0,.72)';
    x.fillRect(C + 300, C - 60, 54, 120);
    x.fillStyle = 'rgba(120,100,80,.18)';
    for (let i = 0; i < 7; i++) x.fillRect(C + 306, C - 52 + i * 16, 42, 7);
    // flaque de lumière de la baladeuse (par-dessus tout : c'est elle qui structure l'image)
    const pool = x.createRadialGradient(C, C - 30, 0, C, C - 30, 400);
    pool.addColorStop(0, 'rgba(255,150,50,.30)');
    pool.addColorStop(0.36, 'rgba(255,126,30,.14)');
    pool.addColorStop(0.72, 'rgba(255,110,20,.035)');
    pool.addColorStop(1, 'rgba(255,110,20,0)');
    x.fillStyle = pool;
    x.fillRect(0, 0, w, w);
    // nuit qui reprend le dessus sur les bords
    const dark = x.createRadialGradient(C, C, w * 0.20, C, C, w * 0.5);
    dark.addColorStop(0, 'rgba(6,5,5,0)');
    dark.addColorStop(1, 'rgba(5,4,4,.94)');
    x.fillStyle = dark;
    x.fillRect(0, 0, w, w);
  });
}

// Mur de tôle ondulée (tuile répétée horizontalement autour de la scène).
function shopWallTexture() {
  return cachedTexture('wall:tole', 256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0A0908');
    g.addColorStop(0.5, '#211B16');
    g.addColorStop(0.86, '#2A211A');
    g.addColorStop(1, '#100C0A');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // ondulations verticales
    for (let i = 0; i < 8; i++) {
      const px = i * 32;
      const rib = x.createLinearGradient(px, 0, px + 32, 0);
      rib.addColorStop(0, 'rgba(0,0,0,.55)');
      rib.addColorStop(0.34, 'rgba(255,190,130,.055)');
      rib.addColorStop(0.55, 'rgba(255,214,166,.085)');
      rib.addColorStop(1, 'rgba(0,0,0,.42)');
      x.fillStyle = rib;
      x.fillRect(px, 0, 32, h);
    }
    // lisses horizontales + rivets
    for (const yy of [58, 178]) {
      x.fillStyle = 'rgba(0,0,0,.5)';
      x.fillRect(0, yy, w, 9);
      x.fillStyle = 'rgba(180,150,118,.12)';
      x.fillRect(0, yy + 9, w, 2);
      for (let i = 0; i < 8; i++) {
        x.fillStyle = 'rgba(196,166,132,.16)';
        x.beginPath(); x.arc(i * 32 + 16, yy + 4, 2.4, 0, 7); x.fill();
      }
    }
    // coulures de rouille
    const rnd = seeded(7);
    for (let i = 0; i < 10; i++) {
      const px = rnd() * w, py = 58 + rnd() * 40;
      x.fillStyle = `rgba(138,74,24,${0.05 + rnd() * 0.09})`;
      x.fillRect(px, py, 2 + rnd() * 4, 40 + rnd() * 90);
    }
  }, { wrapS: true, wrapT: true, repeat: [14, 1] });
}

// Dessus du pont élévateur : tôle larmée + pochoirs jaunes + gras et rayures.
function liftPlateTexture() {
  return cachedTexture('plate:lift', 512, 512, (x, w) => {
    const rnd = seeded(11);
    const C = w / 2;
    x.fillStyle = '#332C26';
    x.fillRect(0, 0, w, w);
    // tôle larmée : chevrons en quinconce
    for (let iy = 0; iy < 20; iy++) {
      for (let ix = 0; ix < 20; ix++) {
        const px = ix * 26 + (iy % 2 ? 13 : 0), py = iy * 26;
        x.save();
        x.translate(px + 13, py + 13);
        x.rotate(iy % 2 ? 0.7 : -0.7);
        x.fillStyle = 'rgba(0,0,0,.42)';
        x.fillRect(-9, -2.5, 18, 5);
        x.fillStyle = 'rgba(196,170,140,.16)';
        x.fillRect(-9, -3.5, 18, 2);
        x.restore();
      }
    }
    // brossage circulaire de l'acier
    x.strokeStyle = 'rgba(255,220,180,.035)';
    x.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      x.beginPath(); x.arc(C, C, 20 + rnd() * 230, rnd() * 7, rnd() * 7); x.stroke();
    }
    // couronne d'avertissement jaune/noir au pochoir
    for (let i = 0; i < 56; i++) {
      const a0 = (i / 56) * Math.PI * 2, a1 = ((i + 1) / 56) * Math.PI * 2;
      x.strokeStyle = i % 2 ? 'rgba(255,196,0,.72)' : 'rgba(16,12,10,.85)';
      x.lineWidth = 26;
      x.beginPath(); x.arc(C, C, 228, a0, a1); x.stroke();
    }
    x.strokeStyle = 'rgba(0,0,0,.8)';
    x.lineWidth = 4;
    x.beginPath(); x.arc(C, C, 215, 0, 7); x.stroke();
    x.beginPath(); x.arc(C, C, 241, 0, 7); x.stroke();
    // équerres de calage des roues
    x.strokeStyle = 'rgba(255,196,0,.55)';
    x.lineWidth = 10;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      x.beginPath();
      x.moveTo(C + sx * 150, C + sy * 78);
      x.lineTo(C + sx * 150, C + sy * 150);
      x.lineTo(C + sx * 78, C + sy * 150);
      x.stroke();
    }
    // pochoir central
    x.save();
    x.translate(C, C);
    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,196,0,.34)';
    x.font = '800 40px "Baloo 2", sans-serif';
    x.fillText('LIFT 01', 0, -108);
    x.font = '800 22px "Baloo 2", sans-serif';
    x.fillStyle = 'rgba(203,184,156,.30)';
    x.fillText('MAX 2.4 t', 0, 132);
    // flèches de centrage
    x.fillStyle = 'rgba(255,196,0,.40)';
    for (const rot of [0, Math.PI]) {
      x.save(); x.rotate(rot);
      x.beginPath();
      x.moveTo(0, -66); x.lineTo(-14, -44); x.lineTo(14, -44);
      x.closePath(); x.fill();
      x.restore();
    }
    x.restore();
    // gras, éclats et rayures d'usage
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 200;
      x.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.35})`;
      x.beginPath();
      x.ellipse(C + Math.cos(a) * d, C + Math.sin(a) * d, 4 + rnd() * 26, 3 + rnd() * 14, rnd() * 3, 0, 7);
      x.fill();
    }
    // la baladeuse frappe en haut à gauche
    const lit = x.createRadialGradient(C - 70, C - 90, 0, C - 70, C - 90, 300);
    lit.addColorStop(0, 'rgba(255,168,70,.26)');
    lit.addColorStop(0.55, 'rgba(255,138,31,.08)');
    lit.addColorStop(1, 'rgba(255,138,31,0)');
    x.fillStyle = lit;
    x.fillRect(0, 0, w, w);
    const shade = x.createLinearGradient(0, 0, w, w);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.45)');
    x.fillStyle = shade;
    x.fillRect(0, 0, w, w);
  });
}

// Halo + bandes de danger peints au sol autour de l'embase du pont.
function liftApronTexture() {
  return cachedTexture('plate:apron', 512, 512, (x, w) => {
    const C = w / 2;
    x.clearRect(0, 0, w, w);
    // ombre portée du pont
    const sh = x.createRadialGradient(C, C, 150, C, C, 250);
    sh.addColorStop(0, 'rgba(4,3,3,.72)');
    sh.addColorStop(1, 'rgba(4,3,3,0)');
    x.fillStyle = sh;
    x.beginPath(); x.arc(C, C, 250, 0, 7); x.fill();
    // hachures de danger
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
      if (i % 2) continue;
      x.strokeStyle = 'rgba(255,196,0,.34)';
      x.lineWidth = 22;
      x.beginPath(); x.arc(C, C, 200, a0, a1); x.stroke();
    }
    x.strokeStyle = 'rgba(255,196,0,.20)';
    x.lineWidth = 5;
    x.beginPath(); x.arc(C, C, 186, 0, 7); x.stroke();
    x.beginPath(); x.arc(C, C, 214, 0, 7); x.stroke();
  });
}

// ---------------------------------------------------------------------------
// Scène « studio » : l'atelier la nuit — sol béton, murs de tôle, pont élévateur
// sous une unique baladeuse ambrée. Le dessus du pont RESTE à y=0.
export function createStudioScene(renderer = null) {
  const scene = new THREE.Scene();
  scene.background = atelierBackdrop();
  studioLights(scene);
  addAtelierShell(scene);
  addLiftPodium(scene);
  addShopLamp(scene);
  return scene;
}

// Coque du lieu : béton + tôle ondulée tout autour.
function addAtelierShell(scene) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshBasicMaterial({ map: garageFloorTexture() })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  // mur de tôle : un seul cylindre ouvert vu de l'intérieur (0 coût d'éclairage)
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(27, 27, 8.4, 40, 1, true),
    new THREE.MeshBasicMaterial({ map: shopWallTexture(), side: THREE.BackSide, fog: false })
  );
  wall.position.y = FLOOR_Y + 4.2;
  scene.add(wall);

  // plinthe d'ombre : le mur ne « flotte » pas sur le béton
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(26.9, 26.9, 1.1, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x070605, side: THREE.BackSide, transparent: true, opacity: 0.85, depthWrite: false })
  );
  base.position.y = FLOOR_Y + 0.55;
  scene.add(base);
}

// Le podium n'est plus un gâteau : c'est un pont élévateur d'atelier.
function addLiftPodium(scene) {
  const matPool = new Map();
  const toon = color => {
    if (!matPool.has(color)) matPool.set(color, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }));
    return matPool.get(color);
  };
  const steelDeck = toon(PAL.steel2), steelDark = toon(PAL.steel0), steelMid = toon(PAL.steel1);

  // plateau : tôle épaisse, dessus à y=0
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.22, 0.3, 48), steelDeck);
  deck.position.y = -0.15;
  scene.add(deck);
  const deckFace = new THREE.Mesh(
    new THREE.CircleGeometry(3.14, 48),
    new THREE.MeshBasicMaterial({ map: liftPlateTexture() })
  );
  deckFace.rotation.x = -Math.PI / 2;
  deckFace.position.y = 0.006;
  scene.add(deckFace);
  // arête sombre du plateau
  const lip = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.075, 8, 56), toon(PAL.ink2));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.03;
  scene.add(lip);
  // liseré lumineux sous la plaque : la seule vraie couleur saturée du décor
  const led = new THREE.Mesh(
    new THREE.TorusGeometry(3.24, 0.032, 6, 64),
    new THREE.MeshBasicMaterial({ color: PAL.amber })
  );
  led.rotation.x = Math.PI / 2;
  led.position.y = -0.33; // juste SOUS la tôle : le liseré doit déborder
  scene.add(led);

  // fût central octogonal + vérins chromés
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.42, 8), steelMid);
  column.position.y = -0.52;
  column.rotation.y = Math.PI / 8;
  scene.add(column);
  const ramGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.62, 10);
  scene.add(mergedCopies(ramGeo, toon(PAL.steelHi), [
    [1.35, -0.46, 1.35], [-1.35, -0.46, 1.35], [1.35, -0.46, -1.35], [-1.35, -0.46, -1.35],
  ]));
  ramGeo.dispose();

  // embase boulonnée au béton
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(3.75, 3.95, 0.22, 48), steelDark);
  foot.position.y = -0.76;
  scene.add(foot);
  const boltGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.1, 6);
  const bolts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    bolts.push([Math.cos(a) * 3.5, -0.62, Math.sin(a) * 3.5]);
  }
  scene.add(mergedCopies(boltGeo, toon(PAL.steelHi), bolts));
  boltGeo.dispose();
  // jupe d'encre : le pont garde un contour net contre le béton
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(3.97, 3.97, 0.1, 48),
    new THREE.MeshBasicMaterial({ color: PAL.edge })
  );
  skirt.position.y = -0.83;
  scene.add(skirt);

  // tapis peint : ombre + hachures de danger
  const apron = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 48),
    new THREE.MeshBasicMaterial({ map: liftApronTexture(), transparent: true, depthWrite: false })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = FLOOR_Y + 0.012;
  scene.add(apron);
}

// LA source : baladeuse ambrée suspendue, avec son faisceau visible.
function addShopLamp(scene) {
  const lamp = new THREE.Group();
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 3.4, 6),
    new THREE.MeshBasicMaterial({ color: 0x0E0B09 })
  );
  cord.position.y = 1.75;
  lamp.add(cord);
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.62, 0.46, 18, 1, true),
    new THREE.MeshToonMaterial({ color: PAL.steel1, gradientMap: toonGradient(), side: THREE.DoubleSide })
  );
  shade.position.y = 0.1;
  lamp.add(shade);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 6),
    new THREE.MeshToonMaterial({ color: PAL.steel0, gradientMap: toonGradient() })
  );
  cap.position.y = 0.33;
  lamp.add(cap);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshBasicMaterial({ color: PAL.signalHi })
  );
  bulb.position.y = -0.05;
  lamp.add(bulb);
  lamp.position.set(0.2, 3.05, 0.9);
  scene.add(lamp);

  // faisceau : cône additif très léger, jamais occlusif
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 2.95, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xFF9A22, transparent: true, opacity: 0.055, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
  );
  // apex pile dans la gueule de l'abat-jour, base sur la tôle du pont
  beam.position.set(0.2, 1.45, 0.9);
  beam.renderOrder = 4;
  beam.userData.noOutline = true;
  scene.add(beam);
}

export function fitCameraToBox(camera, size, dist = null) {
  const fov = camera.fov * Math.PI / 180;
  const d = dist ?? (size / 2) / Math.tan(fov / 2) * 1.25;
  camera.position.set(d * 0.55, size * 0.42 + 0.6, d * 0.9);
  camera.lookAt(0, size * 0.22, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Décor du hub : le mobilier d'atelier. Établi + panneau d'outils, casier,
// bidons, chariot, néons, enseigne MAKS lumineuse, pneus et cônes.
export function addHubDecor(scene) {
  // matériaux mutualisés par couleur : moins de programmes, plus de batching
  const matPool = new Map();
  const toon = color => {
    const k = 't' + color;
    if (!matPool.has(k)) matPool.set(k, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }));
    return matPool.get(k);
  };
  const basic = color => {
    const k = 'b' + color;
    if (!matPool.has(k)) matPool.set(k, new THREE.MeshBasicMaterial({ color }));
    return matPool.get(k);
  };
  const steel0 = toon(PAL.steel0), steel1 = toon(PAL.steel1), steel2 = toon(PAL.steel2);
  const steel3 = toon(PAL.steel3), chrome = toon(PAL.steelHi);

  // ---- charpente : poutres et néons au plafond ----
  const beamGeo = new THREE.BoxGeometry(48, 0.34, 0.3);
  beamGeo.userData.shared = true;
  for (const bz of [-6.5, -14, 1.5]) {
    const beam = new THREE.Mesh(beamGeo, steel0);
    beam.position.set(0, FLOOR_Y + 5.6, bz);
    scene.add(beam);
  }
  const strutGeo = new THREE.BoxGeometry(0.22, 0.22, 16);
  strutGeo.userData.shared = true;
  for (const sx of [-9, 9]) {
    const strut = new THREE.Mesh(strutGeo, steel0);
    strut.position.set(sx, FLOOR_Y + 5.78, -6.5);
    scene.add(strut);
  }

  // néon : caisson + tube lumineux + halo, cloné le long des poutres
  const neon = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.4), steel1);
  neon.add(box);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.9, 8), basic(0xFFF6DA));
  tube.rotation.z = Math.PI / 2;
  tube.position.y = -0.1;
  neon.add(tube);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.0),
    new THREE.MeshBasicMaterial({
      color: 0xFFD9A0, transparent: true, opacity: 0.12, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = -0.22;
  glow.userData.noOutline = true;
  neon.add(glow);
  const rodGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5);
  neon.add(mergedCopies(rodGeo, basic(0x0E0B09), [[-1.2, 0.38, 0], [1.2, 0.38, 0]]));
  rodGeo.dispose();
  for (const [nx, nz, ry] of [[-6.4, -6.5, 0], [6.4, -6.5, 0], [0, -14, 0]]) {
    const n = neon.clone();
    n.position.set(nx, FLOOR_Y + 5.1, nz);
    n.rotation.y = ry;
    scene.add(n);
  }

  // ---- enseigne MAKS lumineuse (remplace le panneau de bois) ----
  const sign = new THREE.Group();
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(6.1, 2.5, 0.26), steel0);
  sign.add(signBack);
  const signFace = new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 2.2),
    new THREE.MeshBasicMaterial({
      map: cachedTexture('sign:maks', 640, 240, (x, w, h) => {
        x.fillStyle = '#0E0B09';
        x.fillRect(0, 0, w, h);
        // tôle brossée du caisson
        for (let i = 0; i < 160; i++) {
          x.fillStyle = `rgba(255,214,166,${0.01 + (i % 5) * 0.006})`;
          x.fillRect(0, (i * 1.5) % h, w, 1);
        }
        const halo = x.createRadialGradient(w / 2, h * 0.44, 10, w / 2, h * 0.44, w * 0.5);
        halo.addColorStop(0, 'rgba(255,138,31,.42)');
        halo.addColorStop(0.5, 'rgba(255,110,20,.12)');
        halo.addColorStop(1, 'rgba(255,110,20,0)');
        x.fillStyle = halo;
        x.fillRect(0, 0, w, h);
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '800 118px "Baloo 2", sans-serif';
        // lettres néon : halo ambré puis cœur crème
        x.save();
        x.translate(w / 2, h * 0.44);
        x.lineJoin = 'round';
        x.strokeStyle = 'rgba(255,90,24,.55)';
        x.lineWidth = 26;
        x.strokeText('MAKS', 0, 0);
        x.strokeStyle = 'rgba(255,166,60,.9)';
        x.lineWidth = 12;
        x.strokeText('MAKS', 0, 0);
        x.fillStyle = '#FFF6DA';
        x.fillText('MAKS', 0, 0);
        x.restore();
        x.font = '800 30px "Baloo 2", sans-serif';
        x.fillStyle = 'rgba(203,184,156,.85)';
        x.fillText('A T E L I E R   ·   N U I T', w / 2, h * 0.83);
        // cadre + rivets
        x.strokeStyle = 'rgba(119,103,89,.5)';
        x.lineWidth = 6;
        x.strokeRect(10, 10, w - 20, h - 20);
        for (let i = 0; i < 12; i++) {
          x.fillStyle = 'rgba(163,138,110,.35)';
          x.beginPath(); x.arc(28 + i * ((w - 56) / 11), 24, 4, 0, 7); x.fill();
          x.beginPath(); x.arc(28 + i * ((w - 56) / 11), h - 24, 4, 0, 7); x.fill();
        }
      }),
    })
  );
  signFace.position.z = 0.14;
  sign.add(signFace);
  // tubes néon du cadre
  const tubeH = new THREE.CylinderGeometry(0.045, 0.045, 5.9, 6);
  const tubeV = new THREE.CylinderGeometry(0.045, 0.045, 2.3, 6);
  const neonMat = basic(PAL.amberHi);
  for (const sy of [-1.18, 1.18]) {
    const t = new THREE.Mesh(tubeH, neonMat);
    t.rotation.z = Math.PI / 2;
    t.position.set(0, sy, 0.16);
    sign.add(t);
  }
  for (const sx of [-2.95, 2.95]) {
    const t = new THREE.Mesh(tubeV, neonMat);
    t.position.set(sx, 0, 0.16);
    sign.add(t);
  }
  const signGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(8.6, 4.4),
    new THREE.MeshBasicMaterial({
      color: PAL.amber, transparent: true, opacity: 0.10, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  signGlow.position.z = 0.2;
  signGlow.userData.noOutline = true;
  sign.add(signGlow);
  // équerres de fixation
  for (const sx of [-2.2, 2.2]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.1), steel0);
    arm.position.set(sx, 0.9, -0.6);
    sign.add(arm);
  }
  sign.position.set(-7.4, FLOOR_Y + 3.15, -10.6);
  sign.rotation.y = 0.6; // face au podium
  scene.add(sign);

  // ---- établi + panneau d'outils ----
  const bench = new THREE.Group();
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 1.25), steel3);
  benchTop.position.y = 1.02;
  bench.add(benchTop);
  const benchEdge = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.07, 1.29), toon(PAL.amberLo));
  benchEdge.position.y = 0.92;
  bench.add(benchEdge);
  const legGeo = new THREE.BoxGeometry(0.16, 0.94, 0.16);
  bench.add(mergedCopies(legGeo, steel0, [
    [-1.95, 0.47, 0.5], [1.95, 0.47, 0.5], [-1.95, 0.47, -0.5], [1.95, 0.47, -0.5],
  ]));
  legGeo.dispose();
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.09, 1.0), steel0);
  shelf.position.y = 0.28;
  bench.add(shelf);
  // bloc de tiroirs
  const drawers = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 1.05), steel1);
  drawers.position.set(1.15, 0.56, 0);
  bench.add(drawers);
  const dHandleGeo = new THREE.BoxGeometry(1.0, 0.055, 0.06);
  bench.add(mergedCopies(dHandleGeo, toon(PAL.amber),
    [0, 1, 2].map(i => [1.15, 0.28 + i * 0.24, 0.55])));
  dHandleGeo.dispose();
  // étau
  const viseBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.4), chrome);
  viseBase.position.set(-1.6, 1.18, 0.06);
  bench.add(viseBase);
  const viseJaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.44), chrome);
  viseJaw.position.set(-1.42, 1.36, 0.06);
  bench.add(viseJaw);
  const viseScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), chrome);
  viseScrew.rotation.z = Math.PI / 2;
  viseScrew.position.set(-1.85, 1.3, 0.06);
  bench.add(viseScrew);
  // caisse à outils posée dessus
  const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.42), toon(PAL.ember));
  toolbox.position.set(-0.35, 1.25, -0.1);
  bench.add(toolbox);
  const toolHandle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 5, 10, Math.PI), steel0);
  toolHandle.position.set(-0.35, 1.4, -0.1);
  bench.add(toolHandle);
  const benchOutline = atelierOutline(bench, 0.028);
  if (benchOutline) bench.add(benchOutline);
  const benchShadow = makeBlobShadow(1.9);
  benchShadow.scale.x = 1.1;
  benchShadow.position.y = 0.02;
  bench.add(benchShadow);
  bench.position.set(8.4, FLOOR_Y, -5.2);
  bench.rotation.y = -1.0; // face au podium
  scene.add(bench);

  // panneau d'outils perforé, au-dessus de l'établi
  const pegTex = cachedTexture('peg:board', 512, 320, (x, w, h) => {
    x.fillStyle = '#1B1512';
    x.fillRect(0, 0, w, h);
    for (let iy = 0; iy < 20; iy++) {
      for (let ix = 0; ix < 32; ix++) {
        x.fillStyle = 'rgba(0,0,0,.55)';
        x.beginPath(); x.arc(10 + ix * 16, 12 + iy * 16, 2.6, 0, 7); x.fill();
      }
    }
    // silhouettes d'outils au pochoir
    x.strokeStyle = 'rgba(203,184,156,.42)';
    x.fillStyle = 'rgba(203,184,156,.30)';
    x.lineWidth = 7;
    x.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const px = 60 + i * 66;
      x.beginPath(); x.moveTo(px, 60); x.lineTo(px + 10, 170); x.stroke();
      x.beginPath(); x.arc(px, 52, 15, 0, 7); x.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const px = 70 + i * 84;
      x.fillRect(px, 210, 14, 78);
      x.beginPath(); x.arc(px + 7, 206, 17, 0, 7); x.fill();
    }
    // ombres portées des outils
    x.fillStyle = 'rgba(0,0,0,.45)';
    for (let i = 0; i < 5; i++) x.fillRect(66 + i * 66, 66, 8, 104);
    // lumière rasante ambrée
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,138,31,.16)');
    g.addColorStop(1, 'rgba(0,0,0,.42)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  const peg = new THREE.Group();
  const pegPanel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.5, 0.12), steel0);
  peg.add(pegPanel);
  const pegFace = new THREE.Mesh(new THREE.PlaneGeometry(3.86, 2.36), new THREE.MeshBasicMaterial({ map: pegTex }));
  pegFace.position.z = 0.07;
  peg.add(pegFace);
  peg.position.set(9.6, FLOOR_Y + 2.85, -6.0);
  peg.rotation.y = -1.0;
  scene.add(peg);

  // ---- casier vestiaire ----
  const locker = new THREE.Group();
  const lockerBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.7, 0.72), steel1);
  lockerBody.position.y = 1.35;
  locker.add(lockerBody);
  for (const sx of [-0.52, 0.52]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.5, 0.06), steel2);
    door.position.set(sx, 1.35, 0.38);
    locker.add(door);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.06), toon(PAL.steelHi));
    handle.position.set(sx + 0.36, 1.35, 0.44);
    locker.add(handle);
  }
  // grilles d'aération : 6 lames en un seul mesh
  const ventGeo = new THREE.BoxGeometry(0.5, 0.05, 0.04);
  const vents = [];
  for (const sx of [-0.52, 0.52]) for (let i = 0; i < 3; i++) vents.push([sx, 2.3 + i * 0.12, 0.43]);
  locker.add(mergedCopies(ventGeo, steel0, vents));
  ventGeo.dispose();
  const lockerTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.8), steel0);
  lockerTop.position.y = 2.74;
  locker.add(lockerTop);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(PAL.signal));
  helmet.position.set(0.5, 2.79, 0);
  locker.add(helmet);
  const lockerOutline = atelierOutline(locker, 0.028);
  if (lockerOutline) locker.add(lockerOutline);
  const lockerShadow = makeBlobShadow(1.1);
  lockerShadow.scale.x = 1.2;
  lockerShadow.position.y = 0.02;
  locker.add(lockerShadow);
  locker.position.set(-9.8, FLOOR_Y, -4.6);
  locker.rotation.y = 1.13; // face au podium
  scene.add(locker);

  // ---- bidons d'huile : un template contouré puis des clones ----
  const drumTex = cachedTexture('drum:oil', 256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2A2119');
    g.addColorStop(0.5, '#3C3026');
    g.addColorStop(1, '#1B1512');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (const yy of [46, 128, 210]) {
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(0, yy, w, 12);
      x.fillStyle = 'rgba(196,166,132,.14)'; x.fillRect(0, yy + 12, w, 3);
    }
    x.fillStyle = 'rgba(255,138,31,.85)';
    x.fillRect(0, 96, w, 34);
    x.fillStyle = '#1B1206';
    x.font = '800 26px "Baloo 2", sans-serif';
    x.textAlign = 'center';
    x.fillText('OIL 20W', w / 2, 120);
    // rouille et coulures
    const rnd = seeded(53);
    for (let i = 0; i < 22; i++) {
      x.fillStyle = `rgba(138,74,24,${0.1 + rnd() * 0.2})`;
      x.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 7, 10 + rnd() * 40);
    }
  }, { wrapS: true, repeat: [1, 1] });
  const drum = new THREE.Group();
  const drumBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 1.08, 16),
    new THREE.MeshToonMaterial({ map: drumTex, gradientMap: toonGradient() })
  );
  drumBody.position.y = 0.54;
  drum.add(drumBody);
  const ribGeo = new THREE.TorusGeometry(0.43, 0.05, 6, 16);
  drum.add(mergedCopies(ribGeo, steel0, [[0, 0.24, 0, Math.PI / 2], [0, 0.84, 0, Math.PI / 2]]));
  ribGeo.dispose();
  const drumCap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8), toon(PAL.steelHi));
  drumCap.position.set(0.22, 1.1, 0.1);
  drum.add(drumCap);
  const drumOutline = atelierOutline(drum, 0.026);
  if (drumOutline) drum.add(drumOutline);
  // un bidon couché, pour casser l'alignement (cloné AVANT l'ombre au sol,
  // qui n'aurait aucun sens une fois le bidon basculé)
  const lying = drum.clone();
  lying.position.set(-6.4, FLOOR_Y + 0.42, -7.4);
  lying.rotation.set(Math.PI / 2, 0, 0.35);
  scene.add(lying);
  const lyingShadow = makeBlobShadow(0.62);
  lyingShadow.scale.x = 1.4;
  lyingShadow.position.set(-6.4, FLOOR_Y + 0.02, -7.4);
  scene.add(lyingShadow);
  const drumShadow = makeBlobShadow(0.5);
  drumShadow.scale.x = 1.25;
  drumShadow.position.y = 0.02;
  drum.add(drumShadow);
  for (const [dx, dz, dry, ds] of [
    [6.8, 3.4, 0.4, 1], [7.7, 2.5, 1.1, 0.94], [-8.2, 1.4, 2.2, 1.02],
  ]) {
    const d = drum.clone();
    d.position.set(dx, FLOOR_Y, dz);
    d.rotation.y = dry;
    d.scale.setScalar(ds);
    scene.add(d);
  }

  // ---- chariot à outils ----
  const cart = new THREE.Group();
  const cartBody = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.7), toon(PAL.amberLo));
  cartBody.position.y = 0.72;
  cart.add(cartBody);
  const slotGeo = new THREE.BoxGeometry(1.02, 0.045, 0.05);
  const gripGeo = new THREE.BoxGeometry(0.62, 0.06, 0.07);
  const rows = [0, 1, 2];
  cart.add(mergedCopies(slotGeo, steel0, rows.map(i => [0, 0.45 + i * 0.28, 0.36])));
  cart.add(mergedCopies(gripGeo, toon(PAL.steelHi), rows.map(i => [0, 0.52 + i * 0.28, 0.38])));
  slotGeo.dispose(); gripGeo.dispose();
  const cartTop = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.8), steel3);
  cartTop.position.y = 1.22;
  cart.add(cartTop);
  const cartHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.78, 6), chrome);
  cartHandle.rotation.z = Math.PI / 2;
  cartHandle.position.set(0, 1.5, -0.34);
  cart.add(cartHandle);
  for (const sx of [-0.36, 0.36]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), chrome);
    post.position.set(sx, 1.36, -0.34);
    cart.add(post);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 10);
  cart.add(mergedCopies(wheelGeo, toon(PAL.ink2), [
    [-0.46, 0.11, 0.26, 0, 0, Math.PI / 2], [0.46, 0.11, 0.26, 0, 0, Math.PI / 2],
    [-0.46, 0.11, -0.26, 0, 0, Math.PI / 2], [0.46, 0.11, -0.26, 0, 0, Math.PI / 2],
  ]));
  wheelGeo.dispose();
  const cartOutline = atelierOutline(cart, 0.026);
  if (cartOutline) cart.add(cartOutline);
  const cartShadow = makeBlobShadow(0.62);
  cartShadow.scale.x = 1.3;
  cartShadow.position.y = 0.02;
  cart.add(cartShadow);
  cart.position.set(-5.2, FLOOR_Y, 3.1);
  cart.rotation.y = -0.5;
  scene.add(cart);
  const cart2 = cart.clone();
  cart2.position.set(4.4, FLOOR_Y, -7.6);
  cart2.rotation.y = 1.15;
  cart2.scale.setScalar(0.92);
  scene.add(cart2);

  // ---- pile de pneus (gardée : celui du haut passe en ambre) ----
  const tireGeo = new THREE.TorusGeometry(0.42, 0.2, 10, 20);
  tireGeo.userData.shared = true;
  const tireMat = toon(0x1B1614), tireTop = toon(PAL.amber);
  for (let i = 0; i < 3; i++) {
    const tire = new THREE.Mesh(tireGeo, i === 2 ? tireTop : tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(4.6 + (i % 2) * 0.12, FLOOR_Y + 0.2 + i * 0.38, 2.6);
    scene.add(tire);
  }
  const tireShadow = makeBlobShadow(0.7);
  tireShadow.position.set(4.6, FLOOR_Y + 0.02, 2.6);
  scene.add(tireShadow);
  // seconde pile, contre le mur
  for (let i = 0; i < 4; i++) {
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(-3.1 + (i % 2) * 0.1, FLOOR_Y + 0.2 + i * 0.38, -9.6);
    scene.add(tire);
  }
  const tireShadow2 = makeBlobShadow(0.7);
  tireShadow2.position.set(-3.1, FLOOR_Y + 0.02, -9.6);
  scene.add(tireShadow2);

  // ---- cônes de chantier (gardés, repeints atelier) ----
  for (const [cx2, cz2, cry] of [[-4.2, 4.6, 0.4], [6.2, -1.8, 1.7], [2.2, -8.8, 0.9]]) {
    const cone = new THREE.Group();
    const body2 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 10), toon(PAL.ember));
    body2.position.y = 0.34;
    cone.add(body2);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 6, 12), toon(PAL.cream));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.34;
    cone.add(ring2);
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.44), toon(PAL.steel0));
    base2.position.y = 0.03;
    cone.add(base2);
    cone.position.set(cx2, FLOOR_Y, cz2);
    cone.rotation.y = cry;
    scene.add(cone);
  }

  // ---- compresseur d'atelier : un dernier volume dans le fond ----
  const comp = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.7, 14), steel1);
  tank.rotation.z = Math.PI / 2;
  tank.position.y = 0.62;
  comp.add(tank);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 12), toon(PAL.amberLo));
  motor.rotation.z = Math.PI / 2;
  motor.position.set(0.1, 1.12, 0);
  comp.add(motor);
  for (const sx of [-0.7, 0.7]) {
    const foot2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.4), steel0);
    foot2.position.set(sx, 0.17, 0);
    comp.add(foot2);
  }
  const compOutline = atelierOutline(comp, 0.026);
  if (compOutline) comp.add(compOutline);
  const compShadow = makeBlobShadow(0.85);
  compShadow.position.y = 0.02;
  comp.add(compShadow);
  comp.position.set(10.2, FLOOR_Y, 1.6);
  comp.rotation.y = -1.0;
  scene.add(comp);
}
