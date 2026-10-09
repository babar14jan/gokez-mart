import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function versionPlugin() {
  return {
    name: 'version-json',
    closeBundle() {
      const v = Date.now().toString();
      const version = JSON.stringify({ v });
      fs.writeFileSync(path.resolve(__dirname, 'dist/version.json'), version);
      fs.writeFileSync(path.resolve(__dirname, 'dist/cache-version.json'), version);
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
