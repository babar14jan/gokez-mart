import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CustomerAuthState {
  token: string | null;
  customerId: string | null;
  phone: string | null;
  name: string | null;
  address: string | null;
  address2: string | null;
  isLoggedIn: boolean;
  login: (token: string, customer: { id: string; phone: string; name?: string | null; address?: string | null; address2?: string | null }) => void;
  updateProfile: (data: { name?: string; address?: string; address2?: string }) => void;
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
      isLoggedIn: false,

      login: (token, customer) => {
        set({
          token,
          customerId: customer.id,
          phone: customer.phone,
          name: customer.name || null,
          address: customer.address || null,
          address2: customer.address2 || null,
          isLoggedIn: true,
        });
      },

      updateProfile: (data) => set(s => ({
        name: data.name !== undefined ? data.name : s.name,
        address: data.address !== undefined ? data.address : s.address,
        address2: data.address2 !== undefined ? data.address2 : s.address2,
      })),

      logout: () => set({
        token: null, customerId: null, phone: null,
        name: null, address: null, isLoggedIn: false,
      }),
    }),
    { name: 'mart-customer-auth' }
  )
);
