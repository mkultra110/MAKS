// Vignettes 3D (pièces et véhicules) rendues hors-écran, avec cache.
import * as THREE from 'three';
import { createRenderer, studioLights, disposeModel, toonGradient, INK } from './render3d.js';
import { createPartModel, createCarModel, poseCarStatic, catHead } from './models3d.js';
import { buildCarSpec } from './car.js';
import { COPILOTS } from './data.js';

let renderer = null, scene = null, camera = null, holder = null, podium = null;
const cache = new Map();

function ensure() {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;
  renderer = createRenderer(canvas, { shadows: true, alpha: true });
  renderer.setPixelRatio(1);
  scene = new THREE.Scene();
  scene.background = null;
  studioLights(scene);
  podium = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.8, 0.3, 40),
    new THREE.MeshToonMaterial({ color: 0xffb800, gradientMap: toonGradient() })
  );
  // jupe d'encre : le podium garde un contour même en vignette
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(2.84, 2.84, 0.08, 40),
    new THREE.MeshBasicMaterial({ color: INK })
  );
  skirt.position.y = -0.14;
  podium.add(top, skirt);
  scene.add(podium);
  camera = new THREE.PerspectiveCamera(32, 320 / 240, 0.1, 100);
  holder = new THREE.Group();
  scene.add(holder);
}

function snapshot(model, fit, { w = 320, h = 240, podiumY = null, lookY = null } = {}) {
  ensure();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  holder.clear();
  holder.add(model);
  podium.visible = podiumY !== null;
  if (podiumY !== null) podium.position.y = podiumY - 0.15;
  const dist = (fit / 2) / Math.tan(camera.fov * Math.PI / 360) * 1.35;
  camera.position.set(dist * 0.5, fit * 0.36 + 0.35, dist * 0.86);
  camera.lookAt(0, lookY ?? fit * 0.1, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  disposeModel(holder); // le résultat est caché en dataURL, le modèle peut partir
  holder.clear();
  return url;
}

// Portrait d'un chat (co-pilotes, avatars des adversaires).
export function avatarThumb(color) {
  const key = `avatar:${color}`;
  if (cache.has(key)) return cache.get(key);
  const head = catHead(0.55, color);
  const g = new THREE.Group();
  g.add(head);
  head.position.y = 0.06;
  head.rotation.y = 0.4; // visage tourné vers la caméra
  const url = snapshot(g, 1.25, {});
  cache.set(key, url);
  return url;
}

export function copilotThumb(id) {
  return avatarThumb(COPILOTS[id].color);
}

// Vignette d'une pièce (cachée par type/peinture — le niveau ne change pas le visuel).
export function partThumb(part) {
  const key = `${part.kind}:${part.type}:${part.paint || ''}`;
  if (cache.has(key)) return cache.get(key);
  const model = createPartModel(part);
  const fit = model.userData.fit || 1.5;
  model.rotation.y = part.kind === 'body' ? -0.5 : -0.35;
  if (part.kind === 'wheel') model.rotation.y = -0.6;
  const url = snapshot(model, fit * 1.15, {});
  cache.set(key, url);
  return url;
}

// Portrait d'un véhicule complet (cartes VS, roster).
// Cache LRU dédié : types/étoiles/niveau/peinture suffisent (le visuel ne dépend de rien d'autre),
// borné à 16 entrées car chaque snapshot est un gros dataURL.
const CAR_CACHE_MAX = 16;
const carCache = new Map();
const carPartKey = p => p ? `${p.type}.${p.stars || 0}.${p.level || 0}` : '';

export function carSnapshot(loadout, { dir = 1, w = 560, h = 320 } = {}) {
  const key = `car:${carPartKey(loadout.body)}:${loadout.body?.paint || ''}` +
    `:${(loadout.wheels || []).map(carPartKey).join(',')}` +
    `:${(loadout.weapons || []).map(carPartKey).join(',')}` +
    `:${(loadout.gadgets || []).map(carPartKey).join(',')}:${dir}:${w}x${h}`;
  if (carCache.has(key)) {
    // LRU : remonte l'entrée en tête de file
    const url = carCache.get(key);
    carCache.delete(key);
    carCache.set(key, url);
    return url;
  }
  const spec = buildCarSpec(loadout);
  const model = createCarModel(spec);
  poseCarStatic(model, 1);
  if (model.userData.blob) model.userData.blob.visible = false; // trop boueux en vignette
  const fit = Math.max(spec.body.w * 0.02 * 1.55, 2.2);
  model.rotation.y = dir === 1 ? -0.55 : Math.PI + 0.55;
  const url = snapshot(model, fit, { w, h, podiumY: 0, lookY: fit * 0.16 });
  if (carCache.size >= CAR_CACHE_MAX) carCache.delete(carCache.keys().next().value); // évince le plus ancien
  carCache.set(key, url);
  return url;
}
