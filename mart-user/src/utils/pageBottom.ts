import { useCartStore } from '../store/cartStore';

// The bottom nav is in-flow inside the app shell now, so pages only need a
// small gutter; the floating cart overlays the bottom of the scroll area, so it
// gets the extra room.
export const PAGE_BOTTOM = 'page-bottom pb-8';
export const PAGE_BOTTOM_CART = 'page-bottom pb-[calc(6rem+env(safe-area-inset-bottom,0px))]';

// Hook — returns correct bottom padding class based on cart state
export function usePageBottom(): string {
  const totalItems = useCartStore(s => s.totalItems());
  return totalItems > 0 ? PAGE_BOTTOM_CART : PAGE_BOTTOM;
}
