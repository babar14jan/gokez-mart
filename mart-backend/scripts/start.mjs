#!/usr/bin/env node
/**
 * Boots the API, whatever the deploy gave us.
 *
 * The compiled output is the right way to run a server, and it is what
 * `npm run build` produces. But a deploy can hand the container a tree where
 * that output is missing -- the build step ran somewhere the runtime image
 * did not keep, or the build was skipped -- and the symptom is an unhelpful
 * "Cannot find module '/app/mart-backend/dist/index.js'" crash loop with
 * nothing in the log to say why.
 *
 * So the boot tries three things, in order, and says which one it used:
 *
 *   1. the compiled output, if it is there
 *   2. compile it now, from the source that is in the image
 *   3. run the TypeScript source directly through tsx
 *
 * Step 2 needs the TypeScript compiler and step 3 needs tsx; both are
 * production dependencies (not devDependencies), so they survive an install
 * with --omit=dev. The source is not a build artefact, so it is always in the
 * image.
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMPILED = join(ROOT, 'dist', 'index.js');
const SOURCE = join(ROOT, 'src', 'index.ts');

function log(message) {
  console.log(`[start] ${message}`);
}

/** Compiles the API in place. Returns true when the output is there. */
function build() {
  if (!existsSync(join(ROOT, 'src', 'index.ts'))) {
    log('no source to build from — the image does not contain src/');
    return false;
  }
  try {
    log('compiled output missing, building it now…');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  } catch (error) {
    log(`build failed (${error?.message ?? error})`);
    return false;
  }
  return existsSync(COMPILED);
}

if (existsSync(COMPILED)) {
  log('starting the compiled build');
  await import(pathToFileURL(COMPILED).href);
} else if (build()) {
  log('starting the compiled build');
  await import(pathToFileURL(COMPILED).href);
} else if (existsSync(SOURCE)) {
  // Last resort: run the TypeScript source through tsx. tsx ships a CommonJS
  // loader hook, so the source can be required the same way the compiled
  // build would be.
  log('falling back to running the TypeScript source through tsx');
  const { require: tsxRequire } = await import('tsx/cjs');
  tsxRequire(SOURCE);
} else {
  console.error('[start] Cannot start: there is no compiled output, no way to build it, and no source.');
  process.exit(1);
}
