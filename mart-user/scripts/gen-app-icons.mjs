// Generates the home-screen app icons (Android launcher + PWA) from the single
// canonical artwork mart-user/public/gokez_mart_logo.jpg. This artwork is used
// ONLY for the installed app / home-screen icon; every other brand image comes
// from gokez_mart_logo_source.png via gen-brand-assets.mjs.
//
// Requires ImageMagick (`magick`) on PATH. Re-run whenever gokez_mart_logo.jpg
// changes. The build stamps a fresh query string onto the PWA icon URLs in
// dist/manifest.json (see write-version.mjs), so installed PWAs pick up the new
// artwork on the next deploy without a reinstall.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const MANIFEST = join(PUBLIC, 'manifest.json');

const SOURCE = join(PUBLIC, 'gokez_mart_logo.jpg');

const PWA_SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

const logo = join(tmpdir(), 'gokez-mart-app-logo.png');

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function sourceBackground() {
  const pixel = magick([SOURCE, '-format', '%[pixel:p{5,5}]', 'info:']).toString().trim();
  const rgb = pixel.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) throw new Error(`could not read background colour from ${SOURCE}`);
  return `#${rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const BACKGROUND = sourceBackground();
const manifest = readFileSync(MANIFEST, 'utf8');
const backgroundPattern = /"background_color":\s*"#[0-9A-Fa-f]{6}"/;
if (!backgroundPattern.test(manifest)) throw new Error(`could not update background_color in ${MANIFEST}`);
writeFileSync(MANIFEST, manifest.replace(backgroundPattern, `"background_color": "${BACKGROUND}"`));

writeFileSync(
  join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`,
);

writeFileSync(
  join(RES, 'drawable', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportHeight="108"\n    android:viewportWidth="108">\n    <path\n        android:fillColor="${BACKGROUND}"\n        android:pathData="M0,0h108v108h-108z" />\n</vector>\n`,
);

try {
  // Strip the source canvas once and reuse the transparent mark for the
  // maskable PWA icons and the Android adaptive foreground.
  magick([SOURCE, '-fuzz', '10%', '-transparent', BACKGROUND, '-trim', '+repage', `PNG32:${logo}`]);

  // PWA home-screen icons: the full square artwork resized to each declared size.
  for (const size of PWA_SIZES) {
    magick([SOURCE, '-resize', `${size}x${size}`, '-strip', join(PUBLIC, 'icons', `icon-${size}.png`)]);
  }

  // Maskable PWA icons: keep the mark inside the 80% circular safe zone on the sampled canvas.
  for (const size of [192, 512]) {
    const mark = Math.round(size * 0.54);
    magick([
      '-size', `${size}x${size}`, `xc:${BACKGROUND}`,
      '(', logo, '-resize', `${mark}x${mark}`, ')',
      '-gravity', 'center', '-composite', '-strip',
      join(PUBLIC, 'icons', `icon-maskable-${size}.png`),
    ]);
  }

  for (const [density, launcherSize, adaptiveSize] of DENSITIES) {
    const mipmap = join(RES, `mipmap-${density}`);

    // Legacy launcher icon: full square artwork.
    magick([SOURCE, '-resize', `${launcherSize}x${launcherSize}`, '-strip', join(mipmap, 'ic_launcher.png')]);

    // Circular launcher icon: sampled canvas with the mark inside the circular safe zone.
    const c = launcherSize / 2;
    const roundMark = Math.round(launcherSize * 0.55);
    magick([
      '-size', `${launcherSize}x${launcherSize}`, `xc:${BACKGROUND}`,
      '(', logo, '-resize', `${roundMark}x${roundMark}`, ')',
      '-gravity', 'center', '-composite', '-strip', '-alpha', 'set',
      '(', '-size', `${launcherSize}x${launcherSize}`, 'xc:none', '-fill', 'white',
      '-draw', `circle ${c},${c} ${c},0`, ')',
      '-compose', 'CopyOpacity', '-composite',
      join(mipmap, 'ic_launcher_round.png'),
    ]);

    // Adaptive foreground: transparent mark centred inside the 108dp canvas,
    // scaled so its full bounds stay inside the 66dp circular safe zone. The
    // sampled background comes from the @color/ic_launcher_background resource.
    const mark = Math.round(adaptiveSize * 0.42);
    magick([
      '-size', `${adaptiveSize}x${adaptiveSize}`, 'xc:none',
      '(', logo, '-resize', `${mark}x${mark}`, ')',
      '-gravity', 'center', '-composite', '-strip',
      join(mipmap, 'ic_launcher_foreground.png'),
    ]);
  }

  console.log('[app-icons] generated PWA, launcher, round and adaptive icons from gokez_mart_logo.jpg');
} finally {
  rmSync(logo, { force: true });
}
