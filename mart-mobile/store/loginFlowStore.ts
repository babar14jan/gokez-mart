import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeReferralCode } from '@/utils/referral';

export type LoginStep = 'idle' | 'phone' | 'otp' | 'verified';

export interface LoginFlowState {
  referralCode: string | null;
  step: LoginStep;
  phone: string | null;
  otpSentAt: number | null;
  setReferralCode: (code: string | null | undefined) => void;
  setStep: (step: LoginStep) => void;
  setPhone: (phone: string | null) => void;
  setOtpSentAt: (at: number | null) => void;
  beginOtp: (phone: string) => void;
  markOtpSent: () => void;
  clearPending: () => void;
  clear: () => void;
}

const initialState = {
  referralCode: null as string | null,
  step: 'idle' as LoginStep,
  phone: null as string | null,
  otpSentAt: null as number | null,
};

export const useLoginFlowStore = create<LoginFlowState>()(
  persist(
    (set) => ({
      ...initialState,
      setReferralCode: (code: string | null | undefined) => set({ referralCode: normalizeReferralCode(code) || null }),
      setStep: (step: LoginStep) => set({ step }),
      setPhone: (phone: string | null) => set({ phone: phone || null }),
      setOtpSentAt: (otpSentAt: number | null) => set({ otpSentAt }),
      beginOtp: (phone: string) => set({ phone: phone || null, step: 'otp', otpSentAt: Date.now() }),
      markOtpSent: () => set({ step: 'otp', otpSentAt: Date.now() }),
      clearPending: () => set({ step: 'idle', phone: null, otpSentAt: null }),
      clear: () => set({ ...initialState }),
    }),
    { name: 'mart-login-flow', storage: createJSONStorage(() => AsyncStorage) }
  )
);
