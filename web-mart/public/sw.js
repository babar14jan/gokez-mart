// Install — take control immediately
self.addEventListener('install', () => self.skipWaiting());

// Activate — clear all old caches + take control
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
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
