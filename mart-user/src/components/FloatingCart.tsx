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
        className="relative flex items-center justify-center gap-2.5 rounded-full border border-emerald-800/30 bg-emerald-700 px-5 py-2 text-white shadow-md shadow-black/15 transition-all hover:bg-emerald-800 active:scale-95 active:bg-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:active:bg-emerald-800 whitespace-nowrap"
      >
        <ShoppingCart className="w-5 h-5 flex-shrink-0" />

        <div className="flex flex-col items-center leading-tight">
          <span className="text-sm font-bold">View Cart</span>
          <span className="text-xs font-semibold text-white/85">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </span>
        </div>

        <ArrowRight className="w-4 h-4 flex-shrink-0" />
      </button>
    </div>
  );
}
