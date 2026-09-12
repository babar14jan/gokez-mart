import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gokez.hub',
  appName: 'Gokez Hub',
  webDir: 'dist',
  server: {
    // During development — point to local dev server
    // Comment out for production APK build
    // url: 'http://192.168.x.x:5178',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      keystorePath: 'gokez-hub.keystore',
      keystoreAlias: 'gokez-hub',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#065f46',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#065f46',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
