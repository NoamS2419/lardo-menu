/* Offline support for phones in the store, where the signal can be weak.
   Opening the site: the page itself is fetched from the network, but if it hasn't arrived after
   2.5 s (or the network fails) the saved page is shown, and that page then gets all its code and data
   from the saved copy too, so it runs one consistent version. The fresh files still land in the cache
   for next time.
   A page that did load from the network gets its code from the network as well (the saved copy only if
   that fails): mixing a fresh module with stale ones after a deploy can stop the site from starting.
   Product data for a fresh page: network first, the saved copy after 3.5 s.
   Product photos: their names change when they change, so the saved copy is used first.
   Only this site's own files are touched; the team board (Google) always goes to the network. */

const VERSION = 'v3';
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
const NAV_MS = 2500;

// Pages that opened from the saved copy: they get everything else from it too.
const savedClients = new Set();
let savedUntil = 0; // for browsers that don't say which page a navigation creates
const onSavedCopy = (id) => (id && savedClients.has(id)) || Date.now() < savedUntil;

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
  else if (req.mode === 'navigate') e.respondWith(openPage(e, req));
  else if (onSavedCopy(e.clientId)) e.respondWith(savedFirst(e, req));
  else if (url.pathname.endsWith('/' + DATA)) e.respondWith(networkFirst(e, req, SLOW_MS));
  else e.respondWith(networkFirst(e, req, 0));
});

// Fetches into the cache; the service worker stays alive until the write is done.
function refresh(e, cache, req) {
  const fresh = fetch(req).then((res) => {
    if (res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  return fresh;
}

const savedPage = (cache, req) => cache.match(req, { ignoreSearch: true }).then((r) => r || cache.match('index.html'));

async function openPage(e, req) {
  const cache = await caches.open(SHELL);
  const fresh = refresh(e, cache, req);
  const saved = await savedPage(cache, req);
  if (!saved) return fresh;
  const useSaved = () => {
    if (e.resultingClientId) savedClients.add(e.resultingClientId);
    else savedUntil = Date.now() + 15000;
    return saved;
  };
  const slow = new Promise((resolve) => setTimeout(resolve, NAV_MS)).then(() => 'slow');
  const first = await Promise.race([fresh.then((res) => (res.ok ? res : 'bad'), () => 'bad'), slow]);
  return first === 'slow' || first === 'bad' ? useSaved() : first;
}

async function savedFirst(e, req) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match(req, { ignoreSearch: true });
  const fresh = refresh(e, cache, req);
  return saved || fresh;
}

async function networkFirst(e, req, slowMs) {
  const cache = await caches.open(SHELL);
  const fresh = refresh(e, cache, req);
  const saved = () => cache.match(req, { ignoreSearch: true });
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
