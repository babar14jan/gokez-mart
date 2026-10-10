import { Minus, Plus } from 'lucide-react';

interface CartQuantityControlProps {
  quantity: number;
  onAdd: () => void;
  onDecrease: () => void;
  variant: 'card' | 'sheet';
}

export default function CartQuantityControl({ quantity, onAdd, onDecrease, variant }: CartQuantityControlProps) {
  const handle = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    action();
  };

  if (variant === 'card') {
    if (quantity === 0) {
      return (
        <button type="button" onClick={handle(onAdd)} className="h-[30px] w-[62px] rounded-[10px] border-2 border-pink-600 bg-white text-xs font-extrabold tracking-wide text-pink-700 transition-colors hover:bg-pink-50 active:scale-[0.98]" aria-label="Add to cart">
          ADD
        </button>
      );
    }

    return (
      <div className="flex h-[30px] w-[62px] items-center rounded-[10px] border border-pink-700 bg-pink-600 p-0.5">
        <button type="button" onClick={handle(onDecrease)} className="flex h-[26px] w-6 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-pink-700 active:bg-pink-800" aria-label="Remove one from cart">
          <Minus className="h-3 w-3" strokeWidth={3} />
        </button>
        <span className="min-w-0 flex-1 text-center text-xs font-extrabold tabular-nums text-white" aria-live="polite">{quantity}</span>
        <button type="button" onClick={handle(onAdd)} className="flex h-[26px] w-6 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-pink-700 active:bg-pink-800" aria-label="Add one more to cart">
          <Plus className="h-3 w-3" strokeWidth={3} />
        </button>
      </div>
    );
  }

  if (quantity === 0) {
    return (
      <button type="button" onClick={handle(onAdd)} className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 text-base font-bold text-white shadow-sm shadow-pink-900/20 transition-colors hover:bg-pink-700 active:scale-[0.98]" aria-label="Add to cart">
        <Plus className="h-5 w-5" strokeWidth={2.5} />
        Add to cart
      </button>
    );
  }

  return (
    <div className="grid h-14 grid-cols-[3.25rem_1fr_3.25rem] items-center rounded-xl bg-pink-600 px-1 shadow-sm shadow-pink-900/20">
      <button type="button" onClick={handle(onDecrease)} className="flex h-11 w-11 items-center justify-center justify-self-center rounded-lg bg-pink-700 text-white transition-colors hover:bg-pink-800 active:scale-90" aria-label="Remove one from cart">
        <Minus className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <span className="text-center text-base font-bold tabular-nums text-white" aria-live="polite">{quantity} in cart</span>
      <button type="button" onClick={handle(onAdd)} className="flex h-11 w-11 items-center justify-center justify-self-center rounded-lg bg-pink-700 text-white transition-colors hover:bg-pink-800 active:scale-90" aria-label="Add one more to cart">
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}