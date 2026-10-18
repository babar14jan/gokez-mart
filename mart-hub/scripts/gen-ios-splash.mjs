// Generates the iOS web-app launch images (apple-touch-startup-image) into
// public/splash/. iOS shows these instead of a blank white frame while an
// installed PWA boots, so a cold launch is branded rather than white.
//
// Requires ImageMagick (`magick`) on PATH. Re-run it whenever the brand logo or
// splash colour changes, then keep the <link rel="apple-touch-startup-image">
// block in index.html in sync with the DEVICES table below.
//
// The images are intentionally NOT precached by the service worker: iOS caches
// them natively at install time, so they work offline without app involvement,
// and precaching them would only bloat the install payload.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'splash');

const BG = '#18191a';
const LOGO = join(PUBLIC, 'mart_hub_brand_logo.png');
const LOGO_WIDTH_RATIO = 0.5;

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
  [1640, 2360, 820, 1180, 2], // iPad Air 4/5 (10.9")
  [1620, 2160, 810, 1080, 2], // iPad 10.2", 9th/8th/7th gen
  [1536, 2048, 768, 1024, 2], // iPad mini 5, iPad Air 2, iPad 9.7"
];

mkdirSync(OUT, { recursive: true });

for (const [w, h] of DEVICES) {
  const logoW = Math.round(w * LOGO_WIDTH_RATIO);
  const file = join(OUT, `apple-splash-${w}-${h}.png`);
  execFileSync('magick', [
    '-size', `${w}x${h}`, `xc:${BG}`,
    '(', LOGO, '-resize', `${logoW}x`, ')',
    '-gravity', 'center', '-composite',
    // Flat colour + a small logo: an 8-bit palette (dithered) keeps full-size
    // launch images in the tens of KB instead of hundreds, with no visible
    // banding on the solid brand background.
    '-strip', '-dither', 'FloydSteinberg', '-colors', '256',
    `PNG8:${file}`,
  ]);
}

console.log(`[ios-splash] wrote ${DEVICES.length} launch images to public/splash/`);
