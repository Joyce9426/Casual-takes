const CACHE_NAME = 'sunday-roster-m-v18';
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
  './js/grouping.js',
  './js/views/dashboard.js',
  './js/views/seasons.js',
  './js/views/seasonDetail.js',
  './js/views/sessions.js',
  './js/views/sessionDetail.js',
  './js/views/sessionGrouping.js',
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

  // 只快取這個網站自己的靜態資源。後端 Worker 的 API（/auth/me、/sync/pull
  // 等）是不同網域，完全不要讓這裡的快取邏輯碰——不然像 /auth/me 這種網址
  // 固定不變的請求，一旦某次因為 token 失效收到 401，這個失敗回應會被永久
  // 快取住，之後就算重新登入拿到新 token，也會一直吃到快取住的舊 401，被
  // 誤判成登入又失效了，馬上被踢出去（症狀：重新登入後馬上被登出，只有
  // 清快取才能正常登入）。
  if (new URL(req.url).origin !== self.location.origin) return;

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
