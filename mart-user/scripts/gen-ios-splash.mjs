// Generates the iOS web-app launch images (apple-touch-startup-image) into
// public/splash/. iOS shows these instead of a blank white frame while an
// installed PWA boots, so a cold launch is branded rather than white.
//
// The design mirrors the HTML launch splash in index.html exactly — same
// forest green, same logo, same tagline, same grocery-bag artwork, same
// headline, same loading line — so the hand-over from the OS launch image to
// the in-page splash is invisible rather than a jump between two designs.
//
// Requires ImageMagick (`magick`) on PATH. Re-run it whenever the brand logo,
// splash artwork or splash colour changes, then keep the
// <link rel="apple-touch-startup-image"> block in index.html in sync with the
// DEVICES table below.
//
// The images are intentionally NOT precached by the service worker: iOS caches
// them natively at install time, so they work offline without app involvement,
// and precaching them would only bloat the install payload.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'splash');
const TMP = join(OUT, '.tmp');

// The same forest green the HTML splash uses. Keep in sync with index.html.
const BG = '#218044';
const LOGO = join(PUBLIC, 'Gokez_mart_brand_transparent.webp');
const ART = join(PUBLIC, 'splash2.webp');
// The grocery-bag artwork. splash2.webp is the transparent-background build of
// the source illustration; the artwork itself is untouched.
const LOGO_RATIO = 603 / 1554;

const GOLD = '#fcd34d';
const WHITE = '#ffffff';

// Layout reference. Every measurement below is the value the HTML splash
// produces on a 390pt-wide phone, scaled to the device being rendered. The
// two must agree or the hand-over between the launch image and the page
// splash would visibly jump.
const REF_WIDTH = 390;
const LAYOUT = {
  logoWidth: 163.8,
  logoToTagline: 14.4,
  taglineSize: 14.4,
  taglineToArt: 16,
  artHeight: 156,
  artToHeadline: 25.6,
  headlineSize: 15.6,
  headlineToDots: 13.6,
  dotSize: 6,
  dotGap: 6,
  dotsToLoading: 9.6,
  loadingSize: 11.7,
  // Horizontal padding of the splash column (1.25rem each side) and the
  // headline's max-width (23rem). The headline wraps inside the narrower of
  // the two, exactly as it does in the browser.
  columnPadding: 20,
  headlineMaxWidth: 368,
};

// Line heights and letter-spacing, matching the CSS in index.html. The web
// layout advances by the line box, not the ink, so the launch image has to
// reserve the same line box and centre the ink inside it -- otherwise the two
// are a few pixels apart and the hand-over from the launch image to the page
// splash shows a small jump.
const LINE_HEIGHT = {
  tagline: 1.25,
  headline: 1.25,
  loading: 1.3,
};

// CSS letter-spacing, in em.
const TRACKING = {
  tagline: 0.01,
  headline: -0.02,
};

const TAGLINE = 'Shop Local · Support Local';
const HEADLINE = 'From your neighbourhood store to your doors';
const LOADING = 'Getting things ready for you…';

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

// ── Fonts ────────────────────────────────────────────────────────────────────
// The storefront loads Inter from Google Fonts, but a raster launch image
// needs a real font file. The Inter TTFs already vendored for the mobile app
// are used; if they are missing the script falls back to a system sans so the
// build still produces images rather than failing.
const FONT_DIR = join(ROOT, '..', 'mart-mobile', 'assets', 'fonts');
const FONTS = {
  semibold: join(FONT_DIR, 'Inter-SemiBold.ttf'),
  bold: join(FONT_DIR, 'Inter-Bold.ttf'),
  medium: join(FONT_DIR, 'Inter-Medium.ttf'),
};
const FALLBACK_FONTS = {
  semibold: '/System/Library/Fonts/HelveticaNeue.ttc',
  bold: '/System/Library/Fonts/HelveticaNeue.ttc',
  medium: '/System/Library/Fonts/HelveticaNeue.ttc',
};

function fontFor(weight) {
  const preferred = FONTS[weight];
  if (existsSync(preferred)) return preferred;
  const fallback = FALLBACK_FONTS[weight];
  if (existsSync(fallback)) {
    console.warn(`[ios-splash] ${preferred} missing, falling back to ${fallback}`);
    return fallback;
  }
  throw new Error(`[ios-splash] no font available for weight "${weight}"`);
}

// ── ImageMagick helpers ──────────────────────────────────────────────────────
function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The artwork's own proportions, read from the file.
 *
 * The illustration gets replaced from time to time, so its aspect ratio is
 * measured here rather than hardcoded: a stale constant would silently
 * squash the artwork in every launch image.
 */
function artRatio() {
  const out = magick([ART, '-format', '%w %h', 'info:']).toString().trim().split(' ');
  return Number(out[1]) / Number(out[0]);
}

/**
 * Renders one line of text to a trimmed, transparent PNG and measures it.
 *
 * `tracking` is the CSS letter-spacing, in em. ImageMagick expresses the same
 * thing as a kerning value in pixels, so it is converted here: without it the
 * drawn text is a different width from the browser's, and the line would wrap
 * differently in the launch image than on the page.
 */
function textLayer(text, { font, size, fill, tracking = 0 }, file) {
  magick([
    '-background', 'none',
    '-font', font,
    '-pointsize', String(size),
    ...(tracking ? ['-kerning', String(tracking * size)] : []),
    '-fill', fill,
    '-gravity', 'northwest',
    `label:${text}`,
    '-trim',
    '+repage',
    file,
  ]);
  const out = magick([file, '-format', '%w %h', 'info:']).toString().trim().split(' ');
  return { file, w: Number(out[0]), h: Number(out[1]) };
}

/**
 * Measures a run of text without writing a file.
 *
 * The headline can wrap on a narrow phone, so the break has to be reproduced
 * here rather than assumed -- the width of each candidate line is measured
 * with the same font and tracking the browser uses, and the break lands in
 * the same place.
 */
function makeMeasurer(font, size, tracking = 0) {
  const cache = new Map();
  return (text) => {
    if (cache.has(text)) return cache.get(text);
    const out = magick([
      '-background', 'none',
      '-font', font,
      '-pointsize', String(size),
      ...(tracking ? ['-kerning', String(tracking * size)] : []),
      '-gravity', 'northwest',
      `label:${text}`,
      '-trim',
      '+repage',
      '-format', '%w',
      'info:',
    ]).toString().trim();
    const width = Number(out) || 0;
    cache.set(text, width);
    return width;
  };
}

/** Greedy word wrap, the same break the browser makes for the same width. */
function wrapText(text, maxWidth, measure) {
  const words = text.split(' ');
  const lines = [];
  let current = words[0] ?? '';
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  if (current) lines.push(current);
  return lines;
}

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Measured once: every device uses the same artwork.
const ART_RATIO = artRatio();

for (const [w, h, ptW, ptH, dpr] of DEVICES) {
  const s = (ptW / REF_WIDTH) * dpr; // scale factor from the 390pt reference
  const px = n => Math.round(n * s);

  const logoW = px(LAYOUT.logoWidth);
  const logoH = Math.round(logoW * LOGO_RATIO);
  const taglineSize = px(LAYOUT.taglineSize);
  const artH = px(LAYOUT.artHeight);
  const artW = Math.round(artH * ART_RATIO);
  const headlineSize = px(LAYOUT.headlineSize);
  const loadingSize = px(LAYOUT.loadingSize);
  const dotD = px(LAYOUT.dotSize);
  const dotGap = px(LAYOUT.dotGap);
  const dotsToText = px(LAYOUT.dotsToText);

  // ── Build the layers ───────────────────────────────────────────────────────
  const logoFile = join(TMP, `logo-${w}.png`);
  magick([LOGO, '-resize', `${logoW}x${logoH}`, '-background', 'none', logoFile]);

  const artFile = join(TMP, `art-${w}.png`);
  magick([ART, '-resize', `${artW}x${artH}`, '-background', 'none', artFile]);

  const tagline = textLayer(
    TAGLINE,
    { font: fontFor('semibold'), size: taglineSize, fill: WHITE, tracking: TRACKING.tagline },
    join(TMP, `tagline-${w}.png`),
  );
  const loading = textLayer(
    LOADING,
    { font: fontFor('medium'), size: loadingSize, fill: '#d9e8de' },
    join(TMP, `loading-${w}.png`),
  );

  // ── Stack it ───────────────────────────────────────────────────────────────
  // Each text row occupies a line box of pointsize x line-height (the same
  // advance the CSS uses) with the glyphs centred inside it. Every gap below
  // is measured from the bottom of that line box, matching the web layout.
  const gapLogoTagline = px(LAYOUT.logoToTagline);
  const gapTaglineArt = px(LAYOUT.taglineToArt);
  const gapArtHeadline = px(LAYOUT.artToHeadline);
  const gapHeadlineDots = px(LAYOUT.headlineToDots);
  const gapDotsLoading = px(LAYOUT.dotsToLoading);

  const lineBox = (size, ratio) => Math.round(size * ratio);

  const taglineBox = lineBox(taglineSize, LINE_HEIGHT.tagline);
  const headlineLineBox = lineBox(headlineSize, LINE_HEIGHT.headline);
  const loadingBox = lineBox(loadingSize, LINE_HEIGHT.loading);

  // The headline wraps inside the narrower of the column and its max-width,
  // exactly as it does in the browser.
  const columnWidth = Math.min(
    (ptW - LAYOUT.columnPadding * 2) * dpr,
    LAYOUT.headlineMaxWidth * dpr,
  );
  const headlineLines = wrapText(
    HEADLINE,
    columnWidth,
    makeMeasurer(fontFor('bold'), headlineSize, TRACKING.headline),
  );
  const headlineLayers = headlineLines.map((line, i) =>
    textLayer(
      line,
      { font: fontFor('bold'), size: headlineSize, fill: GOLD, tracking: TRACKING.headline },
      join(TMP, `headline-${w}-${i}.png`),
    ),
  );
  const headlineBox = headlineLineBox * headlineLayers.length;

  // The three dots are a row of their own, between the slogan and the status
  // line, and are centred as a group.
  const dotsW = dotD * 3 + dotGap * 2;

  const contentH =
    logoH + gapLogoTagline + taglineBox + gapTaglineArt + artH +
    gapArtHeadline + headlineBox + gapHeadlineDots + dotD +
    gapDotsLoading + loadingBox;

  let y = Math.max(0, Math.round((h - contentH) / 2));
  const centreX = (elW) => Math.round((w - elW) / 2);

  const layers = [];

  // Places a layer and advances the cursor by the space the element occupies.
  const push = (file, elW, elH, boxH) => {
    const occupy = boxH ?? elH;
    // Vertically centre the ink inside its line box.
    const offset = Math.round((occupy - elH) / 2);
    layers.push({ file, x: centreX(elW), y: y + offset });
    y += occupy;
  };

  push(logoFile, logoW, logoH);
  y += gapLogoTagline;
  push(tagline.file, tagline.w, tagline.h, taglineBox);
  y += gapTaglineArt;
  push(artFile, artW, artH);
  y += gapArtHeadline;

  // The headline's lines are each centred on their own, the way a centred
  // paragraph breaks across lines in the browser.
  headlineLayers.forEach((line) => {
    layers.push({
      file: line.file,
      x: centreX(line.w),
      y: y + Math.round((headlineLineBox - line.h) / 2),
    });
    y += headlineLineBox;
  });

  y += gapHeadlineDots;

  // The three dots, on a row of their own, centred as a group.
  const dotsX = Math.round((w - dotsW) / 2);
  const drawDots = [];
  for (let i = 0; i < 3; i++) {
    const cx = dotsX + dotD / 2 + i * (dotD + dotGap);
    drawDots.push(`circle ${cx},${y + dotD / 2} ${cx},${y}`);
  }
  y += dotD;
  y += gapDotsLoading;

  // The loading line sits on its own row, below the dots.
  layers.push({
    file: loading.file,
    x: centreX(loading.w),
    y: y + Math.round((loadingBox - loading.h) / 2),
  });
  y += loadingBox;

  // ── Composite ──────────────────────────────────────────────────────────────
  // Each layer is wrapped in parentheses to make it a single image, then
  // composited onto the background at an absolute offset. `-gravity northwest`
  // makes the geometry offsets count from the top-left corner.
  const args = [
    '-size', `${w}x${h}`, `xc:${BG}`,
    '-gravity', 'northwest',
  ];
  for (const layer of layers) {
    args.push('(', layer.file, ')', '-geometry', `+${layer.x}+${layer.y}`, '-composite');
  }
  args.push(
    '-fill', GOLD, '-stroke', 'none',
    '-draw', drawDots.join(' '),
    // Flat colour plus a small logo and a few dots: an 8-bit palette (dithered)
    // keeps full-size launch images in the tens of KB instead of hundreds, with
    // no visible banding on the solid brand background.
    '-strip', '-dither', 'FloydSteinberg', '-colors', '256',
    `PNG8:${join(OUT, `apple-splash-${w}-${h}.png`)}`,
  );
  magick(args);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`[ios-splash] wrote ${DEVICES.length} launch images to public/splash/`);
