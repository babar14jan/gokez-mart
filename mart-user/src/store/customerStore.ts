import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addressApi } from '../services/api';

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
  addressesLoaded: boolean;
  hasAskedPhone: boolean;

  setPhone: (phone: string) => void;
  setName: (name: string) => void;
  loadAddresses: () => Promise<void>;
  addAddress: (address: Omit<SavedAddress, 'id'>) => Promise<void>;
  updateAddress: (id: string, label: string, address: string) => Promise<void>;
  removeAddress: (id: string) => Promise<void>;
  setDefaultAddress: (id: string) => Promise<void>;
  getDefaultAddress: () => SavedAddress | null;
  setHasAskedPhone: () => void;
  deduplicateAddresses: () => void;
  clear: () => void;
}

const fromBackend = (a: { id: string; label: string; addressLine: string; isDefault: boolean }): SavedAddress =>
  ({ id: a.id, label: a.label, address: a.addressLine, isDefault: a.isDefault });

export const useCustomerStore = create<CustomerState>()(
  persist(
    (set, get) => ({
      phone: null,
      name: null,
      addresses: [],
      addressesLoaded: false,
      hasAskedPhone: false,

      setPhone: (phone) => set({ phone }),
      setName: (name) => set({ name }),

      loadAddresses: async () => {
        try {
          const res = await addressApi.list();
          set({ addresses: (res.data.data || []).map(fromBackend), addressesLoaded: true });
        } catch { /* stay on cached/local addresses if offline */ }
      },

      addAddress: async (addr) => {
        const trimmed = addr.address.trim().toLowerCase();
        if (get().addresses.some(a => a.address.trim().toLowerCase() === trimmed)) return;
        try {
          await addressApi.add(addr.label, addr.address, addr.isDefault);
          await get().loadAddresses();
        } catch { /* silent — best effort */ }
      },

      updateAddress: async (id, label, address) => {
        try {
          await addressApi.update(id, label, address);
          await get().loadAddresses();
        } catch { /* silent */ }
      },

      removeAddress: async (id) => {
        try {
          await addressApi.remove(id);
          await get().loadAddresses();
        } catch { /* silent */ }
      },

      // Deduplicate existing addresses (legacy — kept as a no-op safeguard for old local caches)
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

      setDefaultAddress: async (id) => {
        set({ addresses: get().addresses.map(a => ({ ...a, isDefault: a.id === id })) });
        try {
          await addressApi.setDefault(id);
          await get().loadAddresses();
        } catch { /* silent — optimistic update already applied */ }
      },

      getDefaultAddress: () =>
        get().addresses.find(a => a.isDefault) || get().addresses[0] || null,

      setHasAskedPhone: () => set({ hasAskedPhone: true }),

      clear: () => set({ phone: null, name: null, addresses: [], addressesLoaded: false, hasAskedPhone: false }),
    }),
    {
      name: 'mart-customer',
      partialize: (state) => ({ phone: state.phone, name: state.name, hasAskedPhone: state.hasAskedPhone }),
    }
  )
);

