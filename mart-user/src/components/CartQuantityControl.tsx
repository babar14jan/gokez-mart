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
        <button type="button" onClick={handle(onAdd)} className="h-[30px] w-[72px] rounded-[10px] border-2 border-emerald-600 bg-white text-xs font-extrabold tracking-wide text-emerald-700 transition-colors hover:bg-emerald-50 active:scale-[0.98]" aria-label="Add to cart">
          ADD
        </button>
      );
    }

    return (
      <div className="flex h-[30px] w-[72px] items-center rounded-[10px] border border-emerald-700 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-700 p-0.5">
        <button type="button" onClick={handle(onDecrease)} className="flex h-[26px] w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800" aria-label="Remove one from cart">
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 text-center text-xs font-extrabold tabular-nums text-white" aria-live="polite">{quantity}</span>
        <button type="button" onClick={handle(onAdd)} className="flex h-[26px] w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800" aria-label="Add one more to cart">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (quantity === 0) {
    return (
      <button type="button" onClick={handle(onAdd)} className="flex h-10 w-24 items-center justify-center gap-1.5 rounded-xl border-2 border-emerald-600 bg-white px-3 text-sm font-extrabold tracking-wide text-emerald-700 transition-colors hover:bg-emerald-50 active:scale-[0.98]" aria-label="Add to cart">
        ADD
      </button>
    );
  }

  return (
    <div className="flex h-10 w-24 items-center justify-between rounded-xl border border-emerald-700 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-700 p-0.5">
      <button type="button" onClick={handle(onDecrease)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800" aria-label="Remove one from cart">
        <Minus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <span className="text-sm font-extrabold tabular-nums text-white" aria-live="polite">{quantity}</span>
      <button type="button" onClick={handle(onAdd)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800" aria-label="Add one more to cart">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}