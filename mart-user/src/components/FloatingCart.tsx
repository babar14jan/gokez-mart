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
        className="flex items-center gap-2.5 bg-emerald-700 text-white pl-3 pr-4 py-2.5 rounded-full shadow-xl active:scale-[0.97] transition-transform"
      >
        <ShoppingCart className="w-4 h-4" />
        <span className="text-sm font-bold">View Cart</span>
        <span className="text-xs text-emerald-300 font-semibold">{totalItems} {totalItems === 1 ? 'item' : 'items'}</span>
        <ArrowRight className="w-3.5 h-3.5 text-emerald-300" />
      </button>
    </div>
  );
}
