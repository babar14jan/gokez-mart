import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gokez.mart',
  appName: 'Gokez Mart',
  webDir: 'dist',
  server: {
    // During development — point to local dev server
    // Comment this out for production APK build
    // url: 'http://192.168.x.x:5177',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      keystorePath: 'gokez-mart.keystore',
      keystoreAlias: 'gokez-mart',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#f0fdf4',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#10b981',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
