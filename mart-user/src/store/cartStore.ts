import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../services/api';

export interface CartItem {
  productId: string;
  productName: string;
  unit: string;
  price: number;
  quantity: number;
  photoUrl: string | null;
}

interface CartState {
  items: CartItem[];
  addItem: (product: Product, unit?: string, price?: number) => void;
  removeItem: (productId: string, unit: string) => void;
  updateQty: (productId: string, unit: string, qty: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  subtotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product, unit, price) => {
        const u = unit || product.unit;
        const p = price ?? product.price;
        set(state => {
          const existing = state.items.find(i => i.productId === product.id && i.unit === u);
          if (existing) {
            return { items: state.items.map(i => i.productId === product.id && i.unit === u ? { ...i, quantity: i.quantity + 1 } : i) };
          }
          return { items: [...state.items, { productId: product.id, productName: product.name, unit: u, price: p, quantity: 1, photoUrl: product.photoUrl }] };
        });
      },

      removeItem: (productId, unit) =>
        set(state => ({ items: state.items.filter(i => !(i.productId === productId && i.unit === unit)) })),

      updateQty: (productId, unit, qty) =>
        set(state => ({
          items: qty <= 0
            ? state.items.filter(i => !(i.productId === productId && i.unit === unit))
            : state.items.map(i => i.productId === productId && i.unit === unit ? { ...i, quantity: qty } : i),
        })),

      clearCart: () => set({ items: [] }),

      totalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),

      subtotal: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
    }),
    { name: 'mart-cart' }
  )
);
