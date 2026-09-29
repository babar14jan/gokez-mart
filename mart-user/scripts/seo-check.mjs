/**
 * SEO-3 build gate — zero new dependencies (Node built-ins only).
 *
 *   npm run seo:check         # verify source + build output (also runs in build)
 *   npm run seo:check:full    # additionally executes src/utils/seo.ts (needs tsx)
 *
 * `seo:check` is deliberately pure Node so it can run as the last step of
 * `npm run build` on Cloudflare Pages without depending on any other workspace's
 * devDependencies. Only `seo:check:full` loads a TS loader, and that one is for
 * local/CI use. The trailing-slash regression is still caught by `seo:check`
 * through a source assertion, so neither mode can pass a drifted canonical.
 *
 * This exists to make the two SEO-3 deployment risks impossible to ship
 * silently. Both are silent failures: nothing in `vite build` complains, the
 * page still renders, and the damage only shows up later in a crawler.
 *
 *   1. Cloudflare Pages SPA fallback being disabled by a `404.html` file or by
 *      a catch-all rule in `_redirects`. Either one makes Pages serve
 *      index.html in place of robots.txt, sitemap.xml, manifest.json, sw.js
 *      and /icons/* — a crawler then receives HTML where it expects XML, and
 *      the PWA stops installing. Nothing else would catch this.
 *
 *   2. Canonical drift. index.html, sitemap.xml and the runtime canonical in
 *      src/utils/seo.ts must all agree on the same URLs, including the trailing
 *      slash on the homepage. A mismatch hands Google two conflicting
 *      canonicals for one page.
 *
 * It also re-checks the public SEO contract (single title/description/robots/
 * og:image, valid JSON-LD with no fabricated entity, no private URLs in the
 * sitemap, every declared icon present) so these guarantees stay true instead
 * of depending on someone re-reading the audit.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');

const ORIGIN = 'https://mart.gokez.com';
const failures = [];
const notes = [];

const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(msg);
const read = (p) => readFileSync(p, 'utf8');
const exists = (p) => existsSync(p);

// ── 1. Cloudflare Pages SPA fallback must stay native ────────────────────────
for (const dir of [PUBLIC, DIST]) {
  if (!exists(dir)) continue;
  if (exists(join(dir, '404.html'))) {
    fail(`${dir}/404.html exists — a top-level 404.html disables Cloudflare Pages' native SPA fallback, breaking /terms, /grievance, robots.txt and every deep link`);
  }
}
ok('no 404.html in public/ or dist/ (native SPA fallback intact)');

const redirectsPath = join(PUBLIC, '_redirects');
if (exists(redirectsPath)) {
  const active = read(redirectsPath)
    .split(/\r?\n/)
    .map(l => l.trim())
    // Strip comments, then keep anything that is a real rule.
    .filter(l => l && !l.startsWith('#'));
  if (active.length) {
    fail(`public/_redirects has ${active.length} active rule(s): ${active.join(' | ')} — on Cloudflare Pages "redirects are always followed, regardless of whether or not an asset matches", so a catch-all shadows robots.txt, sitemap.xml, manifest.json, sw.js and /icons/*`);
  } else {
    ok('public/_redirects has no active rules (comment-only)');
  }
} else {
  fail('public/_redirects is missing — the "no SPA catch-all" decision is documented there; restore it');
}

// ── 2. robots.txt ───────────────────────────────────────────────────────────
const robots = read(join(PUBLIC, 'robots.txt'));
if (!/^Sitemap:\s*https:\/\/mart\.gokez\.com\/sitemap\.xml\s*$/m.test(robots)) {
  fail('public/robots.txt does not declare "Sitemap: https://mart.gokez.com/sitemap.xml"');
} else ok('robots.txt declares the correct sitemap');

for (const line of robots.split(/\r?\n/)) {
  const m = line.match(/^Disallow:\s*(\S*)/i);
  if (m) {
    const target = m[1];
    // "/" or "" blocks everything; anything blocking a public path is a defect.
    if (target === '' || target === '/') fail('public/robots.txt blocks the whole site');
    else if (target === '/privacy' || target === '/terms' || target === '/grievance' || target === '/feedback') {
      fail(`public/robots.txt disallows the public page ${target}`);
    }
  }
}
ok('robots.txt disallows no public page');

// ── 3. Sitemap: valid XML, exact URL set, no private URLs ──────────────────
const sitemap = read(join(PUBLIC, 'sitemap.xml'));
if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemap)) {
  fail('public/sitemap.xml must start with the exact declaration <?xml version="1.0" encoding="UTF-8"?>');
}
if (sitemap.charCodeAt(0) === 0xfeff) fail('public/sitemap.xml has a UTF-8 BOM');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const expected = ['/', '/privacy', '/terms', '/grievance', '/feedback']
  .map(p => (p === '/' ? `${ORIGIN}/` : `${ORIGIN}${p}`));
if (JSON.stringify(locs) !== JSON.stringify(expected)) {
  fail(`public/sitemap.xml URL set is wrong.\n      expected: ${expected.join(', ')}\n      actual:   ${locs.join(', ')}`);
} else ok(`sitemap.xml declares exactly the ${expected.length} public URLs`);

const PRIVATE = ['cart', 'checkout', 'account', 'orders', 'admin', 'api', 'dashboard',
  'notification-settings', 'delete-account', 'hub', 'login', 'store', 'profile'];
for (const loc of locs) {
  const path = loc.replace(`${ORIGIN}`, '');
  const seg = path.replace(/^\//, '').split('/')[0];
  if (seg && PRIVATE.includes(seg)) fail(`public/sitemap.xml contains the private/transactional URL ${loc}`);
}
ok('sitemap.xml contains no private/transactional URL');

// ── 4. index.html metadata hygiene ──────────────────────────────────────────
const html = read(join(ROOT, 'index.html'));
const countOf = (re) => (html.match(re) || []).length;
if (countOf(/<title>/g) !== 1) fail(`index.html must have exactly 1 <title> (found ${countOf(/<title>/g)})`);
if (countOf(/<meta name="description"/g) !== 1) fail('index.html must have exactly 1 meta description');
if (countOf(/<meta name="robots"/g) !== 1) fail('index.html must have exactly 1 meta robots');
if (countOf(/<meta property="og:image"\s/g) !== 1) fail(`index.html must have exactly 1 og:image (found ${countOf(/<meta property="og:image"\s/g)})`);
if (countOf(/<h1/g) !== 1) fail(`index.html static block must have exactly 1 <h1> (found ${countOf(/<h1/g)})`);
ok('index.html has single title/description/robots/og:image and one static <h1>');

for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card',
  'twitter:title', 'twitter:description', 'apple-touch-icon', 'rel="manifest"']) {
  if (!html.includes(tag)) fail(`index.html is missing ${tag}`);
}
ok('index.html has complete Open Graph and Twitter metadata');

// ── 5. Canonical agreement: index.html === sitemap.xml === seo.ts ──────────
const htmlCanonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
if (htmlCanonical !== `${ORIGIN}/`) {
  fail(`index.html canonical is "${htmlCanonical}", expected "${ORIGIN}/"`);
}
if (!locs.includes(htmlCanonical)) {
  fail(`index.html canonical "${htmlCanonical}" is not present in sitemap.xml`);
}
ok(`index.html canonical ${htmlCanonical} matches the sitemap homepage`);

// This runs inside `npm run build` on Cloudflare, so a missing TS loader must
// never be able to fail a deploy. The import is a bonus depth check; the
// contract that actually matters for the deployed bytes is verified above and by
// the source assertions below, both of which use only Node built-ins.
let seo = null;
try {
  seo = await import('../src/utils/seo.ts');
} catch {
  seo = null;
}
if (!seo) {
  const src = read(join(ROOT, 'src/utils/seo.ts'));
  // Strictly match the whole declaration so a trailing mutation (e.g.
  // `.replace('https://','')`) cannot smuggle a wrong runtime origin past a
  // check that only inspects the string literal.
  const decl = (src.match(/const SITE_ORIGIN\s*=\s*'([^']*)'\s*;/) || [])[0] || '';
  if (decl !== `const SITE_ORIGIN = '${ORIGIN}';`) {
    fail(`src/utils/seo.ts SITE_ORIGIN declaration is "${decl}", expected "const SITE_ORIGIN = '${ORIGIN}';"`);
  }
  // Two structural facts together guarantee the homepage canonical is
  // `${ORIGIN}/`: the builder joins SITE_ORIGIN with the route path, and the
  // home route's path is "/". Note the builder must NOT need a "/" special case
  // — every route path already carries its own leading slash, so a canonical
  // that drops it can only come from the home path losing its slash.
  if (!/const absoluteUrl[\s\S]*?SITE_ORIGIN/.test(src)) {
    fail('src/utils/seo.ts absoluteUrl() no longer builds the canonical from SITE_ORIGIN');
  }
  const homePath = (src.match(/\bhome:\s*\{[\s\S]*?path:\s*'([^']*)'/) || [])[1];
  if (homePath !== '/') {
    fail(`src/utils/seo.ts home route path is "${homePath}", expected "/" — the runtime homepage canonical would not match index.html and sitemap.xml`);
  }
  // Every canonical path must be root-absolute, not just the homepage: "privacy"
  // would build a relative canonical that disagrees with the sitemap.
  const routePaths = [...src.matchAll(/path:\s*'([^']*)'/g)].map(m => m[1]);
  const relative = routePaths.filter(p => !p.startsWith('/'));
  if (!routePaths.length) {
    fail('src/utils/seo.ts exposes no route paths — the ROUTES table could not be read');
  } else if (relative.length) {
    fail(`src/utils/seo.ts has ${relative.length} route path(s) without a leading slash: ${relative.map(p => `"${p}"`).join(', ')} — those would render a canonical that disagrees with sitemap.xml`);
  } else if (homePath === '/') {
    ok(`src/utils/seo.ts: SITE_ORIGIN correct, canonical built from it, all ${routePaths.length} route paths root-absolute (TS import skipped — \`npm run seo:check:full\` executes the real functions)`);
  }
}
if (seo) {
  // Assert on every public view resolved through ROUTES, the same way applySeo
  // does, so a route whose own `path` drifts cannot hide behind a correct
  // absoluteUrl(). This is what catches the homepage trailing-slash regression.
  for (const expectedUrl of expected) {
    const path = expectedUrl.replace(`${ORIGIN}`, '');
    const view = path === '/' ? 'home' : path.replace(/^\//, '');
    const rendered = seo.canonicalForView(view);
    if (rendered !== expectedUrl) {
      fail(`seo.ts canonicalForView('${view}') is "${rendered}" but index.html/sitemap use "${expectedUrl}" — the rendered DOM would hand Google a different canonical than the raw HTML`);
    }
  }
  ok(`seo.ts canonical for all ${expected.length} public views agrees with index.html and sitemap.xml`);

  const seoPaths = seo.publicPaths();
  const expectedPaths = expected.map(u => u.replace(`${ORIGIN}`, '') || '/');
  if (JSON.stringify(seoPaths) !== JSON.stringify([...expectedPaths].sort())) {
    fail(`seo.ts public path set is ${JSON.stringify(seoPaths)} but the sitemap lists ${JSON.stringify([...expectedPaths].sort())}`);
  } else ok('seo.ts public path set matches the sitemap');
}

// ── 6. Structured data ──────────────────────────────────────────────────────
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (ld.length !== 1) fail(`expected exactly 1 JSON-LD block, found ${ld.length}`);
for (const block of ld) {
  let data;
  try { data = JSON.parse(block); } catch (err) { fail(`JSON-LD is not valid JSON: ${err.message}`); continue; }
  const types = (data['@graph'] || [data]).map(n => n['@type']);
  for (const required of ['Organization', 'WebSite', 'WebApplication']) {
    if (!types.includes(required)) fail(`JSON-LD is missing @type ${required}`);
  }
  // Fabrication guard: MART is a platform, not one physical shop.
  for (const banned of ['LocalBusiness', 'GroceryStore', 'Restaurant', 'Store',
    'aggregateRating', 'review', 'award', 'offers', 'priceRange', 'address', 'telephone', 'openingHours']) {
    if (block.includes(`"${banned}"`)) {
      fail(`JSON-LD asserts "${banned}" — not authoritative for this platform`);
    }
  }
  ok(`JSON-LD valid: ${types.join(', ')} (no fabricated entity, address, rating, review, award or offer)`);
}

// ── 7. PWA contract: start_url, scope, display, icons ──────────────────────
const manifest = JSON.parse(read(join(PUBLIC, 'manifest.json')));
if (manifest.start_url !== '/') fail(`manifest start_url must be "/" (is "${manifest.start_url}")`);
if (manifest.scope !== '/') fail(`manifest scope must be "/" (is "${manifest.scope}")`);
if (manifest.display !== 'standalone') fail(`manifest display must be "standalone" (is "${manifest.display}")`);
ok('manifest start_url="/", scope="/", display="standalone"');

const pngSize = (file) => {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
if (!manifest.icons.some(i => i.purpose === 'maskable')) fail('manifest has no maskable icon');
for (const icon of manifest.icons) {
  const p = join(PUBLIC, icon.src);
  if (!exists(p)) { fail(`manifest icon ${icon.src} does not exist in public/`); continue; }
  const size = pngSize(p);
  const declared = icon.sizes.split('x').map(Number);
  if (!size || size[0] !== declared[0] || size[1] !== declared[1]) {
    fail(`manifest icon ${icon.src} declares ${icon.sizes} but the file is ${size ? size.join('x') : 'not a PNG'}`);
  }
}
ok(`all ${manifest.icons.length} manifest icons present with matching dimensions`);

const ico = readFileSync(join(PUBLIC, 'favicon.ico'));
if (ico.readUInt32LE(0) !== 0x00010000) fail('public/favicon.ico is not a real ICO file');
ok('favicon.ico is a real multi-size ICO');

// ── 8. No dead asset references ────────────────────────────────────────────
const referenced = new Set();
for (const file of [join(ROOT, 'index.html'), join(PUBLIC, 'manifest.json'), join(PUBLIC, 'sw.js')]) {
  const s = read(file);
  for (const m of s.matchAll(/(?:href|src)="(\/[^"]+)"/g)) referenced.add(m[1]);
}
for (const ref of referenced) {
  if (ref === '/' || ref.startsWith('/assets/') || ref.startsWith('/src/')) continue;
  // SPA routes are served by the fallback, and the sw.js logo mention is a comment.
  if (['/privacy', '/terms', '/grievance', '/feedback', '/index.html'].includes(ref)) continue;
  if (!exists(join(PUBLIC, ref))) fail(`referenced asset ${ref} does not exist in public/`);
}
ok('every referenced static asset exists');

// ── 9. Dist mirrors public for the files a crawler reads directly ──────────
if (exists(DIST)) {
  for (const f of ['robots.txt', 'sitemap.xml', 'manifest.json', 'sw.js', 'favicon.ico', '_headers', '_redirects']) {
    if (!exists(join(DIST, f))) fail(`dist/${f} is missing from the build output`);
  }
  const dSitemap = read(join(DIST, 'sitemap.xml'));
  if (dSitemap !== sitemap) fail('dist/sitemap.xml differs from public/sitemap.xml');
  ok('dist contains robots.txt, sitemap.xml, manifest.json, sw.js, favicon.ico and an identical sitemap');
} else {
  ok('dist/ not present — skipped build-output checks (run npm run build first)');
}

// ── Report ─────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`  ok    ${n}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${failures.length} SEO gate failure(s). Not safe to deploy.`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} SEO gate checks passed.`);
