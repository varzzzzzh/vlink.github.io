const CACHE_NAME = 'vlink-discord-v4'; // Incremented for Sidebar & P2P update

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // External Libraries
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// 1. Install: Force cache all essential files
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('VLink: Caching Discord UI & Security Modules');
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Activate: Wipe out old versions to save phone storage
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

// 3. Fetch: "Stale-While-Revalidate" Strategy
// Loads instantly from cache, but updates the cache in the background if online.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((response) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Update the cache with the new version from network
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Fallback if network fails completely (Offline Mode)
          console.log("VLink: Running in full offline mode.");
        });

        // Return the cached version immediately (speed), 
        // while fetchPromise updates it in the background
        return response || fetchPromise;
      });
    })
  );
});