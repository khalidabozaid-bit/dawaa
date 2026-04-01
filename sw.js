// sw.js
const CACHE_NAME = 'dawaa-cache-v9.8.5';


const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './css/modules/base.css',
  './css/modules/layout.css',
  './css/modules/components.css',
  './css/modules/views.css',
  './css/modules/dark.css',
  './css/modules/auth.css',
  './js/core/db.js',
  './js/core/ui.js',
  './js/core/utils.js',
  './js/core/firebase-config.js',
  './js/core/sync.js',
  './js/features/inventory.js',
  './js/features/categories.js',
  './js/features/export.js',
  './js/app.js',
  './js/core/seed_data.js',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Inter:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Removed self.skipWaiting() - Mashawiri Stability Protocol
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // self.clients.claim(); // Removed for stability
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

