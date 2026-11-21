import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ICONS = join(PUBLIC, 'icons');
const SOURCE = join(PUBLIC, 'gokez_hub_logo_removebg.png');

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function fit(w, h, target) {
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

webp(400, 400, join(PUBLIC, 'gokez_hub_logo_removebg.webp'));

png(125, 128, join(PUBLIC, 'gokez_hub_logo-header.png'));
webp(63, 64, join(ICONS, 'gokez_hub_nav.webp'));

png(16, 16, join(ICONS, 'icon-16.png'));
png(32, 32, join(ICONS, 'icon-32.png'));
png(96, 96, join(ICONS, 'hub-logo-96.png'));
png(192, 192, join(ICONS, 'hub-logo-192.png'));
png(512, 512, join(ICONS, 'hub-logo-512.png'));

magick([
  '(', ...fit(16, 16), ')',
  '(', ...fit(32, 32), ')',
  '(', ...fit(48, 48), ')',
  '-strip',
  join(PUBLIC, 'favicon.ico'),
]);

console.log('[brand-assets] generated non-app icons from gokez_hub_logo_removebg.png');
