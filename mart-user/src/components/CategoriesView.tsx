import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Category, Product } from '../services/api';
import ProductCard from './ProductCard';
import CategoryIcon from './CategoryIcon';

interface CategoriesViewProps {
  categories: Category[];
  products: Product[];
}

export default function CategoriesView({ categories, products }: CategoriesViewProps) {
  // Hide categories with no visible products for this store
  const visibleCategories = categories.filter(cat => products.some(p => p.categoryId === cat.id));
  const [activeCatId, setActiveCatId] = useState<string>(visibleCategories[0]?.id || '');
  const [search, setSearch] = useState('');

  const filteredProducts = products.filter(p => {
    if (p.categoryId !== activeCatId) return false;
    const q = search.toLowerCase();
    return !search || p.name.toLowerCase().includes(q) || (p.localName ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 8rem)' }}>

      {/* Left sidebar */}
      <div className="w-[72px] sm:w-24 flex-shrink-0 overflow-y-auto bg-gray-50 dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800">
        {visibleCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCatId(cat.id)}
            className={`w-full flex flex-col items-center gap-1 py-3 px-1 border-l-2 transition-colors ${
              activeCatId === cat.id
                ? 'border-emerald-500 bg-white dark:bg-slate-800'
                : 'border-transparent hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            <CategoryIcon icon={cat.icon} name={cat.name} className="w-8 h-8 object-contain" />
            <span className={`text-[9px] font-semibold text-center leading-tight line-clamp-2 ${
              activeCatId === cat.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
            }`}>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Right — products */}
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 px-3 py-2 border-b border-gray-100 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search in this category..."
              className="w-full pl-9 pr-9 py-2 bg-gray-100 dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white dark:focus:bg-slate-700 transition-all border-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
        <div className="p-2 pb-36">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">{search ? 'No matching products' : 'No products in this category'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {filteredProducts.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
