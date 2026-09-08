// Cache version — controlled by /cache-version.json
// Bump the version in that file to force clear all caches on next deploy
let CACHE_NAME = 'gokez-mart-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('/cache-version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(({ v }) => { CACHE_NAME = `gokez-mart-v${v}`; })
      .catch(() => {})
      .then(() =>
        caches.open(CACHE_NAME).then(c =>
          c.addAll(['/index.html']).catch(() => {})
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    fetch('/cache-version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(({ v }) => { CACHE_NAME = `gokez-mart-v${v}`; })
      .catch(() => {})
      .then(() =>
        caches.keys()
          .then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
          ))
      )
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache for navigation only
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/index.html').then(r => r || fetch(e.request))
      )
    );
  }
});

// Push notification received
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'Gokez Mart', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(payload.title || 'Gokez Mart 🛒', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      image: '/mart_web_logo.png',
      data: { url: payload.url || '/' },
      vibrate: [200, 100, 200],
      tag: 'gokez-mart',
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
