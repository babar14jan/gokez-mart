import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 30 * 1000;

export interface ActiveOtpFlow {
  phone: string;
  expiresAt: number;
  resendAvailableAt: number;
  pendingCheckout: boolean;
  pendingCouponApply: boolean;
  pendingCampaignId: string | null;
}

interface LoginFlowState {
  phone: string | null;
  expiresAt: number | null;
  resendAvailableAt: number | null;
  pendingCheckout: boolean;
  pendingCouponApply: boolean;
  pendingCampaignId: string | null;
  /** Where to send the shopper once OTP completes, e.g. '/orders'. */
  postLoginPath: string | null;
  beginOtp: (phone: string, pendingCheckout: boolean, pendingCouponApply?: boolean) => void;
  markOtpResent: () => void;
  setPendingCheckout: (pendingCheckout: boolean) => void;
  setPendingCouponApply: (pendingCouponApply: boolean, campaignId?: string | null) => void;
  setPostLoginPath: (path: string | null) => void;
  clear: () => void;
  getActiveOtpFlow: () => ActiveOtpFlow | null;
}

const emptyFlow = {
  phone: null,
  expiresAt: null,
  resendAvailableAt: null,
  pendingCheckout: false,
  pendingCouponApply: false,
  pendingCampaignId: null,
  postLoginPath: null,
};

export const useLoginFlowStore = create<LoginFlowState>()(
  persist(
    (set, get) => ({
      ...emptyFlow,
      beginOtp: (phone, pendingCheckout, pendingCouponApply) => {
        const now = Date.now();
        set({
          phone,
          pendingCheckout,
          // Only an explicit argument may change the claim intent. App sets it
          // before the modal opens; passing nothing here must not wipe it, or
          // the welcome coupon can never auto-apply after OTP.
          pendingCouponApply: pendingCouponApply ?? get().pendingCouponApply,
          expiresAt: now + OTP_EXPIRY_MS,
          resendAvailableAt: now + RESEND_DELAY_MS,
        });
      },
      markOtpResent: () => {
        const now = Date.now();
        set({ expiresAt: now + OTP_EXPIRY_MS, resendAvailableAt: now + RESEND_DELAY_MS });
      },
      setPendingCheckout: (pendingCheckout) => set({ pendingCheckout }),
      setPendingCouponApply: (pendingCouponApply, campaignId) => set({
        pendingCouponApply,
        pendingCampaignId: campaignId ?? null,
      }),
      setPostLoginPath: (path) => set({ postLoginPath: path }),
      // Preserves postLoginPath: the OTP handlers call clear() before handing
      // control back to the view that still needs to read the redirect target.
      clear: () => set({ ...emptyFlow, postLoginPath: get().postLoginPath }),
      getActiveOtpFlow: () => {
        const { phone, expiresAt, resendAvailableAt, pendingCheckout, pendingCouponApply, pendingCampaignId } = get();
        if (!phone || !expiresAt || !resendAvailableAt || expiresAt <= Date.now()) {
          if (phone || expiresAt || resendAvailableAt) set({ ...emptyFlow, postLoginPath: get().postLoginPath });
          return null;
        }
        return { phone, expiresAt, resendAvailableAt, pendingCheckout, pendingCouponApply, pendingCampaignId };
      },
    }),
    {
      name: 'mart-login-flow',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ phone, expiresAt, resendAvailableAt, pendingCheckout, pendingCouponApply, pendingCampaignId, postLoginPath }) => ({
        phone,
        expiresAt,
        resendAvailableAt,
        pendingCheckout,
        pendingCouponApply,
        pendingCampaignId,
        postLoginPath,
      }),
    }
  )
);