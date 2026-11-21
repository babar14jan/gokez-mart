import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE = join(ROOT, 'public', 'gokez_mart_logo.jpg');
const LOGO = join(ROOT, 'public', 'gokez_mart_logo_source.png');

const DIRS = [
  'drawable',
  'drawable-hdpi',
  'drawable-mdpi',
  'drawable-xhdpi',
  'drawable-xxhdpi',
  'drawable-xxxhdpi',
  'drawable-land-hdpi',
  'drawable-land-mdpi',
  'drawable-land-xhdpi',
  'drawable-land-xxhdpi',
  'drawable-land-xxxhdpi',
  'drawable-port-hdpi',
  'drawable-port-mdpi',
  'drawable-port-xhdpi',
  'drawable-port-xxhdpi',
  'drawable-port-xxxhdpi',
];

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

for (const dir of DIRS) {
  const output = join(RES, dir, 'splash.png');
  const dimensions = magick([output, '-format', '%w %h', 'info:']).toString().trim().split(/\s+/).map(Number);
  const [w, h] = dimensions;
  const logoSize = Math.round(Math.min(w, h) * 0.32);
  magick([
    '-size', `${w}x${h}`, `xc:${BACKGROUND}`,
    '(', LOGO, '-resize', `${logoSize}x${logoSize}`, ')',
    '-gravity', 'center',
    '-composite',
    '-strip',
    '-colors', '256',
    `PNG8:${output}`,
  ]);
}

console.log(`[native-splash] wrote ${DIRS.length} Android splash images on ${BACKGROUND}`);
