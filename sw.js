// sw.js
const CACHE_NAME = 'dawaa-cache-v18.7.1';
const IMAGE_CACHE_NAME = 'dawaa-images-v1';
const MAX_IMAGES = 150;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/default-med.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
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
  './js/core/seed_data.js',
  './js/core/egyptian_drugs.js',
  './js/features/inventory.js',
  './js/features/categories.js',
  './js/features/locations.js',
  './js/features/audit.js',
  './js/features/users.js',
  './js/features/tasks.js',
  './js/features/export.js',
  './js/recovery.js',
  './js/app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Inter:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => {
              if (res && res.ok) return cache.put(url, res);
            })
            .catch((err) => console.warn('SW cache item failed:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== IMAGE_CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
    ])
  );
});

async function handleImageFetch(request) {
  if (request.method !== 'GET') {
    return fetch(request);
  }

  const cache = await caches.open(IMAGE_CACHE_NAME);
  const cachedResponse = await cache.match(request, { ignoreSearch: true });
  
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      limitCacheSize(IMAGE_CACHE_NAME, MAX_IMAGES);
    }
    return networkResponse;
  }).catch(async () => {
    return cachedResponse || (await caches.match('./assets/icons/default-med.png')) || new Response('', { status: 404 });
  });

  return cachedResponse || fetchPromise;
}

async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      for (let i = 0; i < (keys.length - maxItems); i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (e) {}
}

self.addEventListener('fetch', (event) => {
  // Never intercept non-GET requests (mutations, uploads, Firestore writes)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Chrome extensions and non-HTTP
  if (!url.protocol.startsWith('http')) return;
  
  // Image requests
  const isImage = event.request.destination === 'image' || 
                  url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ||
                  url.origin.includes('firebasestorage');

  if (isImage) {
    event.respondWith(handleImageFetch(event.request));
    return;
  }

  // Navigation requests (HTML SPA)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      })
    );
    return;
  }

  // General GET requests
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        return cached || new Response('Network error (offline)', { status: 504, headers: { 'Content-Type': 'text/plain' } });
      })
  );
});
