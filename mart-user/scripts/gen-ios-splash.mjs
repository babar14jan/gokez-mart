// Generates the iOS web-app launch images (apple-touch-startup-image) into
// public/splash/. iOS shows these instead of a blank white frame while an
// installed PWA boots, so a cold launch is branded rather than white.
//
// The launch image is the original splash artwork (mart_splash.webp), which
// already carries its green surround, logo and copy. It fills each device
// canvas directly so no additional visual margins are introduced.
//
// Requires ImageMagick (`magick`) on PATH. Re-run it whenever the splash
// artwork or splash colour changes, then keep the
// <link rel="apple-touch-startup-image"> block in index.html in sync with the
// DEVICES table below.
//
// The images are intentionally NOT precached by the service worker: iOS caches
// them natively at install time, so they work offline without app involvement,
// and precaching them would only bloat the install payload.
//
// The file names in public/ are the plain ones; the build adds the build id to
// them in dist (see write-version.mjs) so that every deploy produces a URL the
// OS cache cannot already hold. Without that, a new splash only ever reached a
// customer who removed and reinstalled the app.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'splash');

const SPLASH = join(PUBLIC, 'mart_splash.webp');

// [pixelWidth, pixelHeight, pointWidth, pointHeight, devicePixelRatio]
// pointWidth/pointHeight/dpr are what the media queries in index.html must match.
export const DEVICES = [
  [1290, 2796, 430, 932, 3], // iPhone 14 Pro Max, 15 Plus, 15 Pro Max
  [1320, 2868, 440, 956, 3], // iPhone 16 Pro Max
  [1206, 2622, 402, 874, 3], // iPhone 16 Pro
  [1179, 2556, 393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
  [1284, 2778, 428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [1170, 2532, 390, 844, 3], // iPhone 12/12 Pro/13/13 Pro/14
  [1125, 2436, 375, 812, 3], // iPhone X, XS, 11 Pro, 12/13 mini
  [1242, 2688, 414, 896, 3], // iPhone XS Max, 11 Pro Max
  [828, 1792, 414, 896, 2], // iPhone XR, 11
  [750, 1334, 375, 667, 2], // iPhone SE 2/3, 8, 7, 6s
  [1242, 2208, 414, 736, 3], // iPhone 8 Plus, 7 Plus, 6s Plus
  [2048, 2732, 1024, 1366, 2], // iPad Pro 12.9"
  [1668, 2388, 834, 1194, 2], // iPad Pro 11", iPad Air 4/5
  [1668, 2224, 834, 1112, 2], // iPad Pro 10.5", iPad Air 3
  [1640, 2360, 820, 1180, 2], // iPad Air 4/5 (10.9)
  [1620, 2160, 810, 1080, 2], // iPad 10.2", 9th/8th/7th gen
  [1536, 2048, 768, 1024, 2], // iPad mini 5, iPad Air 2, iPad 9.7"
];

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

mkdirSync(OUT, { recursive: true });

// The original artwork fills the canvas without any added frame. Cover scaling
// preserves the intended artwork scale across the iPhone and iPad aspect ratios.
for (const [w, h, ptW, ptH, dpr] of DEVICES) {
  magick([
    SPLASH,
    '-resize', `${w}x${h}^`,
    '-gravity', 'center',
    '-extent', `${w}x${h}`,
    '-strip',
    `PNG8:${join(OUT, `apple-splash-${w}-${h}.png`)}`,
  ]);
}

console.log(`[ios-splash] wrote ${DEVICES.length} launch images to public/splash/`);
