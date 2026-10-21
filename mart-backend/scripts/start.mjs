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
 * with --omit=dev. The source is not a build artefact, so it is always in
 * the image.
 *
 * One case is specific to the platform. The build step and the start step
 * can be the same command -- a Build Command that runs this script -- and
 * then the build step must not leave a server listening, because a build
 * step that never returns is a deploy that never finishes. The two steps
 * cannot be told apart from inside: neither Nixpacks nor Railpack labels
 * the phase, so there is no environment variable that says "this is the
 * build". What does tell them apart is the compiled output, which is missing
 * at the start of a build and present by the start of a run. So on the
 * platform a missing output means "compile it, then step out of the way",
 * and the start step that follows finds the output and runs the server.
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

/**
 * True when this process is running on the platform rather than on a
 * developer's machine.
 */
const isRailway = Boolean(process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_ENVIRONMENT_NAME);

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
  if (isRailway) {
    // The compiled output was not in the image, so the build step did not
    // put it there. The usual cause is a Build Command that runs this same
    // script: the build step and the start step then run the same command,
    // and the build step gets a server instead of a build.
    //
    // A build step that leaves a server listening never returns, and the
    // deploy sits there until the platform kills it. So the output is
    // compiled and this process steps out of the way. The output is now in
    // the image, so the start step that follows finds it and runs the
    // server -- which is also what makes a Build Command that runs this
    // script work, instead of hanging the deploy.
    log('compiled output is now in place; not starting a server here');
    process.exit(0);
  }
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
