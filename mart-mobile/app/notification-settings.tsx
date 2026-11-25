import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '@/services/api';
import {
  clearNativePushToken,
  getNativePushToken,
  getNotificationPermission,
  readNativePushToken,
  requestNotificationPermission,
  syncGuestMarketingConsent,
  type PushPermissionStatus,
} from '@/services/push';
import { useAuthStore } from '@/store/authStore';
import { getGuestMarketingConsent, getTokens, setGuestMarketingConsent } from '@/store/guestTrackingStore';
import { useThemeColors } from '@/constants/theme';

function ToggleRow({ icon, iconColor, label, sub, value, onToggle, disabled }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  sub: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: iconColor + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-Medium', color: colors.gray800 }}>{label}</Text>
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 1 }}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.gray200, true: colors.primary }}
        thumbColor="#fff"
        ios_backgroundColor={colors.gray200}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const colors = useThemeColors();
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const hydrated = useAuthStore(s => s.hydrated);
  const [permission, setPermission] = useState<PushPermissionStatus>('undetermined');
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [marketingBusy, setMarketingBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [status, token] = await Promise.all([getNotificationPermission(), readNativePushToken()]);
      if (cancelled) return;
      setPermission(status);
      setDeviceToken(token);
      const storedGuestConsent = getGuestMarketingConsent();
      if (!isLoggedIn) {
        setMarketingConsent(storedGuestConsent);
        return;
      }
      try {
        const response = await authApi.getMarketingConsent();
        let granted = Boolean(response.data.data?.granted);
        if (!granted && storedGuestConsent && getTokens().length > 0) {
          syncGuestMarketingConsent(true);
          granted = true;
        }
        if (!cancelled) setMarketingConsent(granted);
      } catch {
        if (!cancelled) setMarketingConsent(false);
      }
    };
    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!hydrated || isLoggedIn) return;
    void clearNativePushToken();
    setDeviceToken(null);
  }, [hydrated, isLoggedIn]);

  const toggleNotifications = async () => {
    if (notificationsBusy) return;
    setNotice('');
    if (permission === 'denied' || permission === 'unsupported') {
      Alert.alert('Notifications', 'To change notification access, open your phone Settings → Gokez Mart → Notifications.');
      return;
    }
    if (permission === 'granted') {
      await clearNativePushToken();
      setDeviceToken(null);
      Alert.alert('Order notifications', 'The device token was cleared. Notification access stays on until you change it in phone Settings.');
      return;
    }
    setNotificationsBusy(true);
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === 'granted') {
      const token = await getNativePushToken();
      setDeviceToken(token);
      setNotice('Device token saved locally. Push delivery starts when the backend supports native tokens.');
    } else if (next === 'denied') {
      setNotice('Notifications are blocked. Enable them in phone Settings.');
    } else {
      setNotice('Notifications were not enabled. Try again when you are ready.');
    }
    setNotificationsBusy(false);
  };

  const toggleMarketing = async () => {
    if (marketingBusy) return;
    const next = !marketingConsent;
    setMarketingConsent(next);
    setMarketingBusy(true);
    setNotice('');
    try {
      if (isLoggedIn) {
        await authApi.updateMarketingConsent(next);
      } else {
        setGuestMarketingConsent(next);
      }
      syncGuestMarketingConsent(next);
      setNotice(next ? 'Promotional notifications enabled.' : 'Promotional notifications turned off.');
    } catch {
      setMarketingConsent(!next);
      setNotice('Could not update your preference. Please try again.');
    } finally {
      setMarketingBusy(false);
    }
  };

  const notificationSub = loading
    ? 'Checking notification access…'
    : permission === 'granted'
      ? (deviceToken ? 'On — rider dispatch & delivery alerts' : 'Access granted — enable this device')
      : permission === 'denied'
        ? 'Blocked in phone Settings'
        : permission === 'unsupported'
          ? 'Not supported on this device'
          : 'Get notified when your order is on the way';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 16 }}>
      {notice ? (
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginHorizontal: 20, marginBottom: 10, lineHeight: 16 }}>{notice}</Text>
      ) : null}

      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 6 }}>
        Order Updates
      </Text>
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, marginBottom: 20 }}>
        <ToggleRow
          icon="notifications-outline" iconColor="#8b5cf6"
          label="Order Notifications"
          sub={notificationSub}
          value={permission === 'granted'}
          onToggle={toggleNotifications}
          disabled={loading || notificationsBusy}
        />
      </View>

      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 6 }}>
        Marketing
      </Text>
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
        <ToggleRow
          icon="megaphone-outline" iconColor="#f59e0b"
          label="Promotional Notifications"
          sub={isLoggedIn ? 'Offers, deals and new arrivals' : 'Preference saved on this device'}
          value={marketingConsent}
          onToggle={toggleMarketing}
          disabled={loading || marketingBusy}
        />
      </View>
      {marketingBusy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} /> : null}
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginHorizontal: 20, marginTop: 10, lineHeight: 16 }}>
        Order updates are essential to fulfilling your orders and can't be turned off in-app. Marketing consent is optional and can be withdrawn anytime. Device tokens stay local until native push delivery is supported by the server.
      </Text>
    </View>
  );
}
