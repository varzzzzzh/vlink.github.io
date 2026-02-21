const CACHE_NAME = 'vlink-student-v5'; // Incremented for Zoom & Offline fix

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Libraries must be cached to work offline
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// 1. INSTALL: Pre-cache everything
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('VLink: Preparing Offline Classroom Mode');
      // Using cache.addAll to ensure everything is saved
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

// 3. FETCH: True Offline-First Strategy
// This logic ensures students can open the app with 0.00kb of data.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Return cached file immediately if found
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. If not in cache, try to get it from network
      return fetch(event.request).then((networkResponse) => {
        // Optional: Cache new resources on the fly
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // 3. FAILSAFE: If offline and not in cache, show nothing or a generic page
        console.log("VLink: Resource unavailable offline.");
      });
    })
  );
});