import { ArrowLeft, Tag } from 'lucide-react';
import type { Product } from '../services/api';
import ProductCard from '../components/ProductCard';

interface DealsPageProps {
  products: Product[];
  onBack: () => void;
}

export default function DealsPage({ products, onBack }: DealsPageProps) {
  const deals = products
    .filter(p => (p.discountPercent || 0) > 0 && p.availabilityStatus !== 'hidden')
    .sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 pt-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 -ml-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-slate-200" />
        </button>
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <Tag className="w-5 h-5 text-red-500" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Today&apos;s Deals</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">Limited-time price drops on everyday essentials</p>
          </div>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-3">🏷️</div>
          <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">No deals right now</p>
          <p className="text-sm text-gray-500 dark:text-slate-400">Check back soon — fresh offers are added often.</p>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {deals.length} deal{deals.length !== 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {deals.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
