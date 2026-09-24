import { useCartStore } from '../store/cartStore';

// Accounts for mobile navigation, its iOS safe area, and the floating cart when visible.
export const PAGE_BOTTOM = 'pb-[calc(6rem+env(safe-area-inset-bottom,0px))]';
export const PAGE_BOTTOM_CART = 'pb-[calc(9rem+env(safe-area-inset-bottom,0px))]';

// Hook — returns correct bottom padding class based on cart state
export function usePageBottom(): string {
  const totalItems = useCartStore(s => s.totalItems());
  return totalItems > 0 ? PAGE_BOTTOM_CART : PAGE_BOTTOM;
}
