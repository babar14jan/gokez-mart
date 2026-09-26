import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';

type Step = 'phone' | 'otp' | 'profile';

export default function LoginScreen() {
  const colors = useThemeColors();
  const isDark = useThemeStore(s => s.isDark);
  const { login, updateProfile } = useAuthStore();

  const [step,        setStep]        = useState<Step>('phone');
  const [phone,       setPhone]       = useState('');
  const [otp,         setOtp]         = useState('');
  const [newName,     setNewName]     = useState('');
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendTimer = () => {
    setResendTimer(30);
    timerRef.current = setInterval(() => {
      setResendTimer(s => {
        if (s <= 1) { clearInterval(timerRef.current!); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const handleSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit number'); return; }
    setLoading(true); setError('');
    try {
      await authApi.sendOtp(cleaned);
      setStep('otp');
      startResendTimer();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit OTP'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.verifyOtp(phone.replace(/\D/g, ''), otp);
      const { token, customer } = res.data.data;
      await login(token, customer);
      if (!customer.name) {
        setStep('profile');
      } else {
        router.back();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setLoading(true); setError(''); setOtp('');
    try {
      await authApi.sendOtp(phone.replace(/\D/g, ''));
      startResendTimer();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to resend OTP.');
    } finally { setLoading(false); }
  };

  const handleSaveProfile = async () => {
    if (!newName.trim()) { setError('Please enter your name'); return; }
    setSaving(true); setError('');
    try {
      await authApi.updateProfile({ name: newName.trim() });
      updateProfile({ name: newName.trim() });
      router.back();
    } catch {
      setError('Failed to save. Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* A new customer must finish their name before leaving onboarding. */}
        {step !== 'profile' && (
          <TouchableOpacity
            className="absolute top-12 right-6 w-9 h-9 rounded-xl items-center justify-center"
            style={{ backgroundColor: colors.gray100 }}
            onPress={() => router.back()}
          >
            <Text className="text-lg" style={{ color: colors.gray500 }}>✕</Text>
          </TouchableOpacity>
        )}

        {/* Brand logo — same as web app */}
        <View className="items-center mb-8">
          <Image
            source={isDark ? require('../../assets/brand_dark.png') : require('../../assets/brand_light.png')}
            style={{ width: 200, height: 60 }}
            contentFit="contain"
          />
        </View>

        {/* ── Phone step ── */}
        {step === 'phone' && (
          <>
            <Text className="text-sm text-center mb-6" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
              Enter your mobile number to continue
            </Text>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            {/* Phone input */}
            <View className="flex-row items-center rounded-2xl px-4 h-14 mb-3"
              style={{ backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray200 }}>
              <Text className="text-sm font-semibold mr-2" style={{ fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>+91</Text>
              <View className="w-px h-5 mr-3" style={{ backgroundColor: colors.gray300 }} />
              <TextInput
                className="flex-1 text-sm"
                style={{ fontFamily: 'Inter-Regular', color: colors.gray900 }}
                placeholder="10-digit mobile number"
                placeholderTextColor={colors.gray400}
                keyboardType="phone-pad"
                maxLength={10}
                value={phone}
                onChangeText={t => { setPhone(t.replace(/\D/g, '')); setError(''); }}
                autoFocus
              />
            </View>

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center mb-4"
              style={{ backgroundColor: phone.length === 10 && !loading ? colors.primary : colors.gray200 }}
              onPress={handleSendOtp}
              disabled={loading || phone.length !== 10}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>Send OTP</Text>
              }
            </TouchableOpacity>
          </>
        )}

        {/* ── OTP step ── */}
        {step === 'otp' && (
          <>
            <Text className="text-lg font-bold mb-1" style={{ fontFamily: 'Inter-Bold', color: colors.gray900 }}>Enter OTP</Text>
            <View className="flex-row items-center mb-5">
              <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Sent to <Text className="font-semibold" style={{ fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>+91 {phone}</Text>
              </Text>
              <TouchableOpacity onPress={() => { setStep('phone'); setOtp(''); setError(''); }} className="ml-2">
                <Text className="text-xs font-semibold" style={{ color: colors.primary, fontFamily: 'Inter-SemiBold' }}>Change</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row items-start gap-2 rounded-xl px-3 py-2.5 mb-4" style={{ backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.gray200 }}>
              <Text style={{ fontSize: 15 }}>📞</Text>
              <Text className="flex-1 text-xs leading-5" style={{ fontFamily: 'Inter-Regular', color: colors.primaryDark }}>
                We will call this number with your 6-digit verification code. It may take a few seconds. Do not share the code with anyone.
              </Text>
            </View>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            <TextInput
              className="rounded-2xl h-14 text-center text-2xl font-bold mb-3"
              style={{ fontFamily: 'Inter-Bold', letterSpacing: 12, borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
              placeholder="------"
              placeholderTextColor={colors.gray400}
              keyboardType="number-pad"
              maxLength={6}
              value={otp}
              onChangeText={t => { setOtp(t.replace(/\D/g, '')); setError(''); }}
              autoFocus
            />

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center mb-3"
              style={{ backgroundColor: otp.length === 6 && !loading ? colors.primary : colors.gray200 }}
              onPress={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>Verify & Sign In</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              className="items-center py-2"
              onPress={handleResend}
              disabled={resendTimer > 0 || loading}
            >
              <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: resendTimer > 0 ? colors.gray400 : colors.primary }}>
                🔄 {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Profile step (new customer) ── */}
        {step === 'profile' && (
          <>
            <View className="items-center mb-6">
              <View className="w-12 h-12 rounded-full items-center justify-center mb-3" style={{ backgroundColor: colors.primaryLight }}>
                <Text style={{ fontSize: 24 }}>👋</Text>
              </View>
              <Text className="text-base font-bold" style={{ fontFamily: 'Inter-Bold', color: colors.gray900 }}>Almost there!</Text>
              <Text className="text-sm text-center mt-1" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Tell us your name so we can personalise your experience
              </Text>
            </View>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            <TextInput
              className="rounded-2xl px-4 h-14 text-sm mb-4"
              style={{ fontFamily: 'Inter-Regular', borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
              placeholder="Your full name *"
              placeholderTextColor={colors.gray400}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center mb-3"
              style={{ backgroundColor: newName.trim() && !saving ? colors.primary : colors.gray200 }}
              onPress={handleSaveProfile}
              disabled={saving || !newName.trim()}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>→ Continue to Shop</Text>
              }
            </TouchableOpacity>

          </>
        )}

        {/* Security badge — same as web app */}
        <View className="flex-row items-center justify-center mt-6 px-3 py-1.5 rounded-full self-center"
          style={{ backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.gray200 }}>
          <Text style={{ fontSize: 13, marginRight: 4 }}>🛡️</Text>
          <Text className="text-xs font-medium" style={{ color: colors.primaryDark, fontFamily: 'Inter-Medium' }}>
            Your data is secure. We never share your information.
          </Text>
        </View>

        {/* Terms */}
        <Text className="text-center text-xs mt-3" style={{ fontFamily: 'Inter-Regular', color: colors.gray400 }}>
          By continuing, you agree to our Terms & Privacy Policy
        </Text>
        <Text className="text-center text-xs mt-1" style={{ fontFamily: 'Inter-Regular', color: colors.gray400 }}>
          © {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
