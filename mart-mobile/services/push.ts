import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from './api';
import { useGuestTrackingStore } from '@/store/guestTrackingStore';

const NATIVE_TOKEN_KEY = 'mart-native-push-token';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export function isPushSupported(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

export async function getNotificationPermission(): Promise<PushPermissionStatus> {
  if (!isPushSupported()) return 'unsupported';
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'granted') return 'granted';
    if (permission.status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<PushPermissionStatus> {
  if (!isPushSupported()) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#128548',
      });
    }
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status === 'granted') return 'granted';
    if (permission.status === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function readNativePushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(NATIVE_TOKEN_KEY);
  } catch {
    return null;
  }
}

// The backend only accepts Web Push subscriptions and guest consent updates;
// Expo tokens are kept on the device until a native token endpoint exists.
export async function getNativePushToken(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const permission = await getNotificationPermission();
  if (permission !== 'granted') return null;
  try {
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (!token) return null;
    await AsyncStorage.setItem(NATIVE_TOKEN_KEY, token);
    return token;
  } catch {
    return readNativePushToken();
  }
}

export async function clearNativePushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(NATIVE_TOKEN_KEY);
  } catch {}
}

export function updateGuestMarketingConsentForTokens(tokens: string[], granted: boolean): void {
  [...new Set(tokens.map(token => String(token ?? '').trim()).filter(Boolean))]
    .forEach(token => {
      void authApi.updateGuestMarketingConsent(token, granted).catch(() => undefined);
    });
}

export function syncGuestMarketingConsent(granted: boolean, trackingToken?: string | null): void {
  const tokens = trackingToken ? [trackingToken] : useGuestTrackingStore.getState().tokens;
  updateGuestMarketingConsentForTokens(tokens, granted);
}
