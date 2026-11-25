import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { useGuestTrackingStore } from './guestTrackingStore';
import { useLoginFlowStore } from './loginFlowStore';
import { useFunnelStore } from './funnelStore';
import { clearStoredReferralCode } from '@/utils/referral';
import { clearNativePushToken } from '@/services/push';

export interface Customer {
  id: string; phone: string; name: string | null;
  address: string | null; address2: string | null; photoUrl: string | null;
  orderCount?: number; totalSpent?: number;
}

interface AuthState {
  token: string | null;
  customer: Customer | null;
  isLoggedIn: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  login: (token: string, customer: Customer) => Promise<void>;
  updateProfile: (data: Partial<Pick<Customer, 'name' | 'address' | 'address2' | 'photoUrl'>>) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token:     null,
  customer:  null,
  isLoggedIn: false,
  hydrated:  false,

  hydrate: async () => {
    try {
      const token    = await SecureStore.getItemAsync('mart-auth-token');
      const raw      = await SecureStore.getItemAsync('mart-auth-customer');
      const customer = raw ? (JSON.parse(raw) as Customer) : null;
      set({ token, customer, isLoggedIn: !!token, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  login: async (token, customer) => {
    await SecureStore.setItemAsync('mart-auth-token', token);
    await SecureStore.setItemAsync('mart-auth-customer', JSON.stringify(customer));
    set({ token, customer, isLoggedIn: true });
  },

  updateProfile: (data) => {
    const current = get().customer;
    if (!current) return;
    const updated = { ...current, ...data };
    set({ customer: updated });
    void SecureStore.setItemAsync('mart-auth-customer', JSON.stringify(updated)).catch(() => undefined);
  },

  logout: async () => {
    await Promise.allSettled([
      SecureStore.deleteItemAsync('mart-auth-token'),
      SecureStore.deleteItemAsync('mart-auth-customer'),
    ]);
    try {
      useGuestTrackingStore.getState().clearTokens();
      useLoginFlowStore.getState().clear();
      useFunnelStore.getState().resetSession();
      clearStoredReferralCode();
    } catch {}
    void clearNativePushToken().catch(() => undefined);
    set({ token: null, customer: null, isLoggedIn: false });
  },
}));
