import { useState } from 'react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';
import ProductDetailSheet from './ProductDetailSheet';
import CartQuantityControl from './CartQuantityControl';

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
        className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
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
            <span className="absolute top-0 left-0 rounded-br-lg bg-red-500 px-2 py-1 text-[11px] font-extrabold text-white shadow-sm">
              {product.discountPercent}% OFF
            </span>
          )}

          {/* Out of stock overlay */}
          {isOutOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-800/70">
              <span className="bg-gray-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">Out of Stock</span>
            </div>
          )}

          {/* ADD / qty — sits on the image corner so the full price row stays visible */}
          {!isOutOfStock && (
            <div className="absolute bottom-0 right-[3px] z-10">
              <CartQuantityControl
                variant="card"
                quantity={qty}
                onAdd={() => addItem(product, product.unit, discountedPrice)}
                onDecrease={() => updateQty(product.id, product.unit, qty - 1)}
              />
            </div>
          )}
        </div>

        {/* Info — fixed height name so all cards align */}
        <div className="px-2 pt-1.5 pb-2 flex flex-col">
          <div className="mb-1 leading-tight" style={{ minHeight: '2.2em' }}>
            <p className="text-[12px] font-semibold text-gray-900 dark:text-white">{product.name?.trim() || product.localName?.trim()}</p>
            {product.name?.trim() && product.localName?.trim() && product.localName.trim() !== product.name?.trim() && (
              <p className="truncate text-[11px] font-medium text-gray-500 dark:text-slate-400">{product.localName.trim()}</p>
            )}
          </div>
          <p className="text-[11px] font-semibold text-gray-600 dark:text-slate-300 leading-none">{product.unit}{product.approxWeight ? ` · ${product.approxWeight}` : ''}</p>
          <div className="mt-auto flex flex-wrap items-baseline gap-x-1 pt-1.5">
            <span className="text-sm font-extrabold leading-none text-gray-900 dark:text-white">₹{discountedPrice}</span>
            {savings > 0 && (
              <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 line-through leading-none">₹{product.price}</span>
            )}
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
