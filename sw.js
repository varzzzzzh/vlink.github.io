const CACHE_NAME = 'vlink-chat-v3'; // Version incremented for Chat UI update

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

// Install: Cache everything needed for the Chat UI
self.addEventListener('install', (event) => {
  // Force the waiting service worker to become the active one immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('VLink: System Offline Assets Cached');
      return cache.addAll(ASSETS);
    })
  );
});

// Activate: Purge old VLink versions to free up phone storage
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  // Ensure the updated sw.js takes control of the page immediately
  self.clients.claim();
});

// Fetch: "Cache First" Strategy
// This ensures the app loads instantly even with zero bars of signal.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Optional: return a custom offline page if fetch fails and no cache
        console.log("VLink: Fetch failed, no network available.");
      });
    })
  );
});