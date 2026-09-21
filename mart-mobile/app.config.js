const IS_PROD = process.env.APP_ENV === 'production';

const API_URL = IS_PROD
  ? 'https://api.mart.gokez.com/api/v1'
  : `http://${process.env.DEV_IP || 'localhost'}:3004/api/v1`;

module.exports = {
  expo: {
    owner: 'babar14jan',
    name: 'Gokez Mart',
    slug: 'gokez-mart',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'gokez-mart',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#10b981',
    },
    assetBundlePatterns: ['assets/**'],
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.gokez.mart',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#10b981',
      },
      package: 'com.gokez.mart',
      usesCleartextTraffic: !IS_PROD,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-location', { locationWhenInUsePermission: 'Used to find your nearest Gokez Mart store.' }],
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#10b981' }],
      ['expo-font', {
        fonts: [
          './assets/fonts/Inter-Regular.ttf',
          './assets/fonts/Inter-Medium.ttf',
          './assets/fonts/Inter-SemiBold.ttf',
          './assets/fonts/Inter-Bold.ttf',
        ],
      }],
    ],
    experiments: { typedRoutes: true },
    extra: {
      apiUrl: API_URL,
      appEnv: process.env.APP_ENV || 'development',
      router: {},
      eas: { projectId: '' },
    },
  },
};
