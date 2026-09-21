import { useState, useEffect } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { authApi } from '@/services/api';
import { useThemeColors } from '@/constants/theme';

function ToggleRow({ icon, iconColor, label, sub, value, onToggle, disabled }: {
  icon: any; iconColor: string; label: string; sub: string; value: boolean; onToggle: () => void; disabled?: boolean;
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
  const [notifEnabled,     setNotifEnabled]     = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    Notifications.getPermissionsAsync().then(p => setNotifEnabled(p.status === 'granted'));
    authApi.getMarketingConsent().then(r => setMarketingConsent(r.data.data?.granted ?? false)).catch(() => {});
  }, []);

  const toggleNotifications = async () => {
    if (notifEnabled) {
      Alert.alert('Notifications', 'To disable notifications, go to your phone Settings → Gokez Mart → Notifications.');
      return;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    setNotifEnabled(status === 'granted');
  };

  const toggleMarketing = async () => {
    const next = !marketingConsent;
    setMarketingConsent(next);
    try { await authApi.updateMarketingConsent(next); }
    catch { setMarketingConsent(!next); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 16 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 6 }}>
        Order Updates
      </Text>
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, marginBottom: 20 }}>
        <ToggleRow
          icon="notifications-outline" iconColor="#8b5cf6"
          label="Order Notifications"
          sub={notifEnabled ? 'On — rider dispatch & delivery alerts' : 'Get notified when your order is on the way'}
          value={notifEnabled} onToggle={toggleNotifications}
        />
      </View>

      <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 6 }}>
        Marketing
      </Text>
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100 }}>
        <ToggleRow
          icon="megaphone-outline" iconColor="#f59e0b"
          label="Promotional Notifications"
          sub="Offers, deals and new arrivals"
          value={marketingConsent} onToggle={toggleMarketing}
        />
      </View>
      <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginHorizontal: 20, marginTop: 10, lineHeight: 16 }}>
        Order updates are essential to fulfilling your orders and can't be turned off in-app. Marketing consent is optional and can be withdrawn anytime.
      </Text>
    </View>
  );
}
