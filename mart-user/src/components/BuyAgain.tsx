import { useEffect, useState } from 'react';
import { authApi } from '../services/api';
import type { Product } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import ProductCard from './ProductCard';
import SectionHeading from './ui/SectionHeading';

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
    <section className="mb-6" aria-label="Your usual items">
      <SectionHeading title="Your usuals" subtitle="Order again in one tap" />
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {items.map(p => (
          <div key={p.id} className="w-[43%] min-w-[140px] flex-shrink-0 sm:w-[170px]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
