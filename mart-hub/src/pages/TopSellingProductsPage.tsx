import { useEffect, useMemo, useState } from 'react';
import { topSellingApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import PageSkeleton from '../components/PageSkeleton';

type Range = '5d' | '10d' | '30d' | 'all' | 'custom';

const RANGE_TABS: { id: Range; label: string; short: string }[] = [
  { id: '5d', label: 'Last 5 days', short: '5D' },
  { id: '10d', label: 'Last 10 days', short: '10D' },
  { id: '30d', label: 'Last 30 days', short: '30D' },
  { id: 'all', label: 'All', short: 'All' },
  { id: 'custom', label: 'Custom', short: 'Custom' },
];

interface TopProduct {
  id: string;
  name: string;
  hindiName: string | null;
  categoryId: string | null;
  categoryName: string;
  orderCount: number;
  quantitySold: number;
  unit: string;
}

export default function TopSellingProductsPage() {
  const storeId = getActiveStoreId();
  const [range, setRange] = useState<Range>('30d');
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<TopProduct[]>([]);

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    let cancelled = false;
    setLoading(true);
    topSellingApi
      .get(range, storeId, range === 'custom' ? customFrom : undefined, range === 'custom' ? customTo : undefined, { fresh: true })
      .then(res => {
        if (cancelled) return;
        const data = res.data?.data || {};
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setProducts(Array.isArray(data.products) ? data.products : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCategories([]);
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range, storeId, customFrom, customTo]);

  useEffect(() => {
    setCategory('All');
  }, [range]);

  const visible = useMemo(
    () => (category === 'All' ? products : products.filter(p => p.categoryName === category)),
    [products, category],
  );

  const categoryTabs = useMemo(() => ['All', ...categories], [categories]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Delivered orders only. Ranked by number of orders.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-700 pb-2">
        {RANGE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRange(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              range === tab.id
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
            }`}
          >
            <span className="sm:hidden">{tab.short}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {categoryTabs.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              category === cat
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <PageSkeleton />
      ) : visible.length === 0 ? (
        <div className="page-card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
          No delivered orders in this period.
        </div>
      ) : (
        <div className="page-card overflow-hidden">
          <div className="grid grid-cols-[3rem_1fr_6rem] gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            <span>#</span>
            <span>Product</span>
            <span className="text-right">Orders</span>
          </div>
          {visible.map((product, index) => (
            <div
              key={product.id}
              className="grid grid-cols-[3rem_1fr_6rem] gap-2 px-4 py-2.5 border-b border-gray-50 dark:border-slate-800 last:border-0 items-center"
            >
              <span className="text-xs font-bold text-gray-500 dark:text-slate-400">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 dark:text-white">{product.name}</p>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">{product.hindiName || '—'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-gray-900 dark:text-white">{product.orderCount}</p>
                <p className="text-[10px] text-gray-500 dark:text-slate-400">{product.quantitySold} {product.unit || 'units'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
