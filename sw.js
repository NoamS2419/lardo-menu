/* Offline support for phones in the store, where the signal can be weak.
   Pages, code and data: network first (so updates reach everyone), the saved copy if the network
   is slow or gone. Product photos: their names change when they change, so the saved copy is used first.
   Only this site's own files are touched; the team board (Google) always goes to the network. */

const VERSION = 'v1';
const SHELL = `lardo-shell-${VERSION}`;
const PHOTOS = 'lardo-photos';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'data/products.json',
  'js/main.js', 'js/core.js', 'js/catalog.js', 'js/learn.js', 'js/onboard.js', 'js/team.js',
  'js/cloud.js', 'js/config.js', 'js/progress.js', 'js/fx.js',
  'fonts/frank-ruhl-libre-hebrew-400-normal.woff2', 'fonts/frank-ruhl-libre-hebrew-500-normal.woff2',
  'fonts/frank-ruhl-libre-latin-400-normal.woff2', 'fonts/frank-ruhl-libre-latin-500-normal.woff2',
  'fonts/cormorant-garamond-latin-600-normal.woff2'
];
const SLOW_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lardo-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/data/images/')) e.respondWith(photoFirst(req));
  else e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const saved = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  if (!saved) return fresh;
  // Slow network: show the saved copy now; the fresh one still lands in the cache for next time.
  const slow = new Promise((resolve) => setTimeout(() => resolve(saved), SLOW_MS));
  return Promise.race([fresh.catch(() => saved), slow]);
}

async function photoFirst(req) {
  const cache = await caches.open(PHOTOS);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
