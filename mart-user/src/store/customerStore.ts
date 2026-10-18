import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addressApi } from '../services/api';

export interface SavedAddress {
  id: string;
  label: string; // 'Home', 'Work', or custom
  address: string;
  latitude?: number | null;
  longitude?: number | null;
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
  loadAddresses: () => Promise<boolean>;
  addAddress: (address: Omit<SavedAddress, 'id'>) => Promise<boolean>;
  updateAddress: (id: string, label: string, address: string, latitude?: number | null, longitude?: number | null) => Promise<boolean>;
  removeAddress: (id: string) => Promise<boolean>;
  setDefaultAddress: (id: string) => Promise<boolean>;
  getDefaultAddress: () => SavedAddress | null;
  setHasAskedPhone: () => void;
  clear: () => void;
}

const fromBackend = (a: { id: string; label: string; addressLine: string; latitude: number | null; longitude: number | null; isDefault: boolean }): SavedAddress =>
  ({ id: a.id, label: a.label, address: a.addressLine, latitude: a.latitude, longitude: a.longitude, isDefault: a.isDefault });

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
          return true;
        } catch {
          // Keep whatever is cached so an offline read does not blank the list.
          return false;
        }
      },

      addAddress: async (addr) => {
        // No client-side duplicate check: the cached list can be stale whenever
        // a previous loadAddresses failed (it keeps the old rows), and a match
        // against stale data would report success without ever POSTing — the
        // "saved" address then silently does not exist. The server is already
        // idempotent by address (advisory lock + unique index), so every add
        // goes through and the fresh list is reloaded from the source of truth.
        try {
          await addressApi.add(addr.label, addr.address, addr.isDefault, addr.latitude, addr.longitude);
          await get().loadAddresses();
          return true;
        } catch {
          return false;
        }
      },

      updateAddress: async (id, label, address, latitude, longitude) => {
        try {
          await addressApi.update(id, label, address, latitude, longitude);
          await get().loadAddresses();
          return true;
        } catch {
          return false;
        }
      },

      removeAddress: async (id) => {
        try {
          await addressApi.remove(id);
          await get().loadAddresses();
          return true;
        } catch {
          return false;
        }
      },

      setDefaultAddress: async (id) => {
        set({ addresses: get().addresses.map(a => ({ ...a, isDefault: a.id === id })) });
        try {
          await addressApi.setDefault(id);
          await get().loadAddresses();
          return true;
        } catch {
          // Roll the optimistic flip back so the UI never claims a default the
          // server never accepted.
          await get().loadAddresses();
          return false;
        }
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

