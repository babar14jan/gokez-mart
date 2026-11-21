import { execFileSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ICONS = join(PUBLIC, 'icons');
const SOURCE = join(PUBLIC, 'gokez_mart_logo_source.png');
const FALLBACK = join(PUBLIC, 'gokez_mart_logo_removebg.tmp.png');
const BRAND_GREEN = '#087A43';

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function fit(w, h) {
  return [
    SOURCE,
    '-resize',
    `${w}x${h}`,
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    `${w}x${h}`,
    '-strip',
  ];
}

function png(w, h, name) {
  magick([...fit(w, h), '-define', 'png:compression-level=9', `PNG32:${name}`]);
}

function webp(w, h, name) {
  magick([...fit(w, h), '-quality', '82', `WEBP:${name}`]);
}

function png8(w, h, name) {
  magick([...fit(w, h), '-define', 'png:compression-level=9', `PNG8:${name}`]);
}

try {
  png(400, 400, FALLBACK);
  renameSync(FALLBACK, join(PUBLIC, 'gokez_mart_logo_removebg.png'));
} finally {
  rmSync(FALLBACK, { force: true });
}

webp(400, 400, join(PUBLIC, 'gokez_mart_logo_removebg.webp'));
webp(400, 400, join(PUBLIC, 'gokez_mart_logo.webp'));
png(127, 128, join(PUBLIC, 'gokez_mart_logo-header.png'));
webp(63, 64, join(ICONS, 'gokez_mart_nav.webp'));
png8(63, 64, join(ICONS, 'gokez_mart_nav.png'));

png(16, 16, join(PUBLIC, 'favicon-16.png'));
png(32, 32, join(PUBLIC, 'favicon-32.png'));
png(96, 96, join(ICONS, 'mart-logo-96.png'));
png(192, 192, join(ICONS, 'mart-logo-192.png'));
png(512, 512, join(ICONS, 'mart-logo-512.png'));

magick([
  '(', ...fit(16, 16), ')',
  '(', ...fit(32, 32), ')',
  '(', ...fit(48, 48), ')',
  '-strip',
  join(PUBLIC, 'favicon.ico'),
]);

magick([
  '-size', '1000x1000', `xc:${BRAND_GREEN}`,
  '(', SOURCE, '-resize', '520x520', ')',
  '-gravity', 'center', '-composite', '-strip', '-quality', '86',
  'JPEG:' + join(PUBLIC, 'gokez_mart_og.jpg'),
]);

console.log('[brand-assets] generated non-app logos from gokez_mart_logo_source.png');
