import { create } from 'zustand';

// Zone store selection shared between the header dropdown (Layout) and the
// zone-aware pages (Inventory, Products). Deliberately NOT kept in the URL:
// store ids are internal identifiers and must not be exposed in the address
// bar (previously /inventory?store=<uuid>). The choice persists per device in
// localStorage, like the active-store preference.

const INVENTORY_KEY = 'mart_admin_zone_inventory_store';
const PRODUCTS_KEY = 'mart_admin_zone_products_store';

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
};

export function clearZoneSelection() {
  [INVENTORY_KEY, PRODUCTS_KEY].forEach(k => {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  });
  // Logout does not reload the app, so reset the in-memory state too — the
  // next user on this device must not inherit the previous zone selection.
  useZoneSelectionStore.setState({ inventoryStore: 'all', productsStore: null });
}

interface ZoneSelectionState {
  // 'all' (whole-zone overview) or a mart_stores id — Inventory surface.
  inventoryStore: string;
  // A mart_stores id, or null when nothing has been picked yet (pages resolve
  // their own default: the head store first, then the first manageable store).
  productsStore: string | null;
  setInventoryStore: (id: string) => void;
  setProductsStore: (id: string) => void;
}

export const useZoneSelectionStore = create<ZoneSelectionState>(set => ({
  inventoryStore: read(INVENTORY_KEY) || 'all',
  productsStore: read(PRODUCTS_KEY),
  setInventoryStore: id => {
    write(INVENTORY_KEY, id);
    set({ inventoryStore: id });
  },
  setProductsStore: id => {
    write(PRODUCTS_KEY, id);
    set({ productsStore: id });
  },
}));
