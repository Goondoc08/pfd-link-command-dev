/* Pearland Fire Link — service worker
   BUMP THIS VERSION EVERY TIME YOU DEPLOY, or phones will keep the old links. */
const CACHE = 'pfd-link-v28';

const SHELL = [
  './',
  './index.html',
  './flowchart.html',
  './duties.html',
  './mando.html',
  './links.js',
  './shift.js',
  './mando.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon-180.png',
  './favicon-32.png',
  './fire-districts.pdf'   // ~1.6MB, precached so it opens with no signal
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first so a pushed link fix shows up immediately;
   cache is only the offline safety net. */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
