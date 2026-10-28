import { useState } from 'react';
import { Leaf } from 'lucide-react';
import type { Product } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { productLabelParts } from '../utils/productLabel';
import ProductDetailSheet from './ProductDetailSheet';
import CartQuantityControl from './CartQuantityControl';
import SmartImage from './SmartImage';

interface ProductCardProps {
  product: Product;
  /** Freezes the ADD/qty control (used while an order is being placed). */
  disabled?: boolean;
  /** Called after the cart is updated from this card's ADD/+ control. */
  onAdd?: () => void;
}

export default function ProductCard({ product, disabled = false, onAdd }: ProductCardProps) {
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
  const { primary: primaryName, secondary: secondaryName } = productLabelParts(product);
  const openDetail = () => setShowDetail(true);

  return (
    <>
      <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0 dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={openDetail}
          aria-label={`View ${product.name}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gokez-500"
        />
        <div className="pointer-events-none relative z-10 aspect-square overflow-hidden bg-cream-100 dark:bg-slate-700">
          <SmartImage
            src={product.photoUrl}
            alt={product.name}
            className="h-full w-full"
            imgClassName={`object-cover transition-transform duration-300 group-hover:scale-[1.03] ${isOutOfStock ? 'opacity-40' : ''}`}
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-cream-50 text-gokez-300 dark:bg-slate-800 dark:text-slate-500">
                <Leaf className="h-8 w-8" aria-hidden="true" />
              </div>
            }
          />

          {savings > 0 && !isOutOfStock && (
            <span className="absolute left-1.5 top-1.5 rounded-full border border-saffron-600/45 bg-saffron-400 px-2 py-1 text-[10px] font-extrabold leading-none text-ink shadow-[0_1px_3px_rgba(111,59,19,0.28)]">
              {product.discountPercent}% OFF
            </span>
          )}

          {isOutOfStock && (
            <div className="absolute inset-0 flex items-end justify-center bg-white/65 p-2 dark:bg-slate-800/65">
              <span className="rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold text-white">Out of stock</span>
            </div>
          )}

          {!isOutOfStock && (
            <div className="pointer-events-auto absolute bottom-1.5 right-1.5 z-20">
              <CartQuantityControl
                variant="card"
                quantity={qty}
                disabled={disabled}
                onAdd={() => { addItem(product, product.unit, discountedPrice); onAdd?.(); }}
                onDecrease={() => updateQty(product.id, product.unit, qty - 1)}
              />
            </div>
          )}
        </div>

        <div className="pointer-events-none flex flex-1 flex-col px-2.5 pb-2.5 pt-2">
          <div className="mb-1 min-h-[2.7em]">
            <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3] text-ink dark:text-white">{primaryName}</p>
            {secondaryName && <p className="truncate text-[11px] leading-4 text-gray-500 dark:text-slate-400">{secondaryName}</p>}
          </div>
          <p className="text-[11px] font-medium leading-none text-gray-500 dark:text-slate-400">
            {product.unit}{product.approxWeight ? ` · ${product.approxWeight}` : ''}
          </p>
          <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-2">
            <span className="text-base font-extrabold leading-none text-ink dark:text-white">₹{discountedPrice}</span>
            {savings > 0 && (
              <span className="text-[11px] font-semibold leading-none text-gray-400 line-through dark:text-slate-500">₹{product.price}</span>
            )}
          </div>
        </div>
      </div>

      {showDetail && (
        <ProductDetailSheet product={product} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
