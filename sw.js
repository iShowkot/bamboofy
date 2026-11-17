// Offline cache: once loaded, Banshala works on the hillside without signal.
const V = 'banshala-v1';
const FILES = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest',
  'vendor/three.module.js', 'vendor/addons/controls/OrbitControls.js',
  'src/main.js', 'src/render.js', 'src/model.js', 'src/generators.js', 'src/materials.js',
  'src/solver.js', 'src/analysis.js', 'src/loads.js', 'src/terrain.js', 'src/exports.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // network first so updates arrive, cache as fallback for the hills
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
