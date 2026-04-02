// sw.js
const CACHE_NAME = 'dawaa-cache-v10.1.0';
const IMAGE_CACHE_NAME = 'dawaa-images-v1'; // Dedicated store for medicine visual assets
const MAX_IMAGES = 100; // Limit to avoid device storage bloat


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
  self.clients.claim(); // v9.10.1: Immediate sovereignty
  
  // Purge older caches (v10.1.0: Preserve IMAGE_CACHE_NAME)
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

/**
 * Strategy: Visual Sovereignty (Stale-While-Revalidate) v10.1.0
 * For images, use the cache but fetch updates in the background.
 */
async function handleImageFetch(request) {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then(networkResponse => {
      if (networkResponse.ok) {
          cache.put(request, networkResponse.clone());
          limitCacheSize(IMAGE_CACHE_NAME, MAX_IMAGES);
      }
      return networkResponse;
  }).catch(() => {
      // Silently fail network if offline; we already have cachedResponse
  });

  return cachedResponse || fetchPromise;
}

/**
 * Prevent device storage bloat v10.1.0
 */
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
      await cache.delete(keys[0]);
  }
}


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // v10.1.0: Intercept image requests (Medicine Photos & Icons)
  const isImage = event.request.destination === 'image' || 
                  url.pathname.match(/\.(png|jpg|jpeg|gif|webp)$/i) ||
                  url.origin.includes('firebasestorage');

  if (isImage) {
      event.respondWith(handleImageFetch(event.request));
      return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

