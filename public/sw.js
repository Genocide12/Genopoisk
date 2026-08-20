// Genopoisk Service Worker
// Caches the main app shell for offline access. Player (video streams) requires
// online and is NOT cached. Strategy:
//   - index.html, manifest, icons, bridge.js: cache-first (offline-capable)
//   - player.html: network-first (always fresh, fallback to cache)
//   - API endpoints: network-only (always need live data)
//   - Everything else (cross-origin video streams, kinopoisk API): bypass SW

const CACHE_NAME = 'genopoisk-v47';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/bridge.js',
  '/i18n.js',
  '/css/app.css',
  '/js/app.js',
  '/js/error-handler.js'
];

// Install: pre-cache the app shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL).catch(function(e) {
        console.warn('[sw] Some app shell resources failed to cache:', e);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Skip cross-origin requests (video streams, kinopoisk API, telegram scripts)
  // — let them go to network
  if (url.origin !== self.location.origin) return;

  // Skip API calls (always need live data)
  if (url.pathname.startsWith('/api/')) return;

  // Skip player.html — it always needs fresh code
  if (url.pathname === '/player.html' || url.pathname === '/debug-player.html') {
    event.respondWith(
      fetch(req).catch(function() {
        return caches.match(req);
      })
    );
    return;
  }

  // For app shell: cache-first with network update in background
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        // Return cached immediately, update cache in background
        fetch(req).then(function(res) {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, res.clone());
            });
          }
        }).catch(function() {});
        return cached;
      }
      // Not in cache — fetch from network, cache if successful
      return fetch(req).then(function(res) {
        if (!res || !res.ok) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone);
        });
        return res;
      }).catch(function() {
        // Offline and not cached — return index.html as fallback
        return caches.match('/index.html');
      });
    })
  );
});
