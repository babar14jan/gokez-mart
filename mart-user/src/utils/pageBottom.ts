import { useCartStore } from '../store/cartStore';

// Bottom padding values — accounts for bottom nav (80px) + floating cart pill (~56px) + breathing room
export const PAGE_BOTTOM = 'pb-24';           // no cart — just bottom nav
export const PAGE_BOTTOM_CART = 'pb-36';      // with cart pill visible

// Hook — returns correct bottom padding class based on cart state
export function usePageBottom(): string {
  const totalItems = useCartStore(s => s.totalItems());
  return totalItems > 0 ? PAGE_BOTTOM_CART : PAGE_BOTTOM;
}
