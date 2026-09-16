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
                  onClick={() => addItem(product, product.unit, discountedPrice)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-tl-2xl rounded-br-2xl shadow-md active:scale-95 transition-all"
                >
                  ADD
                </button>
              ) : (
                <div className="flex items-center bg-emerald-500 rounded-tl-2xl rounded-br-2xl shadow-lg overflow-hidden">
                  <button onClick={() => updateQty(product.id, product.unit, qty - 1)}
                    className="w-7 h-7 flex items-center justify-center text-white active:bg-emerald-600 transition-colors">
                    <Minus className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                  <span className="text-[11px] font-bold text-white w-4 text-center">{qty}</span>
                  <button onClick={() => addItem(product, product.unit, discountedPrice)}
                    className="w-7 h-7 flex items-center justify-center text-white active:bg-emerald-600 transition-colors">
                    <Plus className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info — fixed height name so all cards align */}
        <div className="px-2 pt-1.5 pb-2 flex flex-col">
          <p className="text-[12px] font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight mb-1" style={{ minHeight: '2.2em' }}>{displayName(product)}</p>
          <div className="flex items-center justify-between gap-1 mt-auto">
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-gray-900 dark:text-white leading-tight">₹{discountedPrice}</span>
              {savings > 0 && (
                <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 line-through leading-none">₹{product.price}</span>
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
