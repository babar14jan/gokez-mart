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
    ? Math.round(product.price * (1 - product.discountPercent / 100))
    : product.price;
  const savings = product.discountPercent > 0
    ? Math.round(product.price - discountedPrice)
    : 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 flex flex-col">
      {/* Image */}
      <div className="relative rounded-t-xl overflow-hidden bg-gray-50 dark:bg-slate-700 aspect-square">
        {product.photoUrl
          ? <img src={product.photoUrl} alt={product.name} className={`w-full h-full object-cover ${isOutOfStock ? 'opacity-40' : ''}`} />
          : <div className="w-full h-full flex items-center justify-center text-3xl">🥦</div>
        }

        {/* Discount badge — top left */}
        {savings > 0 && !isOutOfStock && (
          <span className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
            {product.discountPercent}% OFF
          </span>
        )}

        {/* Out of stock */}
        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-slate-800/60">
            <span className="bg-slate-700 text-white text-[10px] font-bold px-2 py-1 rounded-full">Out of Stock</span>
          </div>
        )}

        {/* ADD / qty — bottom right corner of image */}
        {!isOutOfStock && (
          <div className="absolute bottom-0 right-0 z-10">
            {qty === 0 ? (
              <button
                onClick={() => addItem(product)}
                className="bg-white dark:bg-slate-800 border border-emerald-500 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-tl-xl rounded-br-xl shadow-sm active:scale-95 transition-transform"
              >
                ADD
              </button>
            ) : (
              <div className="flex items-center gap-0.5 bg-emerald-500 rounded-tl-xl rounded-br-xl px-1 py-0.5 shadow-md">
                <button onClick={() => updateQty(product.id, product.unit, qty - 1)}
                  className="w-5 h-5 flex items-center justify-center text-white">
                  <Minus className="w-3 h-3" strokeWidth={2.5} />
                </button>
                <span className="text-xs font-bold text-white w-4 text-center">{qty}</span>
                <button onClick={() => addItem(product)}
                  className="w-5 h-5 flex items-center justify-center text-white">
                  <Plus className="w-3 h-3" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-2 pt-1.5 pb-2">
        <p className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{product.name}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{product.unit}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="text-xs font-bold text-gray-900 dark:text-white">₹{discountedPrice}</span>
          {savings > 0 && (
            <>
              <span className="text-[10px] text-gray-400 line-through">₹{product.price}</span>
              <span className="text-[9px] font-bold text-emerald-600">₹{savings} OFF</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
