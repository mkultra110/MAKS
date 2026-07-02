// Rendu 3D partagé : création de renderers, scènes studio, éclairages.
// Direction artistique « SAMEDI MATIN » : cel-shading 3 tons, contours encre,
// couleurs plates exactes (NoToneMapping), ombres en blobs.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from './lib/BufferGeometryUtils.js';
import { skyTexture } from './models3d.js';

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
