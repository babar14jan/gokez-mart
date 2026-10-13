import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { trackOnce } from '../utils/track';
import CartQuantityControl from './CartQuantityControl';

function displayName(product: Product): string {
  const eng = product.name?.trim();
  const local = product.localName?.trim();
  if (eng && local) return `${eng} (${local})`;
  if (eng) return eng;
  if (local) return local;
  return '';
}

interface ProductDetailSheetProps {
  product: Product;
  onClose: () => void;
}

export default function ProductDetailSheet({ product, onClose }: ProductDetailSheetProps) {
  // Reached the product sheet = product viewed. Once per mount, not per scroll.
  useEffect(() => {
    trackOnce('product_viewed', { productId: product.id, productName: product.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);
  const { items, addItem, updateQty } = useCartStore();
  const cartItem = items.find(i => i.productId === product.id && i.unit === product.unit);
  const qty = cartItem?.quantity || 0;
  const isOutOfStock = product.availabilityStatus === 'out_of_stock' || !product.isAvailable;

  const discountedPrice = product.discountPercent > 0
    ? Math.round(product.price * (1 - product.discountPercent / 100))
    : product.price;
  const savings = product.discountPercent > 0
    ? Math.round(product.price - discountedPrice)
    : 0;

  // Lock body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName(product)} details`}
      onClick={onClose}>

      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

      {/* Sheet */}
      <div className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-800"
        onClick={e => e.stopPropagation()}>

        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
          {qty > 0 ? (
            <button type="button" onClick={onClose} aria-label="Done"
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-white shadow-sm shadow-emerald-900/20 transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95">
              Done
            </button>
          ) : (
            <button type="button" onClick={onClose} aria-label="Back to products"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-white dark:hover:bg-slate-700">
              <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
            </button>
          )}
          <div className="shrink-0">
            {isOutOfStock ? (
              <span className="flex h-10 items-center rounded-xl border border-gray-200 bg-gray-100 px-4 text-sm font-extrabold tracking-wide text-gray-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
                Out of stock
              </span>
            ) : (
              <CartQuantityControl
                variant="sheet"
                quantity={qty}
                onAdd={() => addItem(product, product.unit, discountedPrice)}
                onDecrease={() => updateQty(product.id, product.unit, qty - 1)}
              />
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Large hero image — full-width, clearly bigger than the home card */}
          <div className="relative h-48 w-full overflow-hidden bg-gray-50 sm:h-56 dark:bg-slate-700">
            {product.photoUrl ? (
              <img src={product.photoUrl} alt={product.name}
                className={`h-full w-full object-contain ${isOutOfStock ? 'opacity-50' : ''}`} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-7xl">🥦</div>
            )}
            {savings > 0 && !isOutOfStock && (
              <span className="absolute left-0 top-0 rounded-br-lg bg-red-500 px-2 py-1 text-[11px] font-extrabold text-white">
                {product.discountPercent}% OFF
              </span>
            )}
          </div>

          <div className="px-4 pb-3 pt-4">
            <h2 className="break-words text-xl font-bold leading-snug text-gray-900 dark:text-white">
              {displayName(product)}
            </h2>

            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">₹{discountedPrice}</span>
              {savings > 0 && (
                <>
                  <span className="text-sm font-semibold text-gray-400 line-through dark:text-slate-500">₹{product.price}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Save ₹{savings}</span>
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {product.unit && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                  {product.unit}
                </span>
              )}
              {product.approxWeight && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                  approx {product.approxWeight}
                </span>
              )}
            </div>
          </div>

          {product.description && (
            <div className="border-t border-gray-100 px-4 py-4 dark:border-slate-700">
              <p className="mb-1.5 text-xs font-bold uppercase text-gray-500 dark:text-slate-400">About this product</p>
              <p className="text-sm leading-relaxed text-gray-700 dark:text-slate-300">{product.description}</p>
            </div>
          )}
        </div>

        {/* Footer bar — colour only, no content */}
        <div className="shrink-0 border-t border-gray-100 bg-white py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] dark:border-slate-700 dark:bg-slate-800" />
      </div>
    </div>
  );
}
