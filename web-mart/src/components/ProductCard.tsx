import { Plus, Minus } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { items, addItem, updateQty } = useCartStore();
  const cartItem = items.find(i => i.productId === product.id && i.unit === product.unit);
  const qty = cartItem?.quantity || 0;
  const isOutOfStock = product.availabilityStatus === 'out_of_stock' || !product.isAvailable;

  const discountedPrice = product.discountPercent > 0
    ? product.price * (1 - product.discountPercent / 100)
    : product.price;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden shadow-sm flex flex-col">
      {/* Photo */}
      <div className="relative aspect-square bg-gray-50">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt={product.name} className={`w-full h-full object-cover ${isOutOfStock ? 'opacity-50' : ''}`} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-slate-700">
            <svg className="w-10 h-10 text-gray-200 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {product.discountPercent > 0 && !isOutOfStock && (
          <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-lg">
            {product.discountPercent}% OFF
          </span>
        )}
        {isOutOfStock && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-800/90 text-white text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
            Out of Stock
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight mb-0.5 line-clamp-2">{product.name}</p>
        <p className="text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">{product.unit}</p>

        <div className="flex items-center justify-between mt-auto">
          <div>
            <span className="text-sm font-bold text-gray-900 dark:text-white">₹{discountedPrice.toFixed(0)}</span>
            {product.discountPercent > 0 && (
              <span className="text-xs text-gray-500 dark:text-slate-400 line-through ml-1">₹{product.price}</span>
            )}
          </div>

          {!isOutOfStock && (
            qty === 0 ? (
              <button
                onClick={() => addItem(product)}
                className="w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateQty(product.id, product.unit, qty - 1)}
                  className="w-7 h-7 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg flex items-center justify-center transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm font-bold text-gray-900 dark:text-white w-5 text-center">{qty}</span>
                <button
                  onClick={() => addItem(product)}
                  className="w-7 h-7 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
