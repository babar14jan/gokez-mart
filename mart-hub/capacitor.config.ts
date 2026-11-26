/// <reference types="@capacitor/status-bar" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gokez.hub',
  appName: 'Gokez Hub',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'hub.gokez.com',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#FEB503',
    },
  },
};

export default config;
