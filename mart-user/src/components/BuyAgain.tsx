import { useEffect, useState } from 'react';
import { authApi } from '../services/api';
import type { Product } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import ProductCard from './ProductCard';

const MAX_ITEMS = 10;
const MIN_ITEMS = 2;

/**
 * "Buy Again" — the customer's own recently ordered items, matched against the
 * live catalogue so prices, discounts and stock are always current. Signed-in
 * customers only: guests have no reliable order history on the device. Renders
 * nothing until there are at least a couple of matches, so the row never looks
 * empty or awkward.
 */
export default function BuyAgain({ products }: { products: Product[] }) {
  const isLoggedIn = useCustomerAuthStore(s => s.isLoggedIn);
  const [productIds, setProductIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoggedIn) { setProductIds([]); return; }
    let cancelled = false;
    authApi.getOrders()
      .then(res => {
        if (cancelled) return;
        const orders = (res.data?.data || []) as any[];
        const ids: string[] = [];
        const seen = new Set<string>();
        for (const order of orders) {
          for (const item of order.items || []) {
            if (!item?.productId || seen.has(item.productId)) continue;
            seen.add(item.productId);
            ids.push(item.productId);
            if (ids.length >= MAX_ITEMS) break;
          }
          if (ids.length >= MAX_ITEMS) break;
        }
        setProductIds(ids);
      })
      .catch(() => { if (!cancelled) setProductIds([]); });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const byId = new Map(products.map(p => [p.id, p]));
  const items = productIds
    .map(id => byId.get(id))
    .filter((p): p is Product => Boolean(p) && p!.availabilityStatus !== 'hidden');

  if (items.length < MIN_ITEMS) return null;

  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-white leading-tight">Your Usuals</h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">Order again in one tap</p>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {items.map(p => (
          <div key={p.id} className="w-[31%] min-w-[118px] sm:w-[150px] flex-shrink-0">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
