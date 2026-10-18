// Cache version — the __BUILD_VERSION__ token is replaced with a unique build id
// by scripts/write-version.mjs on every build. Because the worker's own bytes
// change, the browser installs the new worker, and activate() refreshes the
// shell. The token below is also the single source of truth for this worker's
// cache names: the stamped literal is already correct, so no network call is
// needed to know which build we are.
//
// __BUILD_ASSETS__ is prepended at build time (scripts/write-version.mjs) with
// every hashed JS/CSS chunk emitted by Vite, so the whole app is precached at
// install. That is what lets the app boot with no network at all.
let CACHE_NAME = 'gokez-mart-v__BUILD_VERSION__';
let IMAGE_CACHE_NAME = 'gokez-mart-images-v__BUILD_VERSION__';
const MAX_IMAGE_ENTRIES = 60;
const BUILD_ASSETS = Array.isArray(self.__BUILD_ASSETS__) ? self.__BUILD_ASSETS__ : [];
// Used only on the rare cache-miss navigation. iOS WebKit can hang a navigation
// fetch while offline instead of rejecting it, so bound it.
const NAVIGATION_TIMEOUT_MS = 4000;
// Precache a few files at a time, not all at once, so a phone on a slow
// connection is not asked to open dozens of parallel requests at install.
const PRECACHE_CONCURRENCY = 6;
// Remembers the previous cache name so activate() can keep the previous build's
// cache for one cycle. Without this, a page that is mid-load when a new worker
// claims it can ask for an old chunk whose cache was just purged; the host's SPA
// fallback would answer with HTML, the module would fail, and the screen would
// go blank even with a working connection.
const STATE_CACHE = 'gokez-mart-state';
const PREV_VERSION_KEY = '/prev-version';

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

// Fetch every URL into the cache a few at a time and never let one failure abort
// the rest. `addAll` would reject the whole batch on a single 404, and
// `cache: 'reload'` keeps the shell and its chunks exactly the bytes of this
// deploy instead of a stale HTTP-cached copy.
async function precache(cache, urls) {
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch {}
    }
  };
  const size = Math.max(1, Math.min(PRECACHE_CONCURRENCY, queue.length));
  await Promise.all(Array.from({ length: size }, worker));
}

async function readPrevCacheName() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const res = await cache.match(PREV_VERSION_KEY);
    return res ? (await res.text()) || null : null;
  } catch { return null; }
}

async function writePrevCacheName(name) {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(PREV_VERSION_KEY, new Response(name));
  } catch {}
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
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precache(cache, [...new Set([...SHELL_URLS, ...BUILD_ASSETS])]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const prev = await readPrevCacheName();
    await writePrevCacheName(CACHE_NAME);
    // Keep this build and the one before it, so a page still loading its chunks
    // across the upgrade is never left asking for a file whose cache we deleted.
    // With no recorded previous (the first run under this worker) delete nothing
    // for one cycle rather than risk the same race.
    if (prev && prev !== CACHE_NAME) {
      const keep = new Set([
        CACHE_NAME,
        IMAGE_CACHE_NAME,
        STATE_CACHE,
        prev,
        prev.replace('gokez-mart-v', 'gokez-mart-images-v'),
      ]);
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

// Fetch — network only for the API, cache-first for the app shell and assets.
self.addEventListener('fetch', (e) => {
  // Never intercept API calls
  if (e.request.url.includes('/api/')) return;

  // Navigations are served from cache first. That opens the app instantly and,
  // crucially, opens it at all on iOS, which can hold a navigation on a blank
  // screen while a network-first request is in flight. The cached shell and
  // every chunk it references are written by the same build, and the worker
  // keeps the previous build for one cycle, so a cached shell can never point at
  // a chunk that is gone. Freshness comes from the worker update (skipWaiting +
  // controllerchange), not from this handler.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match('/index.html')) ||
        (await cache.match('/')) ||
        (await cache.match(e.request, { ignoreSearch: true }));
      if (cached) return cached;
      try {
        const response = await withTimeout(fetch(e.request), NAVIGATION_TIMEOUT_MS);
        if (response && response.ok) cache.put('/index.html', response.clone()).catch(() => {});
        return response;
      } catch {
        return offlineDocument();
      }
    })());
    return;
  }

  // Images — cache first, network fallback. The lookup is across *all* caches,
  // not just the image cache, because the offline / server-unreachable artwork
  // is precached with the shell; looking only in the image cache returned a 404
  // for it exactly when it was needed.
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(response => {
        e.waitUntil(cacheImage(e.request, response));
        return response;
      }).catch(() => new Response('', { status: 404 })))
    );
    return;
  }

  // Scripts and styles — cache first, network fallback (and back-fill the cache).
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
