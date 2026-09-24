// Cache version — controlled by /cache-version.json
let CACHE_NAME = 'gokez-mart-v1';
let IMAGE_CACHE_NAME = 'gokez-mart-images-v1';
const MAX_IMAGE_ENTRIES = 60;

async function cacheImage(request, response) {
  if (!response.ok && response.type !== 'opaque') return;
  const cache = await caches.open(IMAGE_CACHE_NAME);
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGE_ENTRIES)).map(key => cache.delete(key)));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('/cache-version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(({ v }) => { CACHE_NAME = `gokez-mart-v${v}`; IMAGE_CACHE_NAME = `gokez-mart-images-v${v}`; })
      .catch(() => {})
      .then(() =>
        caches.open(CACHE_NAME).then(c =>
          // Cache the app shell — critical for home screen launch
          c.addAll([
            '/',
            '/index.html',
            '/manifest.json',
            '/icons/icon-192.png',
            '/icons/icon-512.png',
          ]).catch(() => {})
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    fetch('/cache-version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(({ v }) => { CACHE_NAME = `gokez-mart-v${v}`; IMAGE_CACHE_NAME = `gokez-mart-images-v${v}`; })
      .catch(() => {})
      .then(() =>
        caches.keys()
          .then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME && k !== IMAGE_CACHE_NAME).map(k => caches.delete(k))
          ))
      )
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

// Fetch — network first for API, cache-first for app shell
self.addEventListener('fetch', (e) => {
  // Never intercept API calls
  if (e.request.url.includes('/api/')) return;

  // For navigation requests (opening the app) — network first, fallback to cached index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          // Cache the fresh response
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return response;
        })
        .catch(() =>
          // Offline or error — serve cached index.html
          caches.match('/index.html')
            .then(r => r || caches.match('/'))
            .then(r => r || new Response('App is offline. Please check your connection.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            }))
        )
    );
    return;
  }

  // For static assets — cache first, network fallback
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => cached || fetch(e.request).then(response => {
          e.waitUntil(cacheImage(e.request, response));
          return response;
        }).catch(() => new Response('', { status: 404 }))
      )
    );
    return;
  }

  if (e.request.destination === 'style' || e.request.destination === 'script') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return response;
        }).catch(() => cached || new Response('', { status: 404 }));
      })
    );
  }
});

// Push notification received
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'Order update', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(payload.title || 'Order update', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      image: '/mart_web_logo.png',
      data: { url: payload.url || '/' },
      vibrate: [200, 100, 200],
      tag: payload.tag || 'gokez-mart',
      renotify: true,
    })
  );
});

// Notification click — open/focus the app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
