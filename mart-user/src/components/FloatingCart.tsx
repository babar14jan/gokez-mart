import { ShoppingCart, ArrowRight } from 'lucide-react';
import { useCartStore } from '../store/cartStore';

interface FloatingCartProps {
  onOpen: () => void;
  hidden?: boolean;
}

export default function FloatingCart({ onOpen, hidden }: FloatingCartProps) {
  const totalItems = useCartStore(s => s.totalItems());

  if (totalItems === 0 || hidden) return null;

  return (
    <div className="sm:hidden fixed left-1/2 -translate-x-1/2 z-40" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px) + 8px)' }}>
      <button
        onClick={onOpen}
        className="flex items-center justify-center gap-2.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white px-5 py-2 rounded-full shadow-lg active:scale-95 transition-all whitespace-nowrap"
      >
        <ShoppingCart className="w-5 h-5 flex-shrink-0" />

        <div className="flex flex-col items-center leading-tight">
          <span className="text-sm font-bold">View Cart</span>
          <span className="text-[10px] text-white/75 font-medium">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </span>
        </div>

        <ArrowRight className="w-4 h-4 flex-shrink-0" />
      </button>
    </div>
  );
}
