const CACHE_NAME = 'vlink-smart-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// 1. INSTALL: Pre-cache everything
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('VLink: Caching offline assets');
      return cache.addAll(ASSETS);
    })
  );
});

// 2. ACTIVATE: Clean up old storage
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. FETCH: Offline-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached file immediately if found
      if (cachedResponse) {
        return cachedResponse;
      }

      // If not in cache, try network
      return fetch(event.request).then((networkResponse) => {
        // Cache new resources on the fly
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // If offline and not in cache, return fallback
        console.log('VLink: Offline - resource not cached');
      });
    })
  );
});
