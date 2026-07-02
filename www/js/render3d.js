// Rendu 3D partagé : création de renderers, scènes studio, éclairages.
import * as THREE from 'three';
import { skyTexture } from './models3d.js';

export function createRenderer(canvas, { shadows = true, alpha = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  return renderer;
}

export function sizeToCanvas(renderer, camera) {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Éclairage « plateau » à 3 points, réutilisé partout.
export function studioLights(scene, { intensity = 1 } = {}) {
  const hemi = new THREE.HemisphereLight(0xcfd6ff, 0x2a1f3d, 0.85 * intensity);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4 * intensity);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.002;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7a9dff, 1.1 * intensity);
  rim.position.set(-6, 3, -5);
  scene.add(rim);
  const fill = new THREE.PointLight(0xff9d5e, 12 * intensity, 20);
  fill.position.set(-3, 1.2, 4);
  scene.add(fill);
  return { hemi, key, rim, fill };
}

// Scène « studio » : podium circulaire + fond dégradé, pour garage/vitrines.
export function createStudioScene() {
  const scene = new THREE.Scene();
  scene.background = skyTexture();
  studioLights(scene);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.7, 0.36, 48),
    new THREE.MeshStandardMaterial({ color: 0x272458, metalness: 0.5, roughness: 0.4 })
  );
  podium.position.y = -0.18;
  podium.receiveShadow = true;
  scene.add(podium);
  const ringGeo = new THREE.TorusGeometry(3.55, 0.045, 8, 64);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc93e }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.005;
  scene.add(ring);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshStandardMaterial({ color: 0x141232, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  floor.receiveShadow = true;
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
