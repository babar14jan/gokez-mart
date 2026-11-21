// Generates the home-screen app icons (Android launcher + PWA) from the single
// canonical artwork mart-user/public/mart_app_icon.jpg. This artwork is used
// ONLY for the installed app / home-screen icon; favicons and splash images keep
// their own sources (gokez_mart_logo-removebg.png and gokez_mart_logo.webp).
//
// Requires ImageMagick (`magick`) on PATH. Re-run whenever mart_app_icon.jpg
// changes. The build stamps a fresh query string onto the PWA icon URLs in
// dist/manifest.json (see write-version.mjs), so installed PWAs pick up the new
// artwork on the next deploy without a reinstall.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

const SOURCE = join(PUBLIC, 'mart_app_icon.jpg');
const YELLOW = '#FEDB02';

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

try {
  // Strip the yellow canvas once and reuse the transparent mark for the
  // maskable PWA icons and the Android adaptive foreground.
  magick([SOURCE, '-fuzz', '10%', '-transparent', YELLOW, '-trim', '+repage', `PNG32:${logo}`]);

  // PWA home-screen icons: the full square artwork resized to each declared size.
  for (const size of PWA_SIZES) {
    magick([SOURCE, '-resize', `${size}x${size}`, '-strip', join(PUBLIC, 'icons', `icon-${size}.png`)]);
  }

  // Maskable PWA icons: keep the mark inside the 80% safe zone on a yellow canvas.
  for (const size of [192, 512]) {
    const mark = Math.round(size * 0.62);
    magick([
      '-size', `${size}x${size}`, `xc:${YELLOW}`,
      '(', logo, '-resize', `${mark}x${mark}`, ')',
      '-gravity', 'center', '-composite', '-strip',
      join(PUBLIC, 'icons', `icon-maskable-${size}.png`),
    ]);
  }

  for (const [density, launcherSize, adaptiveSize] of DENSITIES) {
    const mipmap = join(RES, `mipmap-${density}`);

    // Legacy launcher icon: full square artwork.
    magick([SOURCE, '-resize', `${launcherSize}x${launcherSize}`, '-strip', join(mipmap, 'ic_launcher.png')]);

    // Circular launcher icon: same artwork clipped to a circle.
    const c = launcherSize / 2;
    magick([
      SOURCE, '-resize', `${launcherSize}x${launcherSize}`, '-strip', '-alpha', 'set',
      '(', '-size', `${launcherSize}x${launcherSize}`, 'xc:none', '-fill', 'white',
      '-draw', `circle ${c},${c} ${c},0`, ')',
      '-compose', 'CopyOpacity', '-composite',
      join(mipmap, 'ic_launcher_round.png'),
    ]);

    // Adaptive foreground: transparent mark centred inside the 108dp canvas,
    // scaled to the 66dp safe zone. The yellow background comes from the
    // @color/ic_launcher_background resource.
    const mark = Math.round(adaptiveSize * 0.6);
    magick([
      '-size', `${adaptiveSize}x${adaptiveSize}`, 'xc:none',
      '(', logo, '-resize', `${mark}x${mark}`, ')',
      '-gravity', 'center', '-composite', '-strip',
      join(mipmap, 'ic_launcher_foreground.png'),
    ]);
  }

  console.log('[app-icons] generated PWA, launcher, round and adaptive icons from mart_app_icon.jpg');
} finally {
  rmSync(logo, { force: true });
}
