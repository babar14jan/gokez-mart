import { create } from 'zustand';
import type { SavedAddress } from './customerStore';
import { readGuestAddress, writeGuestAddress, clearGuestAddress, type GuestAddressCoordinates } from '../utils/guestAddress';

/**
 * The guest's single delivery address, held in one reactive place.
 *
 * The guest address used to live in two independent copies — the raw
 * localStorage record (read ad hoc by each page) and a `useCustomerStore`
 * seed that the account page wrote on mount. Checkout then preferred whichever
 * copy it read first, so an edit looked saved while the visible address stayed
 * stale until the next launch (the in-memory seed was dropped on reload and the
 * localStorage copy won). This store is the one source of truth: every consumer
 * subscribes to it and every write goes through it, so a save reflects instantly
 * on the checkout footer, the account page and anywhere else at once, while
 * still being persisted to localStorage for the next launch.
 */
interface GuestAddressState {
  address: SavedAddress | null;
  setAddress: (label: string, address: string, coordinates: GuestAddressCoordinates | null) => void;
  clearAddress: () => void;
}

export const useGuestAddressStore = create<GuestAddressState>((set) => ({
  address: readGuestAddress(),
  setAddress: (label, address, coordinates) => {
    writeGuestAddress(label, address, coordinates);
    set({ address: readGuestAddress() });
  },
  clearAddress: () => {
    clearGuestAddress();
    set({ address: null });
  },
}));
