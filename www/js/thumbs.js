// Vignettes 3D (pièces et véhicules) rendues hors-écran, avec cache.
import * as THREE from 'three';
import { createRenderer, disposeModel, toonGradient, INK } from './render3d.js';
import { createPartModel, createCarModel, poseCarStatic, catHead } from './models3d.js';
import { buildCarSpec } from './car.js';
import { COPILOTS } from './data.js';
import { cloneAsset, hasAsset, assetInfo } from './assets.js';

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
  // éclairage PROPRE aux vignettes : elles se lisent sur des cartes d'acier sombre,
  // donc les pièces doivent rester franches (l'ambiance nocturne les noierait)
  scene.add(new THREE.AmbientLight(0xFFF1DC, 0.82));
  const key = new THREE.DirectionalLight(0xFFF6E4, 1.35);
  key.position.set(4, 9, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xFFB870, 0.45); // appoint ambré : ancre la pièce dans la DA
  fill.position.set(-5, 2, 3);
  scene.add(fill);
  // liseré arrière : détache la silhouette des pièces sombres (pneus, blindages)
  // sur les cartes d'acier — sans lui, elles disparaissent dans le fond
  const rim = new THREE.DirectionalLight(0xFFF0D8, 1.15);
  rim.position.set(-2, 5, -7);
  scene.add(rim);
  podium = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.8, 0.3, 40),
    new THREE.MeshToonMaterial({ color: 0xFF8A1F, gradientMap: toonGradient() })
  );
  // socle sombre : le podium garde un contour même en vignette
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(2.84, 2.84, 0.08, 40),
    new THREE.MeshBasicMaterial({ color: 0x0B0907 })
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

// Portrait d'un chat (co-pilotes, profil). `id` donne accès au vrai modèle.
export function avatarThumb(color, id = null) {
  const key = `avatar:${id || color}`;
  if (cache.has(key)) return cache.get(key);
  const g = new THREE.Group();
  const glb = id && hasAsset('cat:' + id) ? cloneAsset('cat:' + id) : null;
  if (glb) {
    const info = assetInfo('cat:' + id);
    const s = 1.2 / info.size.y;
    glb.children[0].scale.setScalar(s);
    glb.children[0].position.multiplyScalar(s);
    glb.rotation.y = 0.35; // trois quarts : on voit le museau et le profil
    g.add(glb);
    const url = snapshot(g, 1.5, {});
    cache.set(key, url);
    return url;
  }
  const head = catHead(0.55, color);
  g.add(head);
  head.position.y = 0.06;
  head.rotation.y = 0.4; // visage tourné vers la caméra
  const url = snapshot(g, 1.25, {});
  cache.set(key, url);
  return url;
}

export function copilotThumb(id) {
  return avatarThumb(COPILOTS[id].color, id);
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
