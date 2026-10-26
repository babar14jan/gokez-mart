import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { trackOnce } from '../utils/track';
import CartQuantityControl from './CartQuantityControl';
import SmartImage from './SmartImage';

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

  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    startYRef.current = e.touches[0].clientY;
    setDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const currentY = e.touches[0].clientY;
    const delta = currentY - startYRef.current;
    if (delta > 0) {
      setDragY(delta);
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragY > 120) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName(product)} details`}
      onClick={onClose}>

      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-800 transition-transform"
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>

        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
          <div className="w-9" />
          <div className="h-1.5 w-10 rounded-full bg-gray-300 dark:bg-slate-600" />
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-700 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Large hero image — full-width, clearly bigger than the home card */}
          <div className="relative h-48 w-full overflow-hidden bg-gray-50 sm:h-56 dark:bg-slate-700">
            <SmartImage
              src={product.photoUrl}
              alt={product.name}
              className="h-full w-full"
              imgClassName={`object-contain ${isOutOfStock ? 'opacity-50' : ''}`}
              loading="eager"
              fetchPriority="high"
              fallback={<div className="flex h-full w-full items-center justify-center text-7xl">🥦</div>}
            />
            {savings > 0 && !isOutOfStock && (
              <span className="absolute left-3 top-3 rounded-full border border-saffron-600/45 bg-saffron-400 px-3 py-1.5 text-xs font-extrabold leading-none text-ink shadow-[0_1px_4px_rgba(111,59,19,0.3)]">
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
                  <span className="rounded-full bg-gokez-50 px-2 py-0.5 text-xs font-bold text-gokez-800 dark:bg-gokez-950/30 dark:text-gokez-400">Save ₹{savings}</span>
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

        {/* Footer bar */}
        <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            {isOutOfStock ? (
              <div className="flex-1 h-11 flex items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                Out of stock
              </div>
            ) : qty === 0 ? (
              <button
                type="button"
                onClick={() => addItem(product, product.unit, discountedPrice)}
                className="flex-1 h-11 rounded-xl bg-gokez-700 text-sm font-bold text-white transition-colors hover:bg-gokez-800"
              >
                Add to Cart
              </button>
            ) : (
              <>
                <div className="flex-1">
                  <div className="text-xs text-gray-500 dark:text-slate-400">{qty} {qty === 1 ? 'item' : 'items'} • ₹{discountedPrice} each</div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white">Total: ₹{qty * discountedPrice}</div>
                </div>
                <CartQuantityControl
                  variant="sheet"
                  quantity={qty}
                  onAdd={() => addItem(product, product.unit, discountedPrice)}
                  onDecrease={() => updateQty(product.id, product.unit, qty - 1)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
