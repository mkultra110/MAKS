// Rendu 3D partagé : création de renderers, scènes studio, éclairages.
// Direction artistique « SAMEDI MATIN » : cel-shading 3 tons, contours encre,
// couleurs plates exactes (NoToneMapping), ombres en blobs.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from './lib/BufferGeometryUtils.js';
import { skyTexture, addSkyDecor } from './models3d.js';

export const INK = 0x26183a; // l'encre signature (jamais du noir pur)

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
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  return { sun };
}

// Scène « studio » : podium jouet jaune sur herbe, ciel de plein jour.
export function createStudioScene(renderer = null) {
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  addSkyDecor(scene, undefined, { sunPos: [9, 11, -30] });
  studioLights(scene);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.7, 0.42, 48),
    new THREE.MeshToonMaterial({ color: 0xffb800, gradientMap: toonGradient() })
  );
  podium.position.y = -0.21;
  scene.add(podium);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.55, 0.06, 8, 64),
    new THREE.MeshBasicMaterial({ color: INK })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.005;
  scene.add(ring);
  // jupe d'encre du podium (fait office de contour)
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(3.74, 3.74, 0.1, 48),
    new THREE.MeshBasicMaterial({ color: INK })
  );
  skirt.position.y = -0.4;
  scene.add(skirt);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshToonMaterial({ color: 0x3fbf63, gradientMap: toonGradient() })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.44;
  scene.add(floor);
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

  // tribunes : un long mur courbe rayé de couleurs, cerclé d'encre
  const standTex = canvasTexture(1024, 128, x => {
    x.fillStyle = '#FFF6E0'; x.fillRect(0, 0, 1024, 128);
    const cols = ['#FF4D5E', '#FFB800', '#2FD573', '#49C4F0', '#FF5C9E'];
    for (let i = 0; i < 64; i++) {
      x.fillStyle = cols[i % cols.length];
      x.fillRect(i * 16, 34, 12, 60);
    }
    x.fillStyle = '#26183A'; x.fillRect(0, 0, 1024, 12); x.fillRect(0, 116, 1024, 12);
  });
  standTex.wrapS = THREE.RepeatWrapping;
  standTex.repeat.set(3, 1);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 5.2, 48, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    new THREE.MeshBasicMaterial({ map: standTex, side: THREE.BackSide, fog: false })
  );
  stand.position.y = 2.2;
  scene.add(stand);
  // fanions au-dessus des tribunes
  const flagGeo = new THREE.ConeGeometry(0.34, 0.9, 4);
  const flagCols = [0xff4d5e, 0xffb800, 0x2fd573, 0xff5c9e];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.72 + i * 0.093);
    const flag = new THREE.Mesh(flagGeo, toon(flagCols[i % flagCols.length]));
    flag.position.set(Math.cos(a) * 25.5, 5.4, Math.sin(a) * 25.5);
    flag.rotation.z = Math.PI; // pointe vers le bas
    scene.add(flag);
  }

  // panneau « MAKS ARENA » sur deux poteaux
  const board = new THREE.Group();
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
      }),
    })
  );
  face.position.y = 3.4;
  board.add(face);
  const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, toon(0x26183a));
    post.position.set(sx * 2.6, 1.4, 0);
    board.add(post);
  }
  board.position.set(-8.5, -0.44, -9);
  board.rotation.y = 0.5;
  scene.add(board);

  // arbres boules : tronc brun + feuillage à deux verts + ombre blob
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8);
  const leafGeo = new THREE.SphereGeometry(1.05, 12, 10);
  const leafMat = toon(0x2fae5f), leafMat2 = toon(0x3fcf74);
  const trunkMat = toon(0x7a4a2a);
  const spots = [[7.5, -6.5, 1.1], [10.5, -3.4, 1.35], [-11.5, -4, 1.2], [6.8, -11, 1.5], [-6.5, -12.5, 1.3]];
  spots.forEach(([tx, tz, s], i) => {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.5;
    tree.add(trunk);
    const leaf = new THREE.Mesh(leafGeo, i % 2 ? leafMat : leafMat2);
    leaf.position.y = 1.6;
    leaf.scale.y = 0.9;
    tree.add(leaf);
    const shadow = makeBlobShadow(0.8);
    shadow.position.y = 0.02;
    tree.add(shadow);
    tree.scale.setScalar(s);
    tree.position.set(tx, -0.44, tz);
    scene.add(tree);
  });

  // pneus décoratifs empilés près du podium (clin d'œil garage)
  const tireGeo = new THREE.TorusGeometry(0.42, 0.2, 10, 20);
  const tireMat = new THREE.MeshToonMaterial({ color: 0x2e2a44, gradientMap: toonGradient() });
  for (let i = 0; i < 3; i++) {
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(4.6 + (i % 2) * 0.12, -0.44 + 0.2 + i * 0.38, 2.6);
    scene.add(tire);
  }
}
