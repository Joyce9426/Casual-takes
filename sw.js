const CACHE_NAME = 'sunday-roster-m-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/main.js',
  './js/db.js',
  './js/calc.js',
  './js/router.js',
  './js/utils.js',
  './js/constants.js',
  './js/topbar.js',
  './js/authGate.js',
  './js/config.js',
  './js/session.js',
  './js/api.js',
  './js/sync.js',
  './js/sessionShared.js',
  './js/lineShare.js',
  './js/views/dashboard.js',
  './js/views/seasons.js',
  './js/views/seasonDetail.js',
  './js/views/sessions.js',
  './js/views/sessionDetail.js',
  './js/views/members.js',
  './js/views/settings.js',
  './js/views/adminUsers.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-line-button.png',
  './icons/icon-settings-button.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation, cache-first for static assets, always offline-safe.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
