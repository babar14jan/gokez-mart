import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
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
      <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-800"
        onClick={e => e.stopPropagation()}>

        <div className="relative flex h-14 shrink-0 items-center justify-center border-b border-gray-100 dark:border-slate-700">
          <div className="w-10 h-1 bg-gray-200 dark:bg-slate-600 rounded-full" />
          <button type="button" onClick={onClose} aria-label="Close product details"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-pink-200 bg-pink-50 text-pink-700 shadow-sm transition-colors hover:bg-pink-100 dark:border-pink-900/60 dark:bg-pink-950/30 dark:text-pink-300 dark:hover:bg-pink-950/50">
            <ChevronDown className="h-6 w-6" strokeWidth={3} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-50 dark:bg-slate-700">
              {product.photoUrl ? (
                <img src={product.photoUrl} alt={product.name}
                  className={`h-full w-full object-contain p-1 ${isOutOfStock ? 'opacity-50' : ''}`} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl">🥦</div>
              )}
              {savings > 0 && !isOutOfStock && (
                <span className="absolute left-1.5 top-1.5 rounded-md bg-pink-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {product.discountPercent}% OFF
                </span>
              )}
            </div>

            <div className="min-w-0 py-0.5">
              <h2 className="break-words text-lg font-bold leading-snug text-gray-900 dark:text-white">{product.name?.trim() || product.localName?.trim()}</h2>
              {product.localName?.trim() && product.localName.trim() !== product.name?.trim() && (
                <p className="mt-0.5 break-words text-sm font-semibold leading-snug text-pink-700 dark:text-pink-300">{product.localName.trim()}</p>
              )}
              <p className="mt-1 text-xs font-medium text-gray-500 dark:text-slate-400">{product.unit}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-lg font-bold text-white dark:bg-emerald-500">₹{discountedPrice}</span>
                {savings > 0 && <span className="text-xs text-gray-500 line-through dark:text-slate-400">₹{product.price}</span>}
                {savings > 0 && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Save ₹{savings}</span>}
              </div>
              {product.categoryName && (
                <span className="mt-3 inline-flex rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                  {product.categoryName}
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

        <div className="shrink-0 border-t border-gray-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 dark:border-slate-700 dark:bg-slate-800">
          {isOutOfStock ? (
            <div className="rounded-xl bg-gray-100 py-3 text-center dark:bg-slate-700">
              <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">Out of stock</p>
            </div>
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
    </div>
  );
}
