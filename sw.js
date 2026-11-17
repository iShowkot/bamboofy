// Offline cache: once loaded, Bamboofy works on the hillside without signal.
const V = 'bamboofy-v8';
const FILES = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'assets/logo-mark.svg', 'assets/icon-192.png',
  'vendor/three.module.js', 'vendor/addons/controls/OrbitControls.js', 'vendor/addons/controls/TransformControls.js',
  'src/main.js', 'src/render.js', 'src/model.js', 'src/generators.js', 'src/materials.js',
  'src/solver.js', 'src/analysis.js', 'src/loads.js', 'src/terrain.js', 'src/exports.js', 'src/draw.js', 'src/viewcube.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // network first so updates arrive, cache as fallback for the hills
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
