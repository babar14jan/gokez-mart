import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as Updates from 'expo-updates';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';
import '../global.css';

SplashScreen.preventAutoHideAsync();

function navHeader(colors: ReturnType<typeof useThemeColors>) {
  return {
    headerShown: true,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.gray900,
    headerTitleStyle: {
      fontFamily: 'Inter-SemiBold',
      fontSize: 17,
      color: colors.gray900,
    },
    headerShadowVisible: false,
    headerBackTitleVisible: false,
    headerBackTitle: '',
    headerBackButtonMenuEnabled: false,
    headerTitleAlign: 'center' as const,
    animation: 'slide_from_right' as const,
  };
}

export default function RootLayout() {
  const hydrate  = useAuthStore(s => s.hydrate);
  const hydrated = useAuthStore(s => s.hydrated);
  const isDark   = useThemeStore(s => s.isDark);
  const colors   = useThemeColors();
  const screenOpts = (title: string) => ({ ...navHeader(colors), title });

  const [fontsLoaded] = useFonts({
    'Inter-Regular':  require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium':   require('../assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold':     require('../assets/fonts/Inter-Bold.ttf'),
  });

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    if (fontsLoaded && hydrated) SplashScreen.hideAsync();
  }, [fontsLoaded, hydrated]);

  useEffect(() => {
    let active = true;
    let shown = false;

    const check = async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!active || shown || (!result.isAvailable && !result.isRollBackToEmbedded)) return;
        shown = true;
        Alert.alert('Update available', 'A new version of Gokez Mart is ready. Update now?', [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Update',
            onPress: async () => {
              try {
                const fetched = await Updates.fetchUpdateAsync();
                if (active && (fetched.isNew || fetched.isRollBackToEmbedded)) await Updates.reloadAsync();
              } catch {
                Alert.alert('Update unavailable', 'Could not download the update. Please try again later.');
              }
            },
          },
        ]);
      } catch {}
    };

    void check();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') void check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  if (!fontsLoaded || !hydrated) return null;

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <OfflineBanner>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
              <Stack.Screen name="(tabs)"  options={{ headerShown: false, animation: 'none', title: '' }} />
              <Stack.Screen name="(auth)"  options={{ headerShown: false, title: '' }} />
              <Stack.Screen name="checkout"          options={{ ...screenOpts('Checkout'), headerShown: false }} />
              <Stack.Screen name="addresses"         options={screenOpts('Saved Addresses')} />
              <Stack.Screen name="address-form"      options={screenOpts('Address')} />
              <Stack.Screen name="feedback"          options={screenOpts('Share Feedback')} />
              <Stack.Screen name="grievance"         options={screenOpts('Submit a Grievance')} />
              <Stack.Screen name="notification-settings" options={screenOpts('Notifications')} />
              <Stack.Screen name="privacy"           options={screenOpts('Privacy Policy')} />
              <Stack.Screen name="terms"             options={screenOpts('Terms of Service')} />
              <Stack.Screen name="data-privacy"      options={screenOpts('Data & Privacy')} />
              <Stack.Screen name="referral"          options={screenOpts('Refer & Earn')} />
              <Stack.Screen name="suggest-product"   options={screenOpts('Suggest a Product')} />
              <Stack.Screen name="about"             options={screenOpts('About')} />
              <Stack.Screen name="what-is-gokez-mart" options={screenOpts('What is Gokez Mart?')} />
              <Stack.Screen name="delete-account"    options={screenOpts('Delete Account')} />
              <Stack.Screen name="deals"             options={screenOpts('Deals')} />
              <Stack.Screen name="search"            options={screenOpts('Search')} />
              <Stack.Screen name="receipt"           options={screenOpts('Receipt')} />
              <Stack.Screen name="product/[id]"      options={screenOpts('Product')} />
              <Stack.Screen name="order/[id]"        options={screenOpts('Order Tracking')} />
              <Stack.Screen name="order-detail/[id]" options={screenOpts('Order Details')} />
            </Stack>
          </OfflineBanner>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
