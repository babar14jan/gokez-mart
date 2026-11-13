import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../services/api';
import { syncFunnelCart, track } from '../utils/track';

export interface CartItem {
  productId: string;
  sourceStoreId?: string;
  categoryId?: string;
  productName: string;
  unit: string;
  price: number;
  /** List price the item is discounting from. Only set when it was added at a
   *  discounted price; equal to `price` (or absent on old persisted carts)
   *  otherwise. Lets the cart show a real "you saved" total. */
  mrp?: number;
  quantity: number;
  photoUrl: string | null;
  smallUrl?: string | null;
  thumbnailUrl?: string | null;
}

export type AddItemResult = 'added' | 'different_unit';

interface CartState {
  items: CartItem[];
  appliedCampaign: any | null;
  campaignDiscount: number;
  addItem: (product: Product, unit?: string, price?: number, listPrice?: number) => AddItemResult;
  removeItem: (productId: string, unit: string) => void;
  updateQty: (productId: string, unit: string, qty: number) => void;
  clearCart: () => void;
  setAppliedCampaign: (campaign: any | null, discount: number) => void;
  totalItems: () => number;
  subtotal: () => number;
  /** Sum of (mrp - price) × qty across the cart — the item-level discount the
   *  customer is already getting, before any coupon. */
  itemSavings: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedCampaign: null,
      campaignDiscount: 0,

      addItem: (product, unit, price, listPrice) => {
        const u = unit || product.unit;
        const p = price ?? product.price;
        // Capture list price only when the item is being added below its list
        // price, so "you saved" reflects a genuine discount. When price ===
        // list price we store mrp = price, which contributes zero savings.
        // `listPrice` lets priced options pass their own base price instead of
        // the product's primary price.
        const basePrice = listPrice ?? product.price;
        const mrp = basePrice > p ? basePrice : p;
        const isFirstCartInteraction = get().items.length === 0;
        set(state => {
          const items = state.items.filter(i => !(i.productId === product.id && i.unit !== u));
          const existing = items.find(i => i.productId === product.id && i.unit === u);
          if (existing) {
            return { items: items.map(i => i.productId === product.id && i.unit === u ? { ...i, quantity: i.quantity + 1 } : i) };
          }
          return { items: [...items, { productId: product.id, sourceStoreId: product.storeId, categoryId: product.categoryId, productName: product.name, unit: u, price: p, mrp, quantity: 1, photoUrl: product.photoUrl, smallUrl: product.smallUrl || product.photoVariants?.[0]?.smallUrl || null, thumbnailUrl: product.thumbnailUrl || product.photoVariants?.[0]?.thumbnailUrl || null }] };
        });
        if (isFirstCartInteraction) track('cart_started');
        track('cart_added', { productId: product.id, productName: product.name, unit: u, quantity: 1 });
        syncFunnelCart(get().items);
        return 'added';
      },

      removeItem: (productId, unit) => {
        set(state => ({ items: state.items.filter(i => !(i.productId === productId && i.unit === unit)) }));
        track('cart_removed', { productId, unit });
        syncFunnelCart(get().items);
      },

      updateQty: (productId, unit, qty) => {
        set(state => ({
          items: qty <= 0
            ? state.items.filter(i => !(i.productId === productId && i.unit === unit))
            : state.items.map(i => i.productId === productId && i.unit === unit ? { ...i, quantity: qty } : i),
        }));
        track('cart_updated', { productId, unit, quantity: qty });
        syncFunnelCart(get().items);
      },

      clearCart: () => {
        set({ items: [], appliedCampaign: null, campaignDiscount: 0 });
        track('cart_cleared');
        syncFunnelCart([]);
      },

      setAppliedCampaign: (campaign, discount) => set({ appliedCampaign: campaign, campaignDiscount: discount }),

      totalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),

      subtotal: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),

      itemSavings: () => get().items.reduce((s, i) => s + Math.max(0, (i.mrp ?? i.price) - i.price) * i.quantity, 0),
    }),
    { name: 'mart-cart' }
  )
);
