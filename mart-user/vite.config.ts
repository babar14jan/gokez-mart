import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function versionPlugin() {
  return {
    name: 'version-json',
    closeBundle() {
      const v = Date.now().toString();
      fs.writeFileSync(
        path.resolve(__dirname, 'dist/version.json'),
        JSON.stringify({ v })
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  base: '/',
  build: {
    // Capacitor needs relative paths in the built output
    outDir: 'dist',
  },
  server: {
    port: 5177,
    proxy: { '/api': { target: 'http://localhost:3004', changeOrigin: true } },
  },
  preview: { port: 5177 },
});
