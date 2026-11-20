import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stamps a unique id into the build output so every deploy is detectable by
// both the running app (/version.json) and the service worker (/cache-version.json
// plus the worker's own bytes). Previously the worker bytes never changed, so a
// browser installed it once and then ignored every later deploy — its app-shell
// cache was never purged and stale assets lingered on offline.
//
// This mirrors mart-user/scripts/write-version.mjs so the hub and storefront
// behave identically.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function readBuildId() {
  try {
    const raw = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8'));
    if (raw && typeof raw.v === 'string' && raw.v) return raw.v;
  } catch {
    /* fall through */
  }
  throw new Error('dist/version.json is missing a build id — run vite build first');
}

const buildId = readBuildId();
const payload = `${JSON.stringify({ v: buildId })}\n`;

writeFileSync(join(dist, 'version.json'), payload);
writeFileSync(join(dist, 'cache-version.json'), payload);

// Rewriting sw.js with a new id changes its bytes, which is the only thing that
// makes a browser install the updated worker; otherwise a byte-identical sw.js
// is ignored forever and activate() never runs to purge the old caches.
//
// The worker also gets the manifest of every Vite-hashed JS/CSS chunk prepended,
// so it can precache the whole app at install. That keeps update swaps fully
// local — no network wait during the reload, so the swap reads as a smooth
// transition instead of a white shutter on a phone.
const swPath = join(dist, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  if (!sw.includes('__BUILD_VERSION__')) {
    throw new Error('dist/sw.js has no __BUILD_VERSION__ placeholder to replace');
  }
  const stamped = sw.replaceAll('__BUILD_VERSION__', buildId);

  const indexPath = join(dist, 'index.html');
  let assets = [];
  try {
    const html = readFileSync(indexPath, 'utf8');
    assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
  } catch {
    throw new Error('dist/index.html is missing — run vite build first');
  }

  // Also precache every code-split chunk. The index.html only references the
  // entry files, so without this a lazily-loaded route would fail to open while
  // offline (which previously triggered a reload loop that ended on the
  // browser's native offline page).
  try {
    const chunks = readdirSync(join(dist, 'assets'))
      .filter(name => name.endsWith('.js') || name.endsWith('.css'))
      .map(name => `/assets/${name}`);
    assets = [...new Set([...assets, ...chunks])];
  } catch {
    /* no assets dir — entry-only precache */
  }

  const manifestHeader = `/* asset-manifest */ self.__BUILD_ASSETS__ = ${JSON.stringify(assets)};\n`;
  writeFileSync(swPath, manifestHeader + stamped);
  console.log(`[version] stamped build ${buildId} with ${assets.length} assets`);
} else {
  throw new Error('dist/sw.js is missing — run vite build first');
}

// Installed PWAs cache their home-screen icon by URL at install time. Replacing
// the PNG on the server under the same stable path does not update that icon;
// the customer keeps seeing the old artwork until they uninstall and reinstall.
// Appending the build id as a query string gives every deploy a URL the OS cache
// cannot already hold, so a new icon reaches an already-installed PWA. The same
// id on the manifest link itself forces browsers that pin manifests to re-read
// it, which is what makes them notice the changed icon URLs.
const manifestPath = join(dist, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, 'utf8')
    .replace(/\/icons\/(icon-[^"?]+\.png)/g, `/icons/$1?v=${buildId}`);
  writeFileSync(manifestPath, manifest);
  console.log('[version] versioned PWA icon URLs in manifest.json');
}

const shellIndexPath = join(dist, 'index.html');
if (existsSync(shellIndexPath)) {
  let shell = readFileSync(shellIndexPath, 'utf8');
  shell = shell
    .replace(/(href="\/manifest\.json)"/g, `$1?v=${buildId}"`)
    .replace(/(href="\/icons\/icon-180\.png)"/g, `$1?v=${buildId}"`);
  writeFileSync(shellIndexPath, shell);
  console.log('[version] versioned manifest and apple-touch-icon links');
}