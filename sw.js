// Paraat service worker — network-first for app code, cache fallback offline
const CACHE = 'paraat-v2';
const CORE = [
  './',
  './index.html',
  './app.js',
  './cards.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCode = sameOrigin && /\.(html|js|json|webmanifest)$|\/$/.test(url.pathname);

  if (isCode) {
    // network-first: always get latest app code when online, fall back to cache offline
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req)) || (await cache.match('./index.html'));
        }
      })
    );
  } else {
    // cache-first for images & fonts (rarely change)
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          cache.put(req, res.clone());
        }
        return res;
      })
    );
  }
});
