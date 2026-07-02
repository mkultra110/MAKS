// Service worker : jeu 100% jouable hors-ligne, mises à jour propagées.
const CACHE = 'maks-v5';
const ASSETS = [
  '.', 'index.html', 'css/style.css',
  'js/main.js', 'js/data.js', 'js/state.js', 'js/car.js', 'js/garage.js', 'js/battle.js', 'js/sfx.js',
  'js/render3d.js', 'js/models3d.js', 'js/thumbs.js',
  'js/lib/matter.min.js', 'js/lib/three.module.min.js',
  'js/lib/postprocessing/EffectComposer.js', 'js/lib/postprocessing/RenderPass.js',
  'js/lib/postprocessing/ShaderPass.js', 'js/lib/postprocessing/UnrealBloomPass.js',
  'js/lib/postprocessing/Pass.js', 'js/lib/postprocessing/MaskPass.js', 'js/lib/postprocessing/OutputPass.js',
  'js/lib/shaders/CopyShader.js', 'js/lib/shaders/LuminosityHighPassShader.js', 'js/lib/shaders/OutputShader.js',
  'fonts/baloo-2-latin-400-normal.woff2', 'fonts/baloo-2-latin-700-normal.woff2', 'fonts/baloo-2-latin-800-normal.woff2',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // navigation : réseau d'abord (les mises à jour arrivent), cache en secours
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
    );
    return;
  }

  // assets : cache d'abord, réseau en secours (mis en cache seulement si OK)
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
