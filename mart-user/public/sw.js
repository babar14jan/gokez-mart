// Cache version — the __BUILD_VERSION__ token is replaced with a unique build id
// by scripts/write-version.mjs on every build. That changed byte alone makes the
// browser install this worker; the runtime fetch below then confirms the same id.
//
// __BUILD_ASSETS__ is populated at build time (scripts/write-version.mjs prepends
// `self.__BUILD_ASSETS__ = [...]`) with every hashed JS/CSS chunk emitted by Vite.
// Precaching them at install means an update swap serves entirely from local
// cache — no network wait, so the reload reads as a smooth transition instead of
// a white shutter. In dev the property is absent and this falls back to `[]`.
let CACHE_NAME = 'gokez-mart-v__BUILD_VERSION__';
let IMAGE_CACHE_NAME = 'gokez-mart-images-v__BUILD_VERSION__';
const MAX_IMAGE_ENTRIES = 60;
const BUILD_ASSETS = Array.isArray(self.__BUILD_ASSETS__) ? self.__BUILD_ASSETS__ : [];
// A navigation fetch while offline can hang on iOS WebKit instead of rejecting,
// which leaves a blank white screen until the browser gives up. Time it out and
// fall back to the cached shell.
const NAVIGATION_TIMEOUT_MS = 3000;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // The offline / server-unreachable screens render these while the network is
  // down, so they must already be cached to display.
  '/offline.webp',
  '/server_unreachable.webp',
];

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

// Last-resort page for a first-ever offline load, before anything is cached.
// A bare 503/text body leaves a blank tab on a phone, so this carries enough to
// explain the state and offer a way back.
function offlineDocument() {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>No Internet Connection</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111}' +
    'img{width:220px;max-width:70vw;height:auto}h1{margin:24px 0 8px;font-size:1.25rem}' +
    'p{margin:0 auto;max-width:20rem;color:#555;font-size:.9rem;line-height:1.6}' +
    'button{margin-top:24px;padding:11px 18px;border:0;border-radius:12px;background:#059669;color:#fff;font-size:.875rem;font-weight:600}' +
    '@media (prefers-color-scheme:dark){body{background:#0f172a;color:#fff}p{color:#94a3b8}}' +
    '</style></head><body><div><img src="/offline.webp" alt="" onerror="this.style.display=\'none\'">' +
    '<h1>No Internet Connection</h1>' +
    '<p>It looks like your device isn\u2019t connected to the internet. Please check your connection and try again.</p>' +
    '<button onclick="location.reload()">Try Again</button></div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

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
        caches.open(CACHE_NAME).then(cache =>
          // Precache each URL independently. `addAll` rejects the whole batch if
          // a single request 404s, which previously could leave the app with no
          // cached shell at all — a blank screen on the next offline launch.
          // `cache: 'reload'` skips the HTTP cache so the shell and every chunk
          // are the exact bytes of this deploy, never a stale mix that would
          // reference a chunk the edge no longer serves.
          Promise.allSettled(
            [...new Set([...SHELL_URLS, ...BUILD_ASSETS])].map(url =>
              cache.add(new Request(url, { cache: 'reload' }))
            )
          )
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

  // For navigation requests (opening the app) — network first, so an online
  // load always gets the shell that matches the chunks the edge is currently
  // serving. Serving a cached shell first is what let a stale build point at a
  // chunk the deploy had already replaced; the edge answers that missing chunk
  // with the SPA fallback (HTML), the module never executes, and the app shows a
  // blank screen even with a working connection. The timeout keeps a hanging
  // request (iOS) from sitting on white, then the cached shell — written by the
  // same build as its chunks — boots offline.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await withTimeout(fetch(e.request), NAVIGATION_TIMEOUT_MS);
        if (response && response.ok) cache.put('/index.html', response.clone()).catch(() => {});
        return response;
      } catch {
        const cached =
          (await cache.match('/index.html')) ||
          (await cache.match('/')) ||
          (await cache.match(e.request, { ignoreSearch: true }));
        return cached || offlineDocument();
      }
    })());
    return;
  }

  // For static assets — cache first, network fallback
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => cached || fetch(e.request).then(response => {
          e.waitUntil(cacheImage(e.request, response));
          return response;
        }).catch(() => new Response('', { status: 404 })))
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
      // Was '/mart_web_logo.png', which does not exist in public/ — a dead
      // reference. Corrected to a real current MART asset. The rest of the
      // notification behaviour is unchanged.
      image: '/icons/icon-512.png',
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
