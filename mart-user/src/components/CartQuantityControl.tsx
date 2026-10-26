import { Minus, Plus } from 'lucide-react';

interface CartQuantityControlProps {
  quantity: number;
  onAdd: () => void;
  onDecrease: () => void;
  variant: 'card' | 'sheet';
  /** Freezes the control (used while an order is being placed). */
  disabled?: boolean;
}

export default function CartQuantityControl({ quantity, onAdd, onDecrease, variant, disabled = false }: CartQuantityControlProps) {
  const handle = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled) return;
    action();
  };

  if (variant === 'card') {
    return (
      <div
        className={`flex h-[30px] w-[88px] items-center overflow-hidden rounded-[10px] ${disabled ? 'opacity-40' : ''} ${
          quantity === 0
            ? 'border-2 border-gokez-600 bg-white'
            : 'border border-gokez-700 bg-gradient-to-r from-gokez-700 to-gokez-800 p-0.5'
        }`}
      >
        {quantity === 0 ? (
          <button type="button" onClick={handle(onAdd)} disabled={disabled} className="h-full w-full text-xs font-extrabold tracking-wide text-gokez-700 transition-colors hover:bg-gokez-50" aria-label="Add to cart">
            ADD
          </button>
        ) : (
          <>
            <button type="button" onClick={handle(onDecrease)} disabled={disabled} className="flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-gokez-800 active:bg-gokez-900" aria-label="Remove one from cart">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-0 flex-1 text-center text-xs font-extrabold tabular-nums text-white" aria-live="polite">{quantity}</span>
            <button type="button" onClick={handle(onAdd)} disabled={disabled} className="flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-gokez-800 active:bg-gokez-900" aria-label="Add one more to cart">
              <Plus className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  if (quantity === 0) {
    return (
      <button type="button" onClick={handle(onAdd)} disabled={disabled} className="flex h-10 w-24 items-center justify-center gap-1.5 rounded-xl border-2 border-gokez-600 bg-white px-3 text-sm font-extrabold tracking-wide text-gokez-700 transition-colors hover:bg-gokez-50 disabled:opacity-40" aria-label="Add to cart">
        ADD
      </button>
    );
  }

  return (
    <div className={`flex h-10 w-24 items-center justify-between rounded-xl border border-gokez-700 bg-gradient-to-r from-gokez-700 to-gokez-800 p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      <button type="button" onClick={handle(onDecrease)} disabled={disabled} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-gokez-800 active:bg-gokez-900" aria-label="Remove one from cart">
        <Minus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <span className="text-sm font-extrabold tabular-nums text-white" aria-live="polite">{quantity}</span>
      <button type="button" onClick={handle(onAdd)} disabled={disabled} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-gokez-800 active:bg-gokez-900" aria-label="Add one more to cart">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}