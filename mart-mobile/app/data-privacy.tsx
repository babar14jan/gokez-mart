import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi, type DataExport, type DeletionStatus } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  ready: { bg: '#d1fae5', fg: '#065f46' },
  downloaded: { bg: '#dbeafe', fg: '#1d4ed8' },
  pending: { bg: '#fef3c7', fg: '#b45309' },
  approved: { bg: '#d1fae5', fg: '#065f46' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c' },
  completed: { bg: '#d1fae5', fg: '#065f46' },
};

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusStyle(status: string) {
  return STATUS_COLORS[status] ?? { bg: '#f3f4f6', fg: '#6b7280' };
}

function SectionLabel({ label }: { label: string }) {
  const colors = useThemeColors();
  return (
    <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray500, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 8, marginTop: 20 }}>
      {label}
    </Text>
  );
}

function LinkRow({ icon, iconColor, label, sub, onPress }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  sub: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconColor + '15', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{label}</Text>
        <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 2 }}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.gray300} />
    </TouchableOpacity>
  );
}

export default function DataPrivacyScreen() {
  const colors = useThemeColors();
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dataExport, setDataExport] = useState<DataExport | null>(null);
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([authApi.getDataExport(), authApi.getDeletionStatus()]).then(([exportResult, deletionResult]) => {
      if (cancelled) return;
      if (exportResult.status === 'fulfilled') setDataExport(exportResult.value.data.data ?? null);
      if (deletionResult.status === 'fulfilled') setDeletion(deletionResult.value.data.data ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const requestExport = async () => {
    setError('');
    setRequesting(true);
    try {
      await authApi.requestDataExport();
      const result = await authApi.getDataExport();
      setDataExport(result.data.data ?? null);
      Alert.alert('Data export ready', 'Your export is ready to download.');
    } catch (e: any) {
      const message = e?.response?.data?.error ?? 'Failed to prepare your data export. Please try again.';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setRequesting(false);
    }
  };

  const downloadExport = async () => {
    setError('');
    setDownloading(true);
    try {
      const result = await authApi.getDataExport();
      const next = result.data.data ?? null;
      setDataExport(next);
      if (!next?.data) {
        Alert.alert('Export not ready', 'Please request a data export first.');
        return;
      }
      await Share.share({
        title: 'Gokez Mart data export',
        message: JSON.stringify(next.data, null, 2),
      });
    } catch (e: any) {
      const message = e?.response?.data?.error ?? 'Failed to download your data export. Please try again.';
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setDownloading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 24, alignItems: 'center' }}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.gray400} />
          <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 12, marginBottom: 6 }}>Log in to manage your data</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 19, marginBottom: 20 }}>
            Data exports, deletion requests and grievances are tied to your Gokez Mart account.
          </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}
            style={{ height: 46, paddingHorizontal: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Log in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const exportStyle = statusStyle(dataExport?.status ?? '');
  const deletionStyle = statusStyle(deletion?.status ?? '');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16 }}>
        <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>Your data</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 18 }}>
          Under the DPDP Act 2023, you can request a copy of your personal data and ask us to delete it. We respond within 30 days.
        </Text>
      </View>

      {error ? (
        <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500, marginHorizontal: 20, marginTop: 12 }}>{error}</Text>
      ) : null}

      <SectionLabel label="Data Export" />
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16 }}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Export status</Text>
              <View style={{ backgroundColor: exportStyle.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: exportStyle.fg, textTransform: 'capitalize' }}>
                  {dataExport?.status ?? 'none'}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 18, marginBottom: 14 }}>
              {dataExport?.readyAt || dataExport?.createdAt
                ? `Last export: ${formatDate(dataExport.readyAt ?? dataExport.createdAt)}`
                : 'No export requested yet. Request one to download a copy of your account data.'}
            </Text>
            <TouchableOpacity onPress={requestExport} disabled={requesting || downloading}
              style={{ height: 46, borderRadius: 14, backgroundColor: requesting ? colors.gray200 : colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              {requesting
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontSize: 14, fontFamily: 'Inter-Bold', color: '#fff' }}>Request Data Export</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={downloadExport} disabled={requesting || downloading || !dataExport?.data}
              style={{ height: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, alignItems: 'center', justifyContent: 'center' }}>
              {downloading
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: dataExport?.data ? colors.primaryDark : colors.gray400 }}>Download Export</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>

      <SectionLabel label="Account Deletion" />
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>Deletion status</Text>
          <View style={{ backgroundColor: deletionStyle.bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 10, fontFamily: 'Inter-Bold', color: deletionStyle.fg, textTransform: 'capitalize' }}>
              {deletion?.status ?? 'none'}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, lineHeight: 18, marginBottom: 12 }}>
          {deletion
            ? `Submitted ${formatDate(deletion.createdAt) || 'recently'}. We process deletion requests within 30 days.`
            : 'You have not submitted a deletion request. Deletion is processed within 30 days under the DPDP Act 2023.'}
        </Text>
        {deletion?.reason ? (
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginBottom: 12 }}>Reason: {deletion.reason}</Text>
        ) : null}
        <LinkRow icon="trash-outline" iconColor={colors.red500} label="Delete Account"
          sub="Request permanent deletion of your account" onPress={() => router.push('/delete-account' as never)} />
      </View>

      <SectionLabel label="Help & Legal" />
      <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.gray100, overflow: 'hidden' }}>
        <LinkRow icon="chatbubble-ellipses-outline" iconColor="#8b5cf6" label="Submit a Grievance"
          sub="Data or service complaint — response within 30 days" onPress={() => router.push('/grievance')} />
        <View style={{ height: 1, backgroundColor: colors.gray100, marginHorizontal: 14 }} />
        <LinkRow icon="star-outline" iconColor="#f59e0b" label="Share Feedback"
          sub="Rate your experience with Gokez Mart" onPress={() => router.push('/feedback')} />
        <View style={{ height: 1, backgroundColor: colors.gray100, marginHorizontal: 14 }} />
        <LinkRow icon="document-text-outline" iconColor={colors.gray500} label="Privacy Policy"
          sub="How we collect and use your data" onPress={() => router.push('/privacy')} />
      </View>
    </ScrollView>
  );
}
