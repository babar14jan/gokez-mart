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
    <div className="sm:hidden fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-40">
      <button
        onClick={onOpen}
        className="flex items-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-white pl-4 pr-4 py-3 rounded-full shadow-xl shadow-emerald-500/40 active:scale-95 transition-all whitespace-nowrap"
      >
        {/* Cart icon — left */}
        <ShoppingCart className="w-5 h-5 text-white flex-shrink-0" />

        {/* View Cart + item count — stacked */}
        <div className="flex flex-col items-start leading-tight">
          <span className="text-sm font-bold">View Cart</span>
          <span className="text-[11px] text-emerald-200 font-medium">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Big arrow — right, covers both lines */}
        <ArrowRight className="w-6 h-6 text-white flex-shrink-0" />
      </button>
    </div>
  );
}
