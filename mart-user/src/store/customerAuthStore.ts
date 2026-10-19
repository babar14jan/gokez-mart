import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCustomerStore } from './customerStore';
import { clearHttpCache } from '../services/httpCache';

interface CustomerAuthState {
  token: string | null;
  customerId: string | null;
  phone: string | null;
  name: string | null;
  address: string | null;
  address2: string | null;
  photoUrl: string | null;
  isLoggedIn: boolean;
  isPhoneVerified: boolean;
  login: (token: string, customer: { id: string; phone: string; name?: string | null; address?: string | null; address2?: string | null; photoUrl?: string | null }) => void;
  updateProfile: (data: { name?: string; address?: string; address2?: string; photoUrl?: string }) => void;
  setGuestProfile: (data: { name?: string | null; phone?: string | null; address?: string | null }) => void;
  logout: () => void;
}

export const useCustomerAuthStore = create<CustomerAuthState>()(
  persist(
    (set) => ({
      token: null,
      customerId: null,
      phone: null,
      name: null,
      address: null,
      address2: null,
      photoUrl: null,
      isLoggedIn: false,
      isPhoneVerified: false,

      login: (token, customer) => {
        // Reset any previously-loaded address book — a different customer is now signed in.
        useCustomerStore.setState({ addresses: [], addressesLoaded: false });
        // The HTTP cache is auth-blind (keys are method+url+params only), so the
        // previous session's authenticated responses must not outlive it.
        clearHttpCache();
        set({
          token,
          customerId: customer.id,
          phone: customer.phone,
          name: customer.name || null,
          address: customer.address || null,
          address2: customer.address2 || null,
          photoUrl: customer.photoUrl || null,
          isLoggedIn: true,
          isPhoneVerified: true,
        });
      },

      updateProfile: (data) => set(s => ({
        name:     data.name     !== undefined ? data.name     : s.name,
        address:  data.address  !== undefined ? data.address  : s.address,
        address2: data.address2 !== undefined ? data.address2 : s.address2,
        photoUrl: data.photoUrl !== undefined ? data.photoUrl : s.photoUrl,
      })),

      setGuestProfile: (data) => set(s => ({
        name:    data.name    !== undefined ? data.name    : s.name,
        phone:   data.phone   !== undefined ? data.phone   : s.phone,
        address: data.address !== undefined ? data.address : s.address,
        isLoggedIn: false,
        isPhoneVerified: false,
      })),

      logout: () => {
        useCustomerStore.setState({ addresses: [], addressesLoaded: false });
        // Same as login: nothing authenticated may stay cached after sign-out.
        clearHttpCache();
        set({
          token: null, customerId: null, phone: null,
          name: null, address: null, photoUrl: null, isLoggedIn: false,
          isPhoneVerified: false,
        });
      },
    }),
    { name: 'mart-customer-auth' }
  )
);
