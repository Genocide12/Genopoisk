// Genopoisk Service Worker v77
// Strategy:
//   - HTML pages (navigations): network-first, fallback to cache
//   - Static assets (JS/CSS/images): cache-first, background update
//   - API endpoints: network-only (bypass SW)
//   - Cross-origin: bypass SW

const CACHE_NAME = 'genopoisk-v77';
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/bridge.js',
  '/i18n.js',
  '/css/app.css',
  '/js/app.js',
  '/js/error-handler.js'
];

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
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // HTML pages: network-first (always get fresh HTML)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then(function(res) {
          if (res && res.ok) {
            var clone = res.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, clone).catch(function() {});
            });
          }
          return res;
        })
        .catch(function() {
          return caches.match(req).then(function(cached) {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Static assets: cache-first with background update
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        fetch(req).then(function(res) {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, res.clone()).catch(function() {});
            });
          }
        }).catch(function() {});
        return cached;
      }
      return fetch(req).then(function(res) {
        if (!res || !res.ok) return res;
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone).catch(function() {});
        });
        return res;
      }).catch(function() {
        return caches.match('/index.html');
      });
    })
  );
});
