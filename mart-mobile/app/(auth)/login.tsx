import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi } from '@/services/api';
import { syncGuestMarketingConsent } from '@/services/push';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { useThemeColors } from '@/constants/theme';
import { useLoginFlowStore } from '@/store/loginFlowStore';
import { useFunnelStore } from '@/store/funnelStore';
import { clearTokens, getGuestMarketingConsent, getTokens } from '@/store/guestTrackingStore';
import { useCartStore } from '@/store/cartStore';
import {
  clearStoredReferralCode, normalizeReferralCode, parseReferralCode, readStoredReferralCode, writeStoredReferralCode,
} from '@/utils/referral';
import { track, trackOnce } from '@/utils/track';

type Step = 'welcome' | 'phone' | 'otp' | 'profile';

const RESEND_MS = 30_000;

function cooldownSeconds(sentAt: number | null): number {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_MS - Date.now()) / 1000));
}

function isValidName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 80 && /\p{L}/u.test(name);
}

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
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const isDark = useThemeStore(s => s.isDark);
  const { login, updateProfile } = useAuthStore();
  const params = useLocalSearchParams();
  const cartItems = useCartStore(s => s.items);

  const flowRef = useRef(useLoginFlowStore.getState());
  const restored = flowRef.current;
  const restoredOtp = restored.step === 'otp' && !!restored.phone && !!restored.otpSentAt;
  const initialCode = normalizeReferralCode(restored.referralCode || readStoredReferralCode() || String(params.ref ?? ''));

  const [step, setStep] = useState<Step>(restoredOtp ? 'otp' : 'phone');
  const [phone, setPhone] = useState(restoredOtp ? restored.phone ?? '' : '');
  const [otp, setOtp] = useState('');
  const [referralCode, setReferralCode] = useState(initialCode);
  const [referralOpen, setReferralOpen] = useState(Boolean(initialCode));
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(() => cooldownSeconds(restored.otpSentAt));
  const otpRefs = useRef<Array<any>>([]);

  const pendingCheckout = String(params.pendingCheckout ?? '') === '1'
    || String(params.from ?? '').toLowerCase() === 'checkout'
    || cartItems.some(item => !item.unavailable);

  const finish = () => {
    if (pendingCheckout) {
      router.push('/checkout');
      return;
    }
    if (typeof router.canGoBack === 'function' && router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  useEffect(() => {
    try { trackOnce('login_viewed'); } catch {}
    const applyUrl = (url: string | null | undefined) => {
      const code = parseReferralCode(url);
      if (!code) return;
      setReferralCode(previous => previous || code);
      setReferralOpen(true);
      useLoginFlowStore.getState().setReferralCode(code);
      writeStoredReferralCode(code);
    };
    const fromParams = normalizeReferralCode(String(params.ref ?? ''));
    if (fromParams) applyUrl(fromParams);
    void Linking.getInitialURL().then(applyUrl).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => applyUrl(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (step !== 'otp') return;
    try { track('otp_viewed'); } catch {}
    const update = () => setResendTimer(cooldownSeconds(useLoginFlowStore.getState().otpSentAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step]);

  const handleSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit number'); return; }
    setLoading(true); setError('');
    try {
      await authApi.sendOtp(cleaned);
      try { track('otp_requested', { otpChannel: 'phone_call' }); } catch {}
      useLoginFlowStore.getState().beginOtp(cleaned);
      setPhone(cleaned);
      setStep('otp');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (loading) return;
    if (otp.length !== 6) { setError('Enter the 6-digit OTP'); return; }
    setLoading(true); setError('');
    try {
      const codeForSignup = normalizeReferralCode(referralCode) || undefined;
      const res = await authApi.verifyOtp(phone.replace(/\D/g, ''), otp, {
        referralCode: codeForSignup,
        funnelSessionId: useFunnelStore.getState().getSessionId(),
        trackingTokens: getTokens(),
      });
      try { track('login_verified'); } catch {}
      clearStoredReferralCode();
      if (getGuestMarketingConsent()) syncGuestMarketingConsent(true);
      clearTokens();
      useLoginFlowStore.getState().clear();
      const { token, customer } = res.data.data;
      await login(token, customer);
      if (!customer.name) setStep('profile');
      else finish();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid OTP. Try again.');
      setOtp('');
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || loading) return;
    setLoading(true); setError(''); setOtp('');
    try {
      await authApi.sendOtp(phone.replace(/\D/g, ''));
      useLoginFlowStore.getState().markOtpSent();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to resend OTP.');
    } finally { setLoading(false); }
  };

  const handleOtpChangeText = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return;
    const start = digits.length > 1 ? 0 : index;
    const chars = otp.split('');
    while (chars.length < 6) chars.push('');
    for (let i = 0; i < digits.length && start + i < 6; i++) {
      chars[start + i] = digits[i];
    }
    setOtp(chars.join('').slice(0, 6));
    const nextIndex = Math.min(start + digits.length, 5);
    otpRefs.current[nextIndex]?.focus?.();
  };

  const handleOtpKeyPress = (index: number, e: any) => {
    const key = e?.nativeEvent?.key;
    if (key !== 'Backspace') return;
    if (otp[index] ?? '') return;
    const prevIndex = Math.max(0, index - 1);
    const chars = otp.padEnd(6, '').split('');
    chars[index] = '';
    setOtp(chars.join('').slice(0, 6));
    otpRefs.current[prevIndex]?.focus?.();
  };

  const handleSaveProfile = async () => {
    if (!isValidName(newName)) { setError('Enter a valid name using at least 2 characters.'); return; }
    const normalized = newName.trim().replace(/\s+/g, ' ');
    setSaving(true); setError('');
    try {
      await authApi.updateProfile({ name: normalized });
      updateProfile({ name: normalized });
      finish();
    } catch {
      setError('Failed to save. Please try again.');
    } finally { setSaving(false); }
  };

  const handleClose = () => {
    if (step === 'phone' || step === 'otp') {
      try { track('login_abandoned', { step, reason: 'dismissed' }); } catch {}
      useLoginFlowStore.getState().clearPending();
    }
    if (step === 'welcome') router.back();
    else setStep('welcome');
  };

  const handleReferralChange = (value: string) => {
    const next = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    setReferralCode(next);
    useLoginFlowStore.getState().setReferralCode(next || null);
    if (next) writeStoredReferralCode(next);
    else clearStoredReferralCode();
  };

  const clearReferral = () => {
    setReferralCode('');
    setReferralOpen(false);
    useLoginFlowStore.getState().setReferralCode(null);
    clearStoredReferralCode();
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
        contentContainerStyle={{
          flexGrow: 1,
          width: '100%',
          maxWidth: 480,
          alignSelf: 'center',
          paddingHorizontal: 24,
          paddingTop: Math.max(60, insets.top + 16),
          paddingBottom: Math.max(40, insets.bottom + 16),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step !== 'profile' && (
          <TouchableOpacity
            className="absolute rounded-xl items-center justify-center"
            style={{
              top: insets.top + 12,
              right: 16,
              width: 44,
              height: 44,
              backgroundColor: colors.gray100,
            }}
            onPress={handleClose}
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
              Log in or sign up
            </Text>
            <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, marginBottom: 24 }}>
              Enter your mobile number to continue
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
                placeholder="Enter mobile number"
                placeholderTextColor={colors.gray400}
                keyboardType="phone-pad"
                maxLength={10}
                value={phone}
                onChangeText={t => { setPhone(t.replace(/\D/g, '')); setError(''); }}
                autoFocus
              />
            </View>

            {referralOpen && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Inter-Medium', color: colors.gray700 }}>
                    Referral code <Text style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>(optional)</Text>
                  </Text>
                  <TouchableOpacity onPress={clearReferral}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors.gray500 }}>Remove</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  className="rounded-xl px-3 h-11 text-xs"
                  style={{ fontFamily: 'Inter-SemiBold', letterSpacing: 2, textTransform: 'uppercase', borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
                  placeholder="Enter Referral code"
                  placeholderTextColor={colors.gray400}
                  value={referralCode}
                  maxLength={6}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={handleReferralChange}
                />
              </View>
            )}

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center"
              style={{ backgroundColor: phone.length === 10 && !loading ? colors.primary : colors.gray200 }}
              onPress={handleSendOtp}
              disabled={loading || phone.length !== 10}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>Continue with OTP</Text>
              }
            </TouchableOpacity>

            <Text style={{ fontSize: 12, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center', lineHeight: 18, marginTop: 12 }}>
              By continuing, you agree to our{' '}
              <Text style={{ color: colors.primary }} onPress={() => router.push('/terms')}>Terms</Text>
              {' '}and{' '}
              <Text style={{ color: colors.primary }} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.
            </Text>

            {!referralOpen && (
              <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => setReferralOpen(true)}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter-SemiBold', color: colors.primary }}>Have Referral Code?</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {step === 'otp' && (
          <>
            <Text style={{ fontSize: 24, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 6 }}>
              OTP Verification
            </Text>
            <View className="rounded-xl px-3 py-2.5 mb-4" style={{ backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.gray200 }}>
              <Text className="text-[10px] leading-4" style={{ fontFamily: 'Inter-Regular', color: colors.gray500 }}>
                Do not share this code with anyone.
              </Text>
            </View>

            {error !== '' && (
              <View className="rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: colors.redLight, borderWidth: 1, borderColor: colors.gray200 }}>
                <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: colors.red500 }}>{error}</Text>
              </View>
            )}

            <View className="flex-row items-center justify-center mb-4" style={{ gap: 8, width: '100%', maxWidth: 360, alignSelf: 'center' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <TextInput
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  className="rounded-xl h-14 flex-1 text-center text-xl font-bold"
                  style={{ minWidth: 0, maxWidth: 52, fontFamily: 'Inter-Bold', borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.gray50, color: colors.gray900 }}
                  placeholder={i === 0 ? '------' : String(i + 1)}
                  placeholderTextColor={colors.gray400}
                  keyboardType="number-pad"
                  autoComplete={i === 0 ? 'sms-otp' : 'off'}
                  textContentType={i === 0 ? 'oneTimeCode' : 'none'}
                  maxLength={i === 0 ? 6 : 1}
                  value={otp[i] ?? ''}
                  onChangeText={t => handleOtpChangeText(i, t)}
                  onKeyPress={e => handleOtpKeyPress(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </View>

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center mb-4"
              style={{ backgroundColor: otp.length === 6 && !loading ? colors.primary : colors.gray200 }}
              onPress={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>Continue</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              className="items-center py-2"
              onPress={handleResend}
              disabled={resendTimer > 0 || loading}
            >
              <Text className="text-sm" style={{ fontFamily: 'Inter-Regular', color: resendTimer > 0 ? colors.gray400 : colors.primary }}>
                Didn&apos;t receive OTP? {resendTimer > 0 ? `(Resend in ${resendTimer}s)` : 'Resend'}
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
              <Text style={{ fontSize: 20, fontFamily: 'Inter-Bold', color: colors.gray900, marginBottom: 4 }}>Almost there.</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: colors.gray500, textAlign: 'center' }}>
                Tell us your name so we know who to hand the order to
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
              autoComplete="name"
              autoFocus
            />

            <TouchableOpacity
              className="h-14 rounded-2xl items-center justify-center"
              style={{ backgroundColor: isValidName(newName) && !saving ? colors.primary : colors.gray200 }}
              onPress={handleSaveProfile}
              disabled={saving || !isValidName(newName)}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white text-base font-bold" style={{ fontFamily: 'Inter-Bold' }}>{pendingCheckout ? 'Continue to Checkout' : 'Continue'}</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
