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

function versionPlugin() {
  // The bundle, version endpoint, and service worker must share this id so an
  // open app can tell whether it is older than the deployed build.
  const buildId = `${gitShortSha()}-${Date.now().toString(36)}`;
  return {
    name: 'version-json',
    config() {
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },
    closeBundle() {
      const version = `${JSON.stringify({ v: buildId })}\n`;
      fs.writeFileSync(path.resolve(__dirname, 'dist/version.json'), version);
      fs.writeFileSync(path.resolve(__dirname, 'dist/cache-version.json'), version);
      console.log(`[version] build id ${buildId}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  base: '/',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5178,
    proxy: { '/api': { target: 'http://localhost:3004', changeOrigin: true } },
  },
  preview: { port: 5178 },
});
