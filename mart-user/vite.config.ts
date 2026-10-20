import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

/**
 * Stamps a unique id into the build so every deploy is detectable.
 *
 * The id goes three places, and they must agree:
 *   * /version.json and /cache-version.json — what the running app polls
 *   * the service worker's own bytes — the only thing that makes a browser
 *     install the updated worker
 *   * __BUILD_ID__ inside the bundle — so the app knows WHICH build it is,
 *     and can tell on a cold launch that it is older than what the server is
 *     serving. Without this the app can only notice a new deploy by comparing
 *     two polls, which means a customer who opens an installed PWA after a
 *     deploy is shown the stale app for minutes.
 *
 * The timestamp (base36) guarantees a new id even when the same commit is
 * rebuilt, which is what forces the refresh on every deploy.
 */
function versionPlugin() {
  const buildId = `${gitShortSha()}-${Date.now().toString(36)}`;
  return {
    name: 'version-json',
    config() {
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },
    closeBundle() {
      const payload = `${JSON.stringify({ v: buildId })}\n`;
      fs.writeFileSync(path.resolve(__dirname, 'dist/version.json'), payload);
      fs.writeFileSync(path.resolve(__dirname, 'dist/cache-version.json'), payload);
      console.log(`[version] build id ${buildId}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  base: '/',
  build: {
    outDir: 'dist',
    target: ['es2015', 'safari13'],
  },
  server: {
    port: 5177,
    proxy: { '/api': { target: 'http://localhost:3004', changeOrigin: true } },
    // This repo lives on an external volume, where native FS events are dropped
    // (partial HMR updates leave stale modules that keep re-throwing). Polling
    // trades a little CPU for reliable change detection.
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },
  preview: { port: 5177 },
});
