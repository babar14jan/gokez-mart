import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 30 * 1000;

export interface ActiveOtpFlow {
  phone: string;
  expiresAt: number;
  resendAvailableAt: number;
  pendingCheckout: boolean;
}

interface LoginFlowState {
  phone: string | null;
  expiresAt: number | null;
  resendAvailableAt: number | null;
  pendingCheckout: boolean;
  beginOtp: (phone: string, pendingCheckout: boolean) => void;
  markOtpResent: () => void;
  setPendingCheckout: (pendingCheckout: boolean) => void;
  clear: () => void;
  getActiveOtpFlow: () => ActiveOtpFlow | null;
}

const emptyFlow = {
  phone: null,
  expiresAt: null,
  resendAvailableAt: null,
  pendingCheckout: false,
};

export const useLoginFlowStore = create<LoginFlowState>()(
  persist(
    (set, get) => ({
      ...emptyFlow,
      beginOtp: (phone, pendingCheckout) => {
        const now = Date.now();
        set({
          phone,
          pendingCheckout,
          expiresAt: now + OTP_EXPIRY_MS,
          resendAvailableAt: now + RESEND_DELAY_MS,
        });
      },
      markOtpResent: () => {
        const now = Date.now();
        set({ expiresAt: now + OTP_EXPIRY_MS, resendAvailableAt: now + RESEND_DELAY_MS });
      },
      setPendingCheckout: (pendingCheckout) => set({ pendingCheckout }),
      clear: () => set(emptyFlow),
      getActiveOtpFlow: () => {
        const { phone, expiresAt, resendAvailableAt, pendingCheckout } = get();
        if (!phone || !expiresAt || !resendAvailableAt || expiresAt <= Date.now()) {
          if (phone || expiresAt || resendAvailableAt) set(emptyFlow);
          return null;
        }
        return { phone, expiresAt, resendAvailableAt, pendingCheckout };
      },
    }),
    {
      name: 'mart-login-flow',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ phone, expiresAt, resendAvailableAt, pendingCheckout }) => ({
        phone,
        expiresAt,
        resendAvailableAt,
        pendingCheckout,
      }),
    }
  )
);