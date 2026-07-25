// Modèles 3D professionnels (Kenney, CC0) : préchargés une fois au démarrage,
// puis clonés à la demande. Tout le jeu appelle ces fonctions de façon SYNCHRONE,
// donc preloadAssets() doit être terminé avant la première création de véhicule.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { clone as skinnedClone } from './lib/SkeletonUtils.js';
import { toonGradient } from './render3d.js';

const MANIFEST = {
  // carrosseries : une par type de châssis du jeu
  'body:classic': 'models/car/body-classic.glb',
  'body:titan':   'models/car/body-titan.glb',
  'body:surfer':  'models/car/body-surfer.glb',
  'body:whale':   'models/car/body-whale.glb',
  'body:pony':    'models/car/body-pony.glb',
  // roues
  'wheel:basic':  'models/car/wheel-basic.glb',
  'wheel:big':    'models/car/wheel-big.glb',
  'wheel:tiny':   'models/car/wheel-tiny.glb',
  'wheel:spiked': 'models/car/wheel-spiked.glb',
  // chats co-pilotes
  'cat:ronron':   'models/pets/cat-ronron.glb',
  'cat:tigrou':   'models/pets/cat-tigrou.glb',
  'cat:zigzag':   'models/pets/cat-zigzag.glb',
  'cat:pixel':    'models/pets/cat-pixel.glb',
  // débris de carrosserie (impacts et K.O.)
  'debris:bolt':       'models/car/debris-bolt.glb',
  'debris:bumper':     'models/car/debris-bumper.glb',
  'debris:door':       'models/car/debris-door.glb',
  'debris:drivetrain': 'models/car/debris-drivetrain.glb',
  'debris:nut':        'models/car/debris-nut.glb',
  'debris:plate':      'models/car/debris-plate-a.glb',
  'debris:spoiler':    'models/car/debris-spoiler-a.glb',
  'debris:tire':       'models/car/debris-tire.glb',
};

export const DEBRIS_KEYS = ['debris:bolt', 'debris:bumper', 'debris:door', 'debris:drivetrain',
  'debris:nut', 'debris:plate', 'debris:spoiler', 'debris:tire'];

// { root, size:Vector3, center:Vector3 } par clé
const ASSETS = {};
let ready = false;
export function assetsReady() { return ready; }

// Les packs arrivent en matériaux PBR sur un atlas de couleurs : on les repasse
// en cel-shading MAKS (la texture d'atlas est CONSERVÉE, c'est elle qui porte
// les couleurs peintes par l'artiste).
const TOON_CACHE = new Map();
function toonify(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!src) return;
    const key = `${src.map?.uuid || 'nomap'}|${src.color?.getHexString() || 'fff'}`;
    let m = TOON_CACHE.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        map: src.map || null,
        gradientMap: toonGradient(),
      });
      m.userData.shared = true; // matériau de pack : jamais disposé
      TOON_CACHE.set(key, m);
    }
    o.material = m;
    if (o.geometry) o.geometry.userData.shared = true;
  });
  return root;
}

export function preloadAssets(onProgress = null) {
  if (ready) return Promise.resolve();
  const loader = new GLTFLoader();
  const keys = Object.keys(MANIFEST);
  let done = 0;
  return Promise.all(keys.map(key => new Promise(resolve => {
    loader.load(MANIFEST[key], gltf => {
      const root = toonify(gltf.scene);
      const box = new THREE.Box3().setFromObject(root);
      ASSETS[key] = {
        root,
        size: box.getSize(new THREE.Vector3()),
        min: box.min.clone(),
        center: box.getCenter(new THREE.Vector3()),
        clips: gltf.animations || [],
      };
      done++; onProgress?.(done / keys.length);
      resolve();
    }, undefined, () => {
      // un modèle manquant ne doit jamais empêcher le jeu de démarrer
      done++; onProgress?.(done / keys.length);
      resolve();
    });
  }))).then(() => { ready = true; });
}

export function hasAsset(key) { return !!ASSETS[key]; }
export function assetInfo(key) { return ASSETS[key] || null; }
export function assetClips(key) { return ASSETS[key]?.clips || []; }

// Clone prêt à poser : recentré sur son sol (y=0 au plus bas) et centré en x/z.
export function cloneAsset(key) {
  const a = ASSETS[key];
  if (!a) return null;
  // SkeletonUtils est OBLIGATOIRE pour les modèles animés : un clone() nu
  // partagerait le squelette et ferait bouger toutes les copies ensemble
  const g = a.clips.length ? skinnedClone(a.root) : a.root.clone(true);
  g.position.set(-a.center.x, -a.min.y, -a.center.z);
  const holder = new THREE.Group();
  holder.add(g);
  holder.userData.assetSize = a.size;
  return holder;
}

// Clone mis à l'échelle pour occuper exactement `w` × `h` (unités 3D), en
// conservant les proportions du modèle sur l'axe le plus contraignant.
// `axis` = 'x' quand la longueur du modèle doit devenir la longueur du jeu.
export function cloneFitted(key, w, h, { lengthAlongZ = true } = {}) {
  const a = ASSETS[key];
  if (!a) return null;
  const holder = cloneAsset(key);
  // les véhicules Kenney pointent vers +z : on les tourne pour rouler vers +x
  const modelLen = lengthAlongZ ? a.size.z : a.size.x;
  const s = Math.min(w / modelLen, h / a.size.y);
  holder.children[0].scale.setScalar(s);
  holder.children[0].position.multiplyScalar(s);
  if (lengthAlongZ) holder.children[0].rotation.y = -Math.PI / 2;
  holder.userData.fitScale = s;
  holder.userData.fitSize = new THREE.Vector3(
    (lengthAlongZ ? a.size.z : a.size.x) * s, a.size.y * s,
    (lengthAlongZ ? a.size.x : a.size.z) * s
  );
  return holder;
}
