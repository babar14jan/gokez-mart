import { useEffect } from 'react';
import { X, Plus, Minus } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';

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
      onClick={onClose}>

      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />

      {/* Sheet */}
      <div className="relative bg-white dark:bg-slate-800 w-full max-w-lg rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Close button */}
        <button onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 bg-gray-100 dark:bg-slate-700 rounded-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
          <X className="w-4 h-4 text-gray-500 dark:text-slate-400" />
        </button>

        {/* Product image */}
        <div className="mx-4 mt-2 rounded-2xl overflow-hidden bg-gray-50 dark:bg-slate-700 aspect-square max-h-56">
          {product.photoUrl ? (
            <img src={product.photoUrl} alt={product.name}
              className={`w-full h-full object-cover ${isOutOfStock ? 'opacity-50' : ''}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">🥦</div>
          )}
        </div>

        {/* Content */}
        <div className="px-4 pt-4 pb-6 space-y-4">

          {/* Name + badges */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-snug flex-1">
                {displayName(product)}
              </h2>
              {savings > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0 mt-1">
                  {product.discountPercent}% OFF
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 dark:text-slate-500 mt-0.5">{product.unit}</p>
            {product.categoryName && (
              <span className="inline-block mt-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
                {product.categoryName}
              </span>
            )}
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">₹{discountedPrice}</span>
            {savings > 0 && (
              <>
                <span className="text-base text-gray-400 dark:text-slate-500 line-through">₹{product.price}</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">Save ₹{savings}</span>
              </>
            )}
          </div>

          {/* Description */}
          {product.description && (
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-2xl p-3.5">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">About this product</p>
              <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* ADD / qty control */}
          <div className="pt-1">
            {isOutOfStock ? (
              <div className="w-full py-4 bg-gray-100 dark:bg-slate-700 rounded-2xl text-center">
                <p className="text-sm font-semibold text-gray-400 dark:text-slate-500">Out of Stock</p>
              </div>
            ) : qty === 0 ? (
              <button onClick={() => addItem(product, product.unit, discountedPrice)}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-base font-bold rounded-2xl active:scale-[0.98] transition-all shadow-sm shadow-emerald-200 dark:shadow-none">
                Add to Cart
              </button>
            ) : (
              <div className="flex items-center justify-between bg-emerald-500 rounded-2xl px-4 py-3">
                <button onClick={() => updateQty(product.id, product.unit, qty - 1)}
                  className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center active:scale-90 transition-transform">
                  <Minus className="w-5 h-5 text-white" strokeWidth={2.5} />
                </button>
                <span className="text-lg font-bold text-white">{qty} in cart</span>
                <button onClick={() => addItem(product, product.unit, discountedPrice)}
                  className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center active:scale-90 transition-transform">
                  <Plus className="w-5 h-5 text-white" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
