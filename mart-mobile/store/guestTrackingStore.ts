import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_TOKENS = 10;

export interface GuestTrackingState {
  tokens: string[];
  guestMarketingConsent: boolean;
  saveToken: (token: string) => void;
  clearTokens: () => void;
  setGuestMarketingConsent: (granted: boolean) => void;
}

export const useGuestTrackingStore = create<GuestTrackingState>()(
  persist(
    set => ({
      tokens: [],
      guestMarketingConsent: false,
      saveToken: (token: string) => {
        const clean = String(token ?? '').trim();
        if (!clean) return;
        set(state => state.tokens.includes(clean) ? state : { tokens: [...state.tokens, clean].slice(-MAX_TOKENS) });
      },
      clearTokens: () => set({ tokens: [] }),
      setGuestMarketingConsent: (granted: boolean) => set({ guestMarketingConsent: granted }),
    }),
    { name: 'mart-guest-tracking', storage: createJSONStorage(() => AsyncStorage) }
  )
);

export function saveToken(token: string): void {
  useGuestTrackingStore.getState().saveToken(token);
}

export function clearTokens(): void {
  useGuestTrackingStore.getState().clearTokens();
}

export function getTokens(): string[] {
  return useGuestTrackingStore.getState().tokens;
}

export function getGuestMarketingConsent(): boolean {
  return useGuestTrackingStore.getState().guestMarketingConsent;
}

export function setGuestMarketingConsent(granted: boolean): void {
  useGuestTrackingStore.getState().setGuestMarketingConsent(granted);
}
