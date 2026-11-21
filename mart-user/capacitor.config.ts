/// <reference types="@capacitor/keyboard" />
/// <reference types="@capacitor/push-notifications" />
/// <reference types="@capacitor/splash-screen" />
/// <reference types="@capacitor/status-bar" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gokez.mart.customer',
  appName: 'Gokez Mart',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'mart.gokez.com',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#ADFBBD',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#ADFBBD',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['sound', 'alert'],
    },
  },
};

export default config;
