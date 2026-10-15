/* Offline support for phones in the store, where the signal can be weak.
   Code (pages, scripts, styles, fonts): network first, the saved copy only when the network fails.
   No timer here: mixing a fresh module with stale ones after a deploy can stop the site from starting.
   Product data: network first, but after 3.5 s the saved copy is shown (it is self-contained).
   Product photos: their names change when they change, so the saved copy is used first.
   Only this site's own files are touched; the team board (Google) always goes to the network. */

const VERSION = 'v2';
const SHELL = `lardo-shell-${VERSION}`;
const PHOTOS = 'lardo-photos';
const DATA = 'data/products.json';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', DATA,
  'js/main.js', 'js/core.js', 'js/catalog.js', 'js/learn.js', 'js/onboard.js', 'js/team.js',
  'js/cloud.js', 'js/config.js', 'js/progress.js', 'js/fx.js',
  'fonts/frank-ruhl-libre-hebrew-400-normal.woff2', 'fonts/frank-ruhl-libre-hebrew-500-normal.woff2',
  'fonts/frank-ruhl-libre-latin-400-normal.woff2', 'fonts/frank-ruhl-libre-latin-500-normal.woff2',
  'fonts/cormorant-garamond-latin-600-normal.woff2'
];
const SLOW_MS = 3500;

self.addEventListener('install', (e) => {
  // One file at a time, past the HTTP cache; a missing file doesn't block the rest.
  e.waitUntil(caches.open(SHELL)
    .then((c) => Promise.allSettled(FILES.map((f) => fetch(new Request(f, { cache: 'reload' }))
      .then((res) => (res.ok ? c.put(f, res) : null)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys
      .filter((k) => k.startsWith('lardo-shell-') && k !== SHELL).map((k) => caches.delete(k)))),
    prunePhotos()
  ]).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/data/images/')) e.respondWith(photoFirst(req));
  else if (url.pathname.endsWith('/' + DATA)) e.respondWith(networkFirst(e, req, SLOW_MS));
  else e.respondWith(networkFirst(e, req, 0));
});

async function networkFirst(e, req, slowMs) {
  const cache = await caches.open(SHELL);
  const fresh = fetch(req).then((res) => {
    if (res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  e.waitUntil(fresh.catch(() => {})); // the cache write finishes even after a slow-network answer
  const saved = () => cache.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? cache.match('index.html') : null));
  const fallback = () => saved().then((r) => r || Response.error());
  if (!slowMs) return fresh.catch(fallback);
  const old = await saved();
  if (!old) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(old), slowMs));
  return Promise.race([fresh.catch(() => old), slow]);
}

async function photoFirst(req) {
  const cache = await caches.open(PHOTOS);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Keep only the photos the current menu still uses.
async function prunePhotos() {
  try {
    const shell = await caches.open(SHELL);
    const res = await shell.match(DATA);
    if (!res) return;
    const data = await res.json();
    const keep = new Set((data.products || []).filter((p) => p.image).map((p) => p.image.split('/').pop()));
    if (!keep.size) return;
    const photos = await caches.open(PHOTOS);
    for (const req of await photos.keys()) {
      if (!keep.has(new URL(req.url).pathname.split('/').pop())) await photos.delete(req);
    }
  } catch (err) { /* best effort */ }
}
