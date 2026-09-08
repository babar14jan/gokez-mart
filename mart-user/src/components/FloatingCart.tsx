import { ArrowRight } from 'lucide-react';
import { useCartStore } from '../store/cartStore';

interface FloatingCartProps {
  onOpen: () => void;
}

export default function FloatingCart({ onOpen }: FloatingCartProps) {
  const totalItems = useCartStore(s => s.totalItems());
  const subtotal = useCartStore(s => s.subtotal());

  if (totalItems === 0) return null;

  return (
    <div className="sm:hidden fixed bottom-[5.5rem] left-4 right-4 z-39">
      <button
        onClick={onOpen}
        className="w-full flex items-center justify-between bg-emerald-700 text-white px-3 py-2.5 rounded-2xl shadow-lg active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center gap-2">
          <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-lg">{totalItems}</span>
          <span className="text-xs font-semibold">View Cart</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold">₹{subtotal.toFixed(0)}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </button>
    </div>
  );
}
