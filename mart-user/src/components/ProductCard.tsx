import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';
import ProductDetailSheet from './ProductDetailSheet';

// Display name: English (Hindi) or just English or just Hindi — never empty brackets
function displayName(product: Product): string {
  const eng = product.name?.trim();
  const local = product.localName?.trim();
  if (eng && local) return `${eng} (${local})`;
  if (eng) return eng;
  if (local) return local;
  return '';
}

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { items, addItem, updateQty } = useCartStore();
  const cartItem = items.find(i => i.productId === product.id && i.unit === product.unit);
  const qty = cartItem?.quantity || 0;
  const isOutOfStock = product.availabilityStatus === 'out_of_stock' || !product.isAvailable;
  const [showDetail, setShowDetail] = useState(false);

  const discountedPrice = product.discountPercent > 0
    ? Math.round(product.price * (1 - product.discountPercent / 100))
    : product.price;
  const savings = product.discountPercent > 0
    ? Math.round(product.price - discountedPrice)
    : 0;

  return (
    <>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-md hover:shadow-lg transition-shadow flex flex-col overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
        onClick={() => setShowDetail(true)}
      >
        {/* Image */}
        <div className="relative bg-gray-50 dark:bg-slate-700 aspect-square overflow-hidden rounded-t-2xl">
          {product.photoUrl
            ? <img src={product.photoUrl} alt={product.name}
                className={`w-full h-full object-cover ${isOutOfStock ? 'opacity-40' : ''}`}
                loading="lazy" decoding="async" />
            : <div className="w-full h-full flex items-center justify-center text-4xl">🥦</div>
          }

          {/* Discount badge */}
          {savings > 0 && !isOutOfStock && (
            <span className="absolute top-2 left-2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-lg shadow-sm">
              {product.discountPercent}% OFF
            </span>
          )}

          {/* Out of stock overlay */}
          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-800/70">
              <span className="bg-gray-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">Out of Stock</span>
            </div>
          )}

          {/* ADD / qty — stops propagation so card tap doesn't open sheet */}
          {!isOutOfStock && (
            <div className="absolute bottom-0 right-0 z-10" onClick={e => e.stopPropagation()}>
              {qty === 0 ? (
                <button
                  onClick={() => addItem(product)}
                  className="bg-white dark:bg-slate-800 border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-tl-2xl rounded-br-2xl shadow-md active:scale-95 transition-all hover:bg-emerald-50"
                >
                  ADD
                </button>
              ) : (
                <div className="flex items-center gap-1 bg-emerald-500 rounded-tl-2xl rounded-br-2xl px-1.5 py-1 shadow-lg">
                  <button onClick={() => updateQty(product.id, product.unit, qty - 1)}
                    className="w-6 h-6 flex items-center justify-center text-white active:scale-90 transition-transform">
                    <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <span className="text-sm font-bold text-white w-5 text-center">{qty}</span>
                  <button onClick={() => addItem(product)}
                    className="w-6 h-6 flex items-center justify-center text-white active:scale-90 transition-transform">
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info — compact */}
        <div className="px-2 pt-1.5 pb-2">
          <p className="text-[12px] font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight mb-1">{displayName(product)}</p>
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-baseline gap-1 flex-wrap">
              <span className="text-[13px] font-bold text-gray-900 dark:text-white">₹{discountedPrice}</span>
              {savings > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-slate-500 line-through">₹{product.price}</span>
              )}
            </div>
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-md flex-shrink-0">{product.unit}</span>
          </div>
        </div>
      </div>

      {/* Product detail bottom sheet */}
      {showDetail && (
        <ProductDetailSheet product={product} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
