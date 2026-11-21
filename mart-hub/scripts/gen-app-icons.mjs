// Generates the PWA home-screen icons for Gokez Hub from the single canonical
// artwork mart-hub/public/hub_app_icon.jpg. This artwork is used ONLY for the
// installed PWA / home-screen icon; favicon files (icon-16, icon-32, favicon.ico)
// keep their own sources so browser tabs are not affected.
//
// Requires ImageMagick (`magick`) on PATH. Re-run whenever hub_app_icon.jpg
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

const SOURCE = join(PUBLIC, 'hub_app_icon.jpg');
const YELLOW = '#FEDE03';

const ICON_SIZES = [96, 180, 192, 512];
const MASKABLE_SIZES = [192, 512];

const logo = join(tmpdir(), 'gokez-hub-app-logo.png');

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  // Strip the yellow canvas once and reuse the transparent mark for the
  // maskable icons so the logo stays inside the 80% safe zone.
  magick([SOURCE, '-fuzz', '10%', '-transparent', YELLOW, '-trim', '+repage', `PNG32:${logo}`]);

  for (const size of ICON_SIZES) {
    magick([SOURCE, '-resize', `${size}x${size}`, '-strip', join(PUBLIC, 'icons', `icon-${size}.png`)]);
  }

  for (const size of MASKABLE_SIZES) {
    const mark = Math.round(size * 0.62);
    magick([
      '-size', `${size}x${size}`, `xc:${YELLOW}`,
      '(', logo, '-resize', `${mark}x${mark}`, ')',
      '-gravity', 'center', '-composite', '-strip',
      join(PUBLIC, 'icons', `icon-maskable-${size}.png`),
    ]);
  }

  console.log('[app-icons] generated PWA icons from hub_app_icon.jpg');
} finally {
  rmSync(logo, { force: true });
}
