// Service worker for Gokez Mart.
//
// Strategy, in one line: the network wins whenever it answers, the cache is the
// safety net, and the worker cleans up after itself and can recover a device that
// is stuck on a broken build.
//
// The __BUILD_VERSION__ token is replaced with a unique build id by
// scripts/write-version.mjs on every build. Because the worker's own bytes change
// the browser installs the new worker; the stamped literal is the single source of
// truth for this worker's cache names, so no network call is needed here.
//
// __BUILD_ASSETS__ is prepended at build time with every hashed JS/CSS chunk Vite
// emitted, so the whole app is precached at install and can boot with no network.
let CACHE_NAME = 'gokez-mart-v__BUILD_VERSION__';
let IMAGE_CACHE_NAME = 'gokez-mart-images-v__BUILD_VERSION__';
const MAX_IMAGE_ENTRIES = 60;
const BUILD_ASSETS = Array.isArray(self.__BUILD_ASSETS__) ? self.__BUILD_ASSETS__ : [];

// A navigation that has not answered within this long falls back to the cached
// shell. Bounded because iOS WebKit can hang a navigation fetch while offline
// instead of rejecting it.
const NAVIGATION_TIMEOUT_MS = 3000;
// Precache a few files at a time so a phone on a slow connection is not asked to
// open dozens of parallel requests at install.
const PRECACHE_CONCURRENCY = 6;
// One-time per device: after this worker first activates it reloads any open tab
// so a device left on a broken cached shell from an older worker comes back
// without the user having to do anything. Guarded so it never fires again.
const STATE_CACHE = 'gokez-mart-state';
const RECOVERY_KEY = '/recovered-v2';

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // The launch splash artwork. Both are on screen in the very first paint, so
  // they are precached with the shell: an offline cold start then shows the
  // same branded splash as an online one, instead of a broken logo and a gap
  // where the artwork should be.
  '/Gokez_mart_brand_transparent.webp',
  '/splash2.webp',
  // The offline / server-down screens render these while the network is down,
  // so they must already be cached to display.
  '/offline.webp',
  '/backend_donw.webp',
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

// Fetch every URL into the cache a few at a time. Returns the URLs that failed so
// the caller can retry them; one bad file never aborts the rest. `addAll` would
// reject the whole batch on a single failure, and `cache: 'reload'` keeps the
// shell and its chunks as the bytes of this deploy rather than a stale copy.
async function precache(cache, urls) {
  const queue = [...urls];
  const failed = [];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch { failed.push(url); }
    }
  };
  const size = Math.max(1, Math.min(PRECACHE_CONCURRENCY, queue.length));
  await Promise.all(Array.from({ length: size }, worker));
  return failed;
}

// Last-resort page for a first-ever offline load, before anything is cached. A
// bare 503/text body leaves a blank tab on a phone, so this carries enough to
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
    'button{margin-top:24px;padding:11px 18px;border:0;border-radius:12px;background:#087a43;color:#fff;font-size:.875rem;font-weight:600}' +
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
    const urls = [...new Set([...SHELL_URLS, ...BUILD_ASSETS])];
    let failed = await precache(cache, urls);
    if (failed.length) failed = await precache(cache, failed); // one retry pass
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Remove every cache that is not part of this build. This is what clears the
    // accumulated, possibly broken shells from earlier workers — the ones that
    // make a phone show a blank page while a clean desktop (no worker) still works.
    const keep = new Set([CACHE_NAME, IMAGE_CACHE_NAME, STATE_CACHE]);
    const keys = await caches.keys();
    const hadOldBuild = keys.some(k => !keep.has(k));
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));

    await self.clients.claim();

    // One-time recovery: when this worker takes over from an older one, reload any
    // open window so a tab stuck on an old broken shell revives by itself. Skipped
    // on a first-ever install (nothing to recover), and guarded so it runs at most
    // once per device rather than on every deploy.
    try {
      const state = await caches.open(STATE_CACHE);
      if (hadOldBuild && !(await state.match(RECOVERY_KEY))) {
        await state.put(RECOVERY_KEY, new Response('1'));
        const clients = await self.clients.matchAll({ type: 'window' });
        // Ask each open page to reload itself first. This is the reliable path:
        // navigate() is refused ("Cannot navigate to URL") — or can hang — while
        // the browser still treats the previous worker as the client's controller.
        // The app installs a listener for this message in registerServiceWorker().
        clients.forEach(c => { try { c.postMessage({ type: 'GOKEZ_FORCE_RELOAD' }); } catch {} });
        // Belt-and-braces for clients with no listener. Never awaited, so a hung
        // or rejected navigate() cannot block activation.
        clients.forEach(c => { try { c.navigate(c.url).catch(() => {}); } catch {} });
      }
    } catch {}
  })());
});

self.addEventListener('fetch', (e) => {
  // Never intercept API calls.
  if (e.request.url.includes('/api/')) return;

  // Navigations: network first, cache as the safety net.
  //
  // The network is preferred because it is the only way to guarantee the HTML
  // matches the chunks the server is currently serving. Serving a cached shell
  // first (the previous attempt) could pin a device to a shell whose chunks were
  // gone, which the host answers with its SPA fallback — HTML for a .js — and the
  // app never boots. Offline (or a slow/hanging request) falls back to the cached
  // shell, which always matches its own cached chunks because a single build
  // writes the cache and activate() throws away every other build's cache.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      let networkResponse = null;
      try {
        networkResponse = await withTimeout(fetch(e.request), NAVIGATION_TIMEOUT_MS);
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', networkResponse.clone()).catch(() => {});
          return networkResponse;
        }
      } catch {}

      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match('/index.html')) ||
        (await cache.match('/')) ||
        (await caches.match(e.request, { ignoreSearch: true }));
      if (cached) return cached;
      return networkResponse && networkResponse.ok ? networkResponse : offlineDocument();
    })());
    return;
  }

  // Images: cache first, network fallback. The lookup is across *all* caches, not
  // just the image cache, because the offline / server-unreachable artwork is
  // precached with the shell; looking only in the image cache returned a 404 for it
  // exactly when it was needed.
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(response => {
        e.waitUntil(cacheImage(e.request, response));
        return response;
      }).catch(() => new Response('', { status: 404 })))
    );
    return;
  }

  // Scripts and styles: cache first, network fallback, back-filled into the cache.
  // Guard against the host's SPA fallback: a missing chunk is answered with HTML,
  // and treating that as JS/CSS poisons the cache and hard-fails the module. Such a
  // response is refused (a 504) so the app's chunk-error recovery can take over.
  if (e.request.destination === 'style' || e.request.destination === 'script') {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      try {
        const response = await fetch(e.request);
        const type = response.headers.get('content-type') || '';
        if (response.ok && !type.includes('text/html')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
          return response;
        }
        return new Response('', { status: 504, statusText: 'Asset not available' });
      } catch {
        return new Response('', { status: 504, statusText: 'Asset not available' });
      }
    })());
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
