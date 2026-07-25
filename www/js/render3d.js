// Rendu 3D partagé : création de renderers, scènes studio, éclairages.
// Direction artistique « SAMEDI MATIN » : cel-shading 3 tons, contours encre,
// couleurs plates exactes (NoToneMapping), ombres en blobs.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from './lib/BufferGeometryUtils.js';
import { skyTexture, addSkyDecor } from './models3d.js';

export const INK = 0x26183a; // l'encre signature (jamais du noir pur)
export const FLOOR_Y = -0.85; // niveau du sol des scènes hub/garage (le podium culmine à y=0)

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

// Environnement de réflexions (PMREM) généré depuis le ciel procédural —
// c'est lui qui donne aux peintures et métaux leurs vrais reflets.
const ENV_CACHE = {};
export function envMapFor(renderer, theme = null) {
  const key = theme?.name || 'studio';
  if (!ENV_CACHE[key]) {
    const tex = skyTexture(theme || undefined);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    ENV_CACHE[key] = pmrem.fromEquirectangular(tex).texture;
    ENV_CACHE[key].userData.shared = true; // jamais disposé (cache global)
    pmrem.dispose();
    tex.dispose();
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

// Éclairage cartoon : une ambiance + un soleil, rien d'autre —
// le rim bleu et le fill orange polluaient les aplats.
export function studioLights(scene) {
  // ambiance dorée de fin d'après-midi (bible : lumière chaleureuse)
  scene.add(new THREE.AmbientLight(0xFFEFD2, 0.62));
  const sun = new THREE.DirectionalLight(0xFFF6E4, 1.55);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  return { sun };
}

// Scène « studio » : podium jouet jaune sur herbe, ciel de plein jour.
// Prairie peinte façon papier découpé : patchs, halftone, chemin, fleurs.
let GRASS_TEX = null;
function grassTexture() {
  if (GRASS_TEX) return GRASS_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d');
  let s = 5;
  const srnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  x.fillStyle = '#55C468';
  x.fillRect(0, 0, 1024, 1024);
  // patchs d'herbe plus sombre
  x.fillStyle = '#47B45A';
  for (let i = 0; i < 12; i++) {
    const a = srnd() * Math.PI * 2, d = 90 + srnd() * 210;
    x.beginPath();
    x.ellipse(512 + Math.cos(a) * d, 512 + Math.sin(a) * d, 40 + srnd() * 80, 30 + srnd() * 60, srnd() * 3, 0, 7);
    x.fill();
  }
  // couronne halftone autour du podium
  x.fillStyle = '#6FDD84';
  for (let rr = 80; rr <= 135; rr += 26) {
    const n = Math.floor((Math.PI * 2 * rr) / 26);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      x.beginPath();
      x.arc(512 + Math.cos(a) * rr, 512 + Math.sin(a) * rr, 5, 0, 7);
      x.fill();
    }
  }
  // chemin de terre vers le panneau
  x.strokeStyle = '#FFE3A8';
  x.lineWidth = 55;
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(512, 512);
  x.quadraticCurveTo(400, 420, 320, 330);
  x.quadraticCurveTo(250, 250, 190, 210);
  x.stroke();
  x.strokeStyle = 'rgba(38,24,58,.25)';
  x.lineWidth = 4;
  x.setLineDash([14, 12]);
  for (const off of [-30, 30]) {
    x.beginPath();
    x.moveTo(512 + off * 0.7, 512 + off * 0.7);
    x.quadraticCurveTo(400 + off, 420 + off * 0.5, 320 + off, 330);
    x.quadraticCurveTo(250 + off, 250, 190 + off * 0.6, 210);
    x.stroke();
  }
  x.setLineDash([]);
  x.fillStyle = '#E9C98A';
  for (const [px, py] of [[420, 430], [350, 350], [280, 280], [230, 235], [380, 390]]) {
    x.beginPath();
    x.ellipse(px, py, 9, 6, 0.5, 0, 7);
    x.fill();
  }
  // fleurs à 5 pétales
  for (let i = 0; i < 10; i++) {
    const a = srnd() * Math.PI * 2, d = 150 + srnd() * 180;
    const fx = 512 + Math.cos(a) * d, fy = 512 + Math.sin(a) * d;
    const petal = i % 2 ? '#FFF6E0' : '#FF7AB8';
    const heart = i % 2 ? '#FFB800' : '#FFF6E0';
    x.strokeStyle = '#26183A';
    x.lineWidth = 2;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2;
      x.fillStyle = petal;
      x.beginPath();
      x.arc(fx + Math.cos(pa) * 9, fy + Math.sin(pa) * 9, 7, 0, 7);
      x.fill(); x.stroke();
    }
    x.fillStyle = heart;
    x.beginPath(); x.arc(fx, fy, 5, 0, 7); x.fill(); x.stroke();
  }
  // couronne extérieure plus sombre
  x.strokeStyle = '#3EA754';
  x.lineWidth = 205;
  x.beginPath();
  x.arc(512, 512, 512, 0, 7);
  x.stroke();
  GRASS_TEX = new THREE.CanvasTexture(c);
  GRASS_TEX.colorSpace = THREE.SRGBColorSpace;
  GRASS_TEX.userData.shared = true;
  return GRASS_TEX;
}

export function createStudioScene(renderer = null) {
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  addSkyDecor(scene, undefined, { sunPos: [-13, 15.5, -34], lowClouds: true, birds: true });
  studioLights(scene);

  // podium-gâteau 3 étages — le dessus RESTE à y=0 (la voiture ne bouge pas)
  const tierTop = new THREE.Mesh(
    new THREE.CylinderGeometry(3.15, 3.3, 0.3, 48),
    new THREE.MeshToonMaterial({ color: 0xFFB800, gradientMap: toonGradient() })
  );
  tierTop.position.y = -0.15;
  scene.add(tierTop);
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.085, 10, 56),
    new THREE.MeshToonMaterial({ color: 0xE29200, gradientMap: toonGradient() })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.02;
  scene.add(lip);
  const tierMid = new THREE.Mesh(
    new THREE.CylinderGeometry(3.65, 3.8, 0.3, 48),
    new THREE.MeshToonMaterial({ color: 0xE29200, gradientMap: toonGradient() })
  );
  tierMid.position.y = -0.45;
  scene.add(tierMid);
  const tierLow = new THREE.Mesh(
    new THREE.CylinderGeometry(4.15, 4.35, 0.26, 48),
    new THREE.MeshToonMaterial({ color: 0xFFF6E0, gradientMap: toonGradient() })
  );
  tierLow.position.y = -0.72;
  scene.add(tierLow);
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(4.38, 4.38, 0.1, 48),
    new THREE.MeshBasicMaterial({ color: INK })
  );
  skirt.position.y = -0.83;
  scene.add(skirt);
  for (const [rr, ry] of [[3.67, -0.30], [4.17, -0.59]]) {
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(rr, rr, 0.05, 48),
      new THREE.MeshBasicMaterial({ color: INK })
    );
    line.position.y = ry;
    scene.add(line);
  }
  // dessus décoré : anneau, tirets, étoile
  const topC = document.createElement('canvas');
  topC.width = topC.height = 512;
  const tx = topC.getContext('2d');
  tx.fillStyle = '#FFB800'; tx.fillRect(0, 0, 512, 512);
  tx.strokeStyle = '#E29200'; tx.lineWidth = 36;
  tx.beginPath(); tx.arc(256, 256, 238, 0, 7); tx.stroke();
  tx.strokeStyle = 'rgba(38,24,58,.3)'; tx.lineWidth = 10; tx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    tx.beginPath();
    tx.moveTo(256 + Math.cos(a) * 168, 256 + Math.sin(a) * 168);
    tx.lineTo(256 + Math.cos(a) * 192, 256 + Math.sin(a) * 192);
    tx.stroke();
  }
  tx.fillStyle = '#FFD84D'; tx.strokeStyle = '#E29200'; tx.lineWidth = 8; tx.lineJoin = 'round';
  tx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? 50 : 120;
    tx.lineTo(256 + Math.cos(a) * rr, 256 + Math.sin(a) * rr);
  }
  tx.closePath(); tx.fill(); tx.stroke();
  const topTex = new THREE.CanvasTexture(topC);
  topTex.colorSpace = THREE.SRGBColorSpace;
  const podiumTop = new THREE.Mesh(new THREE.CircleGeometry(3.14, 48), new THREE.MeshBasicMaterial({ map: topTex }));
  podiumTop.rotation.x = -Math.PI / 2;
  podiumTop.position.y = 0.006;
  scene.add(podiumTop);
  // ombre portée du socle
  const podShadow = new THREE.Mesh(
    new THREE.CircleGeometry(4.9, 40),
    new THREE.MeshBasicMaterial({ color: 0x26183A, transparent: true, opacity: 0.12, depthWrite: false })
  );
  podShadow.rotation.x = -Math.PI / 2;
  podShadow.position.y = FLOOR_Y + 0.012;
  scene.add(podShadow);

  // prairie peinte
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ map: grassTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  // collines-boules en papier découpé : plus de ligne d'horizon dure
  const hillGeo = new THREE.SphereGeometry(1, 20, 12);
  hillGeo.userData.shared = true;
  const hillBack = new THREE.MeshBasicMaterial({ color: 0x8FE8AC });
  const hillFront = new THREE.MeshBasicMaterial({ color: 0x5ED084 });
  const HILLS = [
    [hillBack, -29.1, -10.6, 16, 4.5, 7], [hillBack, -17.8, -25.4, 12, 3.4, 6],
    [hillBack, 0, -31, 18, 5, 8], [hillBack, 17.8, -25.4, 13, 3.8, 6], [hillBack, 29.1, -10.6, 15, 4.2, 7],
    [hillFront, -18.6, -16.7, 10, 2.8, 5], [hillFront, -7.7, -23.8, 12, 3.2, 6],
    [hillFront, 8.6, -23.5, 9, 2.4, 5], [hillFront, 21.2, -13.2, 11, 3, 5],
  ];
  for (const [hm, hx, hz, sx2, sy2, sz2] of HILLS) {
    const hill = new THREE.Mesh(hillGeo, hm);
    hill.scale.set(sx2, sy2, sz2);
    hill.position.set(hx, FLOOR_Y, hz);
    scene.add(hill);
  }
  return scene;
}

export function fitCameraToBox(camera, size, dist = null) {
  const fov = camera.fov * Math.PI / 180;
  const d = dist ?? (size / 2) / Math.tan(fov / 2) * 1.25;
  camera.position.set(d * 0.55, size * 0.42 + 0.6, d * 0.9);
  camera.lookAt(0, size * 0.22, 0);
  return d;
}

// ---------- décor du hub : stade au loin, panneau MAKS, arbres ----------
// Un vrai lieu au lieu d'un podium flottant dans le vide.
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function addHubDecor(scene) {
  const toon = color => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });

  // tribune : auvent rayé à festons + DEUX rangées de spectateurs chats
  const standTex = canvasTexture(1024, 256, x => {
    x.fillStyle = '#3A3160'; x.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 32; i++) {
      x.fillStyle = i % 2 ? '#FFF6E0' : '#FF4D5E';
      x.fillRect(i * 32, 0, 32, 56);
      x.beginPath();
      x.arc(i * 32 + 16, 56, 16, 0, Math.PI);
      x.fill();
    }
    x.fillStyle = '#26183A'; x.fillRect(0, 74, 1024, 8);
    const cols = ['#FFB800', '#FF7AB8', '#A66CFF', '#49C4F0', '#FF4D5E', '#2FD573', '#FFF6E0'];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 32; i++) {
        const hx = i * 32 + (row ? 32 : 16), hy = row ? 190 : 120;
        x.fillStyle = cols[(i * 7 + row * 3) % 7];
        x.beginPath(); x.arc(hx, hy, 13, 0, 7); x.fill();
        x.beginPath();
        x.moveTo(hx - 13, hy - 6); x.lineTo(hx - 8, hy - 20); x.lineTo(hx - 2, hy - 11);
        x.moveTo(hx + 13, hy - 6); x.lineTo(hx + 8, hy - 20); x.lineTo(hx + 2, hy - 11);
        x.fill();
        if (i % 2 === 0) {
          x.fillStyle = '#26183A';
          x.beginPath(); x.arc(hx - 5, hy - 1, 1.5, 0, 7); x.fill();
          x.beginPath(); x.arc(hx + 5, hy - 1, 1.5, 0, 7); x.fill();
        }
      }
    }
    x.fillStyle = '#26183A'; x.fillRect(0, 0, 1024, 12); x.fillRect(0, 244, 1024, 12);
  });
  standTex.wrapS = THREE.RepeatWrapping;
  standTex.repeat.set(4, 1);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 5.2, 48, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    new THREE.MeshBasicMaterial({ map: standTex, side: THREE.BackSide, fog: false })
  );
  stand.position.y = 1.75;
  scene.add(stand);
  // fanions au-dessus des tribunes
  const flagGeo = new THREE.ConeGeometry(0.34, 0.9, 4);
  const flagCols = [0xff4d5e, 0xffb800, 0x2fd573, 0xff5c9e];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.72 + i * 0.093);
    const flag = new THREE.Mesh(flagGeo, toon(flagCols[i % flagCols.length]));
    flag.position.set(Math.cos(a) * 25.5, 4.95, Math.sin(a) * 25.5);
    flag.rotation.z = Math.PI; // pointe vers le bas
    scene.add(flag);
  }

  // panneau « MAKS ARENA » : plaque d'encre, ampoules, poteaux barber
  const board = new THREE.Group();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6.75, 2.85), new THREE.MeshBasicMaterial({ color: 0x26183A }));
  back.position.set(0, 3.4, -0.10);
  board.add(back);
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 2.5, 0.18),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(512, 200, x => {
        x.fillStyle = '#FFF6E0'; x.fillRect(0, 0, 512, 200);
        x.strokeStyle = '#26183A'; x.lineWidth = 18; x.strokeRect(9, 9, 494, 182);
        x.font = '800 92px "Baloo 2", sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.save(); x.translate(256, 86); x.rotate(-0.03);
        x.fillStyle = '#FFB800';
        x.strokeStyle = '#26183A'; x.lineWidth = 10;
        x.strokeText('MAKS', 0, 0); x.fillText('MAKS', 0, 0);
        x.restore();
        x.fillStyle = '#26183A'; x.font = '800 34px "Baloo 2", sans-serif';
        x.fillText('A  R  E  N  A', 256, 158);
        for (const [bx, by] of [[9, 9], [503, 9], [9, 191], [503, 191], [256, 9], [256, 191], [9, 100], [503, 100]]) {
          x.fillStyle = '#FFD84D';
          x.strokeStyle = '#E29200';
          x.lineWidth = 5;
          x.beginPath(); x.arc(bx, by, 13, 0, 7); x.fill(); x.stroke();
        }
      }),
    })
  );
  face.position.y = 3.4;
  board.add(face);
  const barberTex = canvasTexture(64, 256, x => {
    x.fillStyle = '#FFF6E0'; x.fillRect(0, 0, 64, 256);
    x.fillStyle = '#FF4D5E';
    x.save();
    x.translate(32, 128);
    x.rotate(-0.5);
    for (let i = -6; i < 7; i++) x.fillRect(-200, i * 72, 400, 36);
    x.restore();
  });
  barberTex.wrapS = barberTex.wrapT = THREE.RepeatWrapping;
  const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8);
  const postMat = new THREE.MeshBasicMaterial({ map: barberTex });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sx * 2.6, 1.4, 0);
    board.add(post);
    const footB = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x26183A }));
    footB.scale.y = 0.5;
    footB.position.set(sx * 2.6, 0, 0);
    board.add(footB);
  }
  board.position.set(-8.5, FLOOR_Y, -9);
  board.rotation.y = 0.5;
  board.rotation.z = 0.035;
  scene.add(board);

  // arbres : UN template contouré puis 5 clones (géométries partagées)
  const treeTemplate = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.28, 1.0, 7), toon(0x8A5A33));
  trunk.position.y = 0.5;
  trunk.rotation.z = 0.05;
  treeTemplate.add(trunk);
  const leafGeo = new THREE.SphereGeometry(1.05, 12, 10);
  const leafMain = toon(0x3DBE66), leafLight = toon(0x6FE08C);
  const leaf1 = new THREE.Mesh(leafGeo, leafMain);
  leaf1.position.y = 1.75;
  leaf1.scale.set(1, 0.9, 1);
  treeTemplate.add(leaf1);
  const leaf2 = new THREE.Mesh(leafGeo, leafMain);
  leaf2.scale.setScalar(0.6);
  leaf2.position.set(0.62, 1.35, 0.1);
  treeTemplate.add(leaf2);
  const leaf3 = new THREE.Mesh(leafGeo, leafLight);
  leaf3.scale.setScalar(0.5);
  leaf3.position.set(-0.35, 2.25, 0.12);
  treeTemplate.add(leaf3);
  const fruitGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const fruitMat = toon(0xFF4D5E);
  for (const [fx, fy, fz] of [[0.6, 2.3, 0.55], [-0.8, 1.7, 0.45], [0.2, 1.45, 0.85]]) {
    const fruit = new THREE.Mesh(fruitGeo, fruitMat);
    fruit.position.set(fx, fy, fz);
    treeTemplate.add(fruit);
  }
  const treeOutline = outlineForGroup(treeTemplate, 0.03);
  if (treeOutline) treeTemplate.add(treeOutline);
  const treeShadow = makeBlobShadow(0.95);
  treeShadow.position.y = 0.02;
  treeTemplate.add(treeShadow);
  const spots = [[7.5, -6.5, 1.1], [10.5, -3.4, 1.35], [-11.5, -4, 1.2], [6.8, -11, 1.5], [-6.5, -12.5, 1.3]];
  for (const [tx, tz, s] of spots) {
    const tree = treeTemplate.clone();
    tree.scale.setScalar(s);
    tree.position.set(tx, FLOOR_Y, tz);
    scene.add(tree);
  }

  // buissons ronds fleuris
  const bushGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const bushMain = toon(0x6FE08C), bushDark = toon(0x3DBE66);
  const BUSHES = [[4.8, 2.2, 0.8], [-4.4, 3.1, 1.2], [5.6, -2.8, 1.0], [-3.6, -5.5, 0.9]];
  for (const [bx, bz, bs] of BUSHES) {
    const bush = new THREE.Group();
    const b1 = new THREE.Mesh(bushGeo, bushMain);
    b1.scale.set(0.9, 0.55, 0.9);
    bush.add(b1);
    const b2 = new THREE.Mesh(bushGeo, bushDark);
    b2.scale.set(0.45, 0.3, 0.45);
    b2.position.set(-0.2, 0.35, 0.1);
    bush.add(b2);
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), toon(0xFF7AB8));
    flower.position.set(0.3, 0.55, 0.2);
    bush.add(flower);
    const bshadow = makeBlobShadow(0.6);
    bshadow.position.y = 0.02;
    bush.add(bshadow);
    bush.scale.setScalar(bs);
    bush.position.set(bx, FLOOR_Y, bz);
    scene.add(bush);
  }

  // pile de pneus (celui du haut en rouge POW) + ombre
  const tireGeo = new THREE.TorusGeometry(0.42, 0.2, 10, 20);
  const tireMat = toon(0x3A3555), tireTop = toon(0xFF4D5E);
  for (let i = 0; i < 3; i++) {
    const tire = new THREE.Mesh(tireGeo, i === 2 ? tireTop : tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(4.6 + (i % 2) * 0.12, FLOOR_Y + 0.2 + i * 0.38, 2.6);
    scene.add(tire);
  }
  const tireShadow = makeBlobShadow(0.7);
  tireShadow.position.set(4.6, FLOOR_Y + 0.02, 2.6);
  scene.add(tireShadow);

  // cônes de chantier + ballon de plage
  for (const [cx2, cz2, cry] of [[-4.2, 4.6, 0.4], [6.2, -1.8, 1.7]]) {
    const cone = new THREE.Group();
    const body2 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 10), toon(0xFF7847));
    body2.position.y = 0.34;
    cone.add(body2);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 6, 12), toon(0xFFF6E0));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.34;
    cone.add(ring2);
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.44), toon(0xE8DCC0));
    base2.position.y = 0.03;
    cone.add(base2);
    cone.position.set(cx2, FLOOR_Y, cz2);
    cone.rotation.y = cry;
    scene.add(cone);
  }
  const ballTex = canvasTexture(256, 128, x => {
    const cols2 = ['#FF4D5E', '#FFF6E0', '#49C4F0', '#FFF6E0', '#FFB800', '#FFF6E0'];
    for (let i = 0; i < 6; i++) {
      x.fillStyle = cols2[i];
      x.fillRect(i * 43, 0, 44, 128);
    }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshBasicMaterial({ map: ballTex }));
  ball.position.set(-5.8, FLOOR_Y + 0.42, 1.9);
  scene.add(ball);
  const ballShadow = makeBlobShadow(0.4);
  ballShadow.position.set(-5.8, FLOOR_Y + 0.02, 1.9);
  scene.add(ballShadow);
}
