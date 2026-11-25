import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { authApi, type DeletionStatus } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeColors } from '@/constants/theme';

export default function DeleteAccountScreen() {
  const colors = useThemeColors();
  const logout = useAuthStore(s => s.logout);
  const [existing, setExisting] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    authApi.getDeletionStatus()
      .then(r => setExisting(r.data.data ?? null))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => {
      if (logoutTimer.current) clearTimeout(logoutTimer.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (submittingRef.current || !confirm || submitted) return;
    submittingRef.current = true;
    setSubmitting(true); setError('');
    try {
      await authApi.requestDeletion(reason.trim() || undefined);
      setSubmitted(true);
      logoutTimer.current = setTimeout(async () => {
        try { await logout(); } catch {}
        router.replace('/(tabs)');
      }, 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit request.');
      submittingRef.current = false;
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : submitted ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.gray200, padding: 24, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.primary} />
            <Text style={{ fontSize: 17, fontFamily: 'Inter-Bold', color: colors.gray900, marginTop: 12, marginBottom: 8 }}>Request Submitted</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 20 }}>
              Your account deletion request has been submitted. We will process it within 30 days. You will be signed out shortly.
            </Text>
          </View>
        ) : existing?.status === 'pending' ? (
          <View style={{ backgroundColor: '#fffbeb', borderRadius: 18, borderWidth: 1, borderColor: '#fde68a', padding: 18 }}>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#b45309', marginBottom: 6 }}>Request Already Submitted</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#b45309', lineHeight: 19 }}>
              Your deletion request is pending review. We will process it within 30 days.
            </Text>
            {existing.createdAt ? (
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: '#d97706', marginTop: 8 }}>
                Submitted: {new Date(existing.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <View style={{ backgroundColor: colors.redLight, borderRadius: 18, borderWidth: 1, borderColor: '#fecaca', padding: 18, flexDirection: 'row', gap: 12 }}>
              <Ionicons name="warning-outline" size={22} color={colors.red500} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: colors.red500, marginBottom: 6 }}>This action is permanent</Text>
                {[
                  'Your account and personal data will be permanently deleted',
                  'Your order history will be anonymised',
                  'This cannot be undone',
                ].map(item => (
                  <Text key={item} style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600, lineHeight: 18 }}>• {item}</Text>
                ))}
              </View>
            </View>

            <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.gray200, padding: 18, marginTop: 16 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.gray700, marginBottom: 6 }}>Reason (optional)</Text>
              <TextInput
                style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter-Regular', fontSize: 14, minHeight: 80, textAlignVertical: 'top' }}
                placeholder="Tell us why you're leaving (optional)"
                placeholderTextColor={colors.gray400}
                value={reason}
                maxLength={500}
                multiline
                numberOfLines={3}
                onChangeText={setReason}
              />

              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 }} onPress={() => setConfirm(value => !value)} activeOpacity={0.7}>
                <Ionicons name={confirm ? 'checkbox' : 'square-outline'} size={20} color={colors.red500} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray600 }}>
                  I understand this will permanently delete my account and all associated data.
                </Text>
              </TouchableOpacity>

              {error ? (
                <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.red500, marginTop: 12 }}>{error}</Text>
              ) : null}

              <TouchableOpacity
                style={{ height: 52, borderRadius: 14, backgroundColor: colors.red500, alignItems: 'center', justifyContent: 'center', marginTop: 20, opacity: confirm && !submitting ? 1 : 0.5 }}
                onPress={handleSubmit}
                disabled={submitting || !confirm}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ fontSize: 15, fontFamily: 'Inter-Bold', color: '#fff' }}>Request Account Deletion</Text>
                }
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 17, marginTop: 20 }}>
              Under the DPDP Act 2023, you have the right to request deletion of your personal data. We will process your request within 30 days.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
