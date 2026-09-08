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
  deduplicateAddresses: () => void;
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
        const trimmed = addr.address.trim().toLowerCase();
        if (addresses.some(a => a.address.trim().toLowerCase() === trimmed)) {
          if (addr.isDefault) {
            const existing = addresses.find(a => a.address.trim().toLowerCase() === trimmed);
            if (existing) set({ addresses: addresses.map(a => ({ ...a, isDefault: a.id === existing.id })) });
          }
          return;
        }
        const isDefault = addr.isDefault || addresses.length === 0;
        const updated = isDefault ? addresses.map(a => ({ ...a, isDefault: false })) : addresses;
        set({ addresses: [...updated, { ...addr, id, isDefault }] });
      },

      // Deduplicate existing addresses (call once on app load)
      deduplicateAddresses: () => {
        const addresses = get().addresses;
        const seen = new Set<string>();
        const deduped = addresses.filter(a => {
          const key = a.address.trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (deduped.length !== addresses.length) set({ addresses: deduped });
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
