import { ShoppingCart, ArrowRight } from 'lucide-react';
import { useCartStore } from '../store/cartStore';

interface FloatingCartProps {
  onOpen: () => void;
  hidden?: boolean;
}

export default function FloatingCart({ onOpen, hidden }: FloatingCartProps) {
  const totalItems = useCartStore(s => s.totalItems());
  const itemSavings = useCartStore(s => s.itemSavings());

  if (totalItems === 0 || hidden) return null;

  return (
    <div className="sm:hidden absolute left-1/2 -translate-x-1/2 z-40" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px) + 8px)' }}>
      <button
        onClick={onOpen}
        className="relative flex items-center justify-center gap-2.5 rounded-full border border-emerald-900/25 bg-gradient-to-b from-[#2e8b57] to-[#218044] px-5 py-2 text-white shadow-lg shadow-emerald-900/40 ring-1 ring-inset ring-white/15 transition-all hover:from-[#35a06a] hover:to-[#256e49] hover:shadow-emerald-900/50 active:scale-95 active:from-[#218044] active:to-[#175c34] dark:border-emerald-400/25 dark:from-[#2e8b57] dark:to-[#1c7040] dark:shadow-emerald-950/50 whitespace-nowrap"
      >
        <ShoppingCart className="w-5 h-5 flex-shrink-0" />

        <div className="flex flex-col items-center leading-tight">
          <span className="text-sm font-bold">View Cart</span>
          <span className="text-xs font-semibold text-white/85">
            {itemSavings > 0
              ? `You saved ₹${itemSavings.toFixed(0)}`
              : `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
          </span>
        </div>

        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#14532d]">
          <ArrowRight className="h-4 w-4 text-white" strokeWidth={2.5} />
        </span>
      </button>
    </div>
  );
}
