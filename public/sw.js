// Genopoisk Service Worker v79
// SIMPLIFIED — does NOT intercept navigation requests.
// Only caches static assets (JS/CSS/images) for offline.
// HTML pages go directly to network — no SW interference.

const CACHE_NAME = 'genopoisk-v85';
const STATIC_ASSETS = [
  '/css/app.css',
  '/js/app.js',
  '/js/error-handler.js',
  '/i18n.js',
  '/bridge.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // ONLY handle GET
  if (req.method !== 'GET') return;

  // SKIP cross-origin
  if (url.origin !== self.location.origin) return;

  // SKIP API calls
  if (url.pathname.startsWith('/api/')) return;

  // SKIP ALL navigation requests (HTML pages) — let browser handle directly
  // This prevents SW from breaking page loads when network is unstable
  if (req.mode === 'navigate' || req.destination === 'document') return;

  // SKIP player.html
  if (url.pathname === '/player.html') return;

  // ONLY cache static assets (JS/CSS/images/fonts)
  // Cache-first with background update
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        // Background update
        fetch(req).then(function(res) {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, res.clone()).catch(function() {});
            });
          }
        }).catch(function() {});
        return cached;
      }
      // Not in cache — fetch from network
      return fetch(req).then(function(res) {
        if (!res || !res.ok) return res;
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone).catch(function() {});
        });
        return res;
      }).catch(function() {
        // Return empty response for failed static asset
        return new Response('', { status: 404 });
      });
    })
  );
});
