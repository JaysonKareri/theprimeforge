// The Forge Service Worker v27 — graceful caching, no hard failures
const CACHE = 'forge-v57';
// Only cache the truly critical files — icons are optional
const CRITICAL = ['/index.html'];
const OPTIONAL = ['/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // Cache critical files first (must succeed)
      return cache.addAll(CRITICAL).then(function() {
        // Cache optional files one by one, ignoring failures
        return Promise.allSettled(
          OPTIONAL.map(function(url) {
            return cache.add(url).catch(function(err) {
              console.log('[SW] Optional file not cached:', url, err.message);
            });
          })
        );
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  // Don't intercept API calls — always go to network
  if (e.request.url.includes('/api/')) return;
  // Don't intercept Supabase calls
  if (e.request.url.includes('supabase.co')) return;
  // Don't intercept auth callbacks
  if (e.request.url.includes('token_hash')) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache successful GET responses for same-origin assets
        if (response.ok && e.request.method === 'GET' &&
            e.request.url.startsWith(self.location.origin)) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Push notification support
self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : { title: 'The Forge', body: 'Time to train.' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'The Forge', {
      body: data.body || 'Your workout is waiting.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
