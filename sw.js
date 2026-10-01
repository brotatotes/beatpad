// Beat Pad service worker: keeps the app shell and every sample you have played available offline.
const VERSION = 'beatpad-v1';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest', 'icon.svg',
  'src/theory.js', 'src/core.js', 'src/engine.js', 'src/kits.js', 'src/ui.js', 'src/sheets.js',
  'fonts/ebgaramond-regular.woff2', 'fonts/ebgaramond-bold.woff2', 'fonts/ebgaramond-italic.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isSample = url.pathname.includes('/samples/');
  if (isSample) {
    // samples never change for a given file name: cache first
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // app shell: network first so updates arrive, cache when offline
  const key = url.search ? new Request(url.origin + url.pathname) : req;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(VERSION).then((c) => c.put(key, copy))); }
    return res;
  }).catch(() => caches.match(key, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
