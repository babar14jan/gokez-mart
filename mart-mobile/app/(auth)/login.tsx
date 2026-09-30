import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';
import { APP_CONFIG } from '@/constants/config';

type Step = 'welcome' | 'phone' | 'otp' | 'profile';

function HeroVisual() {
  const colors = useThemeColors();
  return (
    <View style={{ alignItems: 'center', marginBottom: 24 }}>
      <View style={{
        width: 180, height: 160, borderRadius: 24,
        backgroundColor: colors.primaryLight,
        alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <View style={{ position: 'absolute', top: -20, left: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary + '15' }} />
        <View style={{ position: 'absolute', bottom: -30, right: -30, width: 100, height: 100, borderRadius: 50, backgroundColor: colors.primary + '10' }} />
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 }}>
          <Ionicons name="basket-outline" size={36} color={colors.primary} />
        </View>
        <View style={{ position: 'absolute', top: 28, right: 28, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.yellow + '30', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="leaf-outline" size={16} color={colors.primaryDark} />
        </View>
        <View style={{ position: 'absolute', bottom: 32, left: 24, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.amber + '25', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="bicycle-outline" size={14} color={colors.amber} />
        </View>
      </View>
    </View>
  );
}

function BenefitRow({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
        <Ionicons name={icon as any} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: 'Inter-SemiBold', color: colors.gray900 }}>{title}</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, marginTop: 1 }}>{subtitle}</Text>
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const colors = useThemeColors();
  const isDark = useThemeStore(s => s.isDark);
  const { login, updateProfile } = useAuthStore();

  const [step, setStep] = useState<Step>('welcome');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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

  const handleGuest = () => {
    router.back();
  };

  const version = '1.0.0';

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step !== 'profile' && (
          <TouchableOpacity
            className="absolute top-12 right-6 w-9 h-9 rounded-xl items-center justify-center"
            style={{ backgroundColor: colors.gray100 }}
            onPress={() => step === 'welcome' ? router.back() : setStep('welcome')}
          >
            <Ionicons name="close" size={18} color={colors.gray500} />
          </TouchableOpacity>
        )}

        {step === 'welcome' && (
          <>
            <View className="items-center mb-6">
              <Image
                source={isDark ? require('../../assets/brand_dark.png') : require('../../assets/brand_light.png')}
                style={{ width: 160, height: 48 }}
                contentFit="contain"
              />
            </View>

            <HeroVisual />

            <Text style={{ fontSize: 26, fontFamily: 'Inter-Bold', color: colors.gray900, textAlign: 'center', marginBottom: 8 }}>
              Welcome to Gokez Mart
            </Text>
            <Text style={{ fontSize: 15, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', marginBottom: 24, lineHeight: 22 }}>
              Fresh essentials, delivered to your doorstep.
            </Text>

            <View style={{ backgroundColor: colors.gray50, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 24, borderWidth: 1, borderColor: colors.gray100 }}>
              <BenefitRow icon="receipt-outline" title="Track your orders" subtitle="Know where your order is" />
              <View style={{ height: 1, backgroundColor: colors.gray100, marginLeft: 54 }} />
              <BenefitRow icon="location-outline" title="Checkout faster" subtitle="Your delivery details are ready" />
              <View style={{ height: 1, backgroundColor: colors.gray100, marginLeft: 54 }} />
              <BenefitRow icon="gift-outline" title="Get exclusive offers" subtitle="Don't miss deals made for you" />
            </View>

            <TouchableOpacity
              style={{ height: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 }}
              onPress={() => setStep('phone')}
            >
              <Ionicons name="call-outline" size={20} color="#fff" />
              <Text style={{ fontSize: 16, fontFamily: 'Inter-SemiBold', color: '#fff' }}>Continue with Phone</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}
              onPress={handleGuest}
            >
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Medium', color: colors.primary }}>
                Continue as Guest →
              </Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray400, textAlign: 'center', lineHeight: 18, marginBottom: 24 }}>
              By continuing, you agree to our{' '}
              <Text style={{ color: colors.primary, fontFamily: 'Inter-Medium' }} onPress={() => router.push('/terms')}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={{ color: colors.primary, fontFamily: 'Inter-Medium' }} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.
            </Text>

            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>v{version}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
                <Text onPress={() => router.push('/privacy')} style={{ color: colors.gray500 }}>Privacy Policy</Text>
                {' · '}
                <Text onPress={() => router.push('/terms')} style={{ color: colors.gray500 }}>Terms of Service</Text>
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400, marginTop: 4 }}>
                A product of Gokez Technologies Pvt. Ltd.
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter-Regular', color: colors.gray400 }}>
                © 2026 Gokez Technologies Pvt. Ltd.
              </Text>
            </View>
          </>
        )}

        {step === 'phone' && (
          <>
            <Text style={{ fontSize: 24, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>
              Enter your number
            </Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 24 }}>
              We'll send you a verification code
            </Text>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            <View className="flex-row items-center rounded-2xl px-4 h-14 mb-4"
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
              className="h-14 rounded-2xl items-center justify-center"
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

        {step === 'otp' && (
          <>
            <Text style={{ fontSize: 24, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>
              Enter OTP
            </Text>
            <View className="flex-row items-center mb-6">
              <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Sent to <Text className="font-semibold" style={{ fontFamily: 'Inter-SemiBold', color: colors.gray700 }}>+91 {phone}</Text>
              </Text>
              <TouchableOpacity onPress={() => { setStep('phone'); setOtp(''); setError(''); }} className="ml-2">
                <Text className="text-xs font-semibold" style={{ color: colors.primary, fontFamily: 'Inter-SemiBold' }}>Change</Text>
              </TouchableOpacity>
            </View>

            <View className="rounded-xl px-3 py-2.5 mb-4" style={{ backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.gray200 }}>
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="call-outline" size={14} color={colors.primary} />
                <Text className="flex-1 text-xs leading-5" style={{ fontFamily: 'Inter-SemiBold', color: colors.primaryDark }}>
                  We'll send you a 6-digit code via call
                </Text>
              </View>
              <Text className="mt-1 text-[10px] leading-4" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Do not share this code with anyone.
              </Text>
            </View>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            <TextInput
              className="rounded-2xl h-14 text-center text-2xl font-bold mb-4"
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
              className="h-14 rounded-2xl items-center justify-center mb-4"
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
                {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'profile' && (
          <>
            <View className="items-center mb-8">
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <Ionicons name="person-outline" size={28} color={colors.primary} />
              </View>
              <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 4 }}>Almost there!</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center' }}>
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
              placeholder="Your full name"
              placeholderTextColor={colors.gray400}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center"
              style={{ backgroundColor: newName.trim() && !saving ? colors.primary : colors.gray200 }}
              onPress={handleSaveProfile}
              disabled={saving || !newName.trim()}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>Continue to Shop</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
