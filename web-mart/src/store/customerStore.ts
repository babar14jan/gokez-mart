import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedAddress {
  id: string;
  label: string; // 'Home', 'Work', or custom
  address: string;
  isDefault: boolean;
}

export interface CustomerState {
  phone: string | null;
  name: string | null;
  addresses: SavedAddress[];
  hasAskedPhone: boolean;

  setPhone: (phone: string) => void;
  setName: (name: string) => void;
  addAddress: (address: Omit<SavedAddress, 'id'>) => void;
  setDefaultAddress: (id: string) => void;
  getDefaultAddress: () => SavedAddress | null;
  setHasAskedPhone: () => void;
  clear: () => void;
}

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      phone: null,
      name: null,
      addresses: [],
      hasAskedPhone: false,

      setPhone: (phone) => set({ phone }),
      setName: (name) => set({ name }),

      addAddress: (addr) => {
        const id = Date.now().toString();
        const addresses = get().addresses;
        // If first address or marked default, set as default
        const isDefault = addr.isDefault || addresses.length === 0;
        const updated = isDefault
          ? addresses.map(a => ({ ...a, isDefault: false }))
          : addresses;
        set({ addresses: [...updated, { ...addr, id, isDefault }] });
      },

      setDefaultAddress: (id) => set({
        addresses: get().addresses.map(a => ({ ...a, isDefault: a.id === id })),
      }),

      getDefaultAddress: () =>
        get().addresses.find(a => a.isDefault) || get().addresses[0] || null,

      setHasAskedPhone: () => set({ hasAskedPhone: true }),

      clear: () => set({ phone: null, name: null, addresses: [], hasAskedPhone: false }),
    }),
    { name: 'mart-customer' }
  )
);
