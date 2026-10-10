import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

// The timestamp (base36) guarantees a new id even when the same commit is
// rebuilt, which is what forces the refresh on every deploy.
const buildId = `${gitShortSha()}-${Date.now().toString(36)}`;
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
    assets = [...new Set(assets)];
  } catch {
    throw new Error('dist/index.html is missing — run vite build first');
  }

  const manifestHeader = `/* asset-manifest */ self.__BUILD_ASSETS__ = ${JSON.stringify(assets)};\n`;
  writeFileSync(swPath, manifestHeader + stamped);
  console.log(`[version] stamped build ${buildId} with ${assets.length} assets`);
} else {
  throw new Error('dist/sw.js is missing — run vite build first');
}