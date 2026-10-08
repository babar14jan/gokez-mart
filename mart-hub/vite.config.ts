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
  },
  server: {
    port: 5178,
    proxy: { '/api': { target: 'http://localhost:3004', changeOrigin: true } },
  },
  preview: { port: 5178 },
});
