import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Product } from '@/services/api';

export interface CartItem {
  productId: string; sourceStoreId?: string; productName: string;
  unit: string; price: number; quantity: number;
  mrp?: number;
  categoryId?: string;
  categoryName?: string;
  unavailable?: boolean;
  photoUrl: string | null;
  thumbnailUrl?: string | null;
}

export interface ReferralSelection {
  id: string;
  amount: number;
}

export type AddItemResult = 'added' | 'different_unit';

interface CartState {
  items: CartItem[];
  appliedCampaign: { id: string; code?: string; discountType: string; discountValue: number } | null;
  campaignDiscount: number;
  selectedReferralCredit: ReferralSelection | null;
  addItem: (product: Product, unit?: string, price?: number, listPrice?: number) => AddItemResult;
  removeItem: (productId: string, unit: string) => void;
  updateQty: (productId: string, unit: string, qty: number) => void;
  reconcileWithCatalog: (products: Product[], enforceOutOfStock?: boolean) => void;
  clearCart: () => void;
  setAppliedCampaign: (campaign: CartState['appliedCampaign'], discount: number) => void;
  setReferralSelection: (selection: ReferralSelection | null) => void;
  clearReferralSelection: () => void;
  totalItems: () => number;
  subtotal: () => number;
  itemSavings: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedCampaign: null,
      campaignDiscount: 0,
      selectedReferralCredit: null,

      addItem: (product, unit, price, listPrice) => {
        const u = unit ?? product.unit;
        const p = price ?? product.price;
        const base = listPrice ?? product.mrp ?? product.price;
        const mrp = base > p ? base : p;
        set(state => {
          const items = state.items.filter(i => !(i.productId === product.id && i.unit !== u));
          const existing = items.find(i => i.productId === product.id && i.unit === u);
          if (existing) {
            return {
              items: items.map(i => i.productId === product.id && i.unit === u
                ? { ...i, quantity: i.quantity + 1, mrp: Math.max(i.mrp ?? i.price, mrp), unavailable: i.unavailable ?? false }
                : i),
            };
          }
          return {
            items: [...items, {
              productId: product.id,
              sourceStoreId: product.storeId,
              categoryId: product.categoryId,
              categoryName: product.categoryName,
              productName: product.name,
              unit: u,
              price: p,
              mrp,
              quantity: 1,
              unavailable: false,
              photoUrl: product.photoUrl,
              thumbnailUrl: product.thumbnailUrl ?? product.photoVariants?.[0]?.thumbnailUrl ?? null,
            }],
          };
        });
        return 'added';
      },

      removeItem: (productId, unit) =>
        set(state => ({ items: state.items.filter(i => !(i.productId === productId && i.unit === unit)) })),

      updateQty: (productId, unit, qty) =>
        set(state => ({
          items: qty <= 0
            ? state.items.filter(i => !(i.productId === productId && i.unit === unit))
            : state.items.map(i => i.productId === productId && i.unit === unit ? { ...i, quantity: qty } : i),
        })),

      reconcileWithCatalog: (products, enforceOutOfStock = false) => {
        const byId = new Map(products.map(product => [product.id, product]));
        set(state => ({
          items: state.items.map(item => {
            const product = byId.get(item.productId);
            if (!product) return { ...item, unavailable: true };
            const option = (product.weightOptions ?? []).find(weight => weight.label === item.unit);
            const unitMatches = item.unit === product.unit || !!option;
            const price = option?.price ?? (item.unit === product.unit ? product.price : item.price);
            const listPrice = option ? (product.mrp ?? product.price ?? price) : (product.mrp ?? product.price ?? price);
            const unavailable = !unitMatches
              || (enforceOutOfStock && (product.availabilityStatus === 'out_of_stock' || !product.isAvailable));
            return {
              ...item,
              categoryId: product.categoryId,
              categoryName: product.categoryName ?? item.categoryName,
              sourceStoreId: product.storeId ?? item.sourceStoreId,
              price,
              mrp: listPrice > price ? listPrice : price,
              unavailable,
            };
          }),
        }));
      },

      clearCart: () => set({ items: [], appliedCampaign: null, campaignDiscount: 0, selectedReferralCredit: null }),

      setAppliedCampaign: (campaign, discount) => set({ appliedCampaign: campaign, campaignDiscount: discount }),

      setReferralSelection: (selection: ReferralSelection | null) => set({ selectedReferralCredit: selection }),

      clearReferralSelection: () => set({ selectedReferralCredit: null }),

      totalItems: () => get().items.filter(item => !item.unavailable).reduce((s, i) => s + i.quantity, 0),
      subtotal: () => get().items.filter(item => !item.unavailable).reduce((s, i) => s + i.price * i.quantity, 0),
      itemSavings: () => get().items
        .filter(item => !item.unavailable)
        .reduce((s, i) => s + Math.max(0, (i.mrp ?? i.price) - i.price) * i.quantity, 0),
    }),
    {
      name:    'mart-cart',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<CartState>;
        if (version >= 1) return state as CartState;
        const items = Array.isArray(state.items)
          ? state.items.map(item => {
              const price = Number(item.price) || 0;
              const mrp = Number(item.mrp);
              return {
                ...item,
                categoryId: typeof item.categoryId === 'string' ? item.categoryId : '',
                mrp: Number.isFinite(mrp) && mrp > price ? mrp : price,
              };
            })
          : [];
        return { ...state, items } as CartState;
      },
    }
  )
);
