import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCustomerStore } from './customerStore';

interface CustomerAuthState {
  token: string | null;
  customerId: string | null;
  phone: string | null;
  name: string | null;
  address: string | null;
  address2: string | null;
  photoUrl: string | null;
  isLoggedIn: boolean;
  login: (token: string, customer: { id: string; phone: string; name?: string | null; address?: string | null; address2?: string | null; photoUrl?: string | null }) => void;
  updateProfile: (data: { name?: string; address?: string; address2?: string; photoUrl?: string }) => void;
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

      login: (token, customer) => {
        // Reset any previously-loaded address book — a different customer is now signed in.
        useCustomerStore.setState({ addresses: [], addressesLoaded: false });
        set({
          token,
          customerId: customer.id,
          phone: customer.phone,
          name: customer.name || null,
          address: customer.address || null,
          address2: customer.address2 || null,
          photoUrl: customer.photoUrl || null,
          isLoggedIn: true,
        });
      },

      updateProfile: (data) => set(s => ({
        name:     data.name     !== undefined ? data.name     : s.name,
        address:  data.address  !== undefined ? data.address  : s.address,
        address2: data.address2 !== undefined ? data.address2 : s.address2,
        photoUrl: data.photoUrl !== undefined ? data.photoUrl : s.photoUrl,
      })),

      logout: () => {
        useCustomerStore.setState({ addresses: [], addressesLoaded: false });
        set({
          token: null, customerId: null, phone: null,
          name: null, address: null, photoUrl: null, isLoggedIn: false,
        });
      },
    }),
    { name: 'mart-customer-auth' }
  )
);
