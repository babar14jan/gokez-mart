import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { Category, Product } from '../services/api';
import ProductCard from './ProductCard';
import CategoryIcon from './CategoryIcon';
import { track } from '../utils/track';

interface CategoriesViewProps {
  categories: Category[];
  products: Product[];
  onSearchOpen: () => void;
  searchPrompt: string;
}

export default function CategoriesView({ categories, products, onSearchOpen, searchPrompt }: CategoriesViewProps) {
  // Hide categories with no visible products for this store
  const visibleCategories = categories.filter(cat => products.some(p => p.categoryId === cat.id));
  const [activeCatId, setActiveCatId] = useState<string>(visibleCategories[0]?.id || '');

  useEffect(() => {
    if (!visibleCategories.some(category => category.id === activeCatId)) {
      setActiveCatId(visibleCategories[0]?.id || '');
    }
  }, [activeCatId, visibleCategories]);

  const filteredProducts = products.filter(product => product.categoryId === activeCatId);

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100dvh - var(--kb, 0px) - 8rem)' }}>

      {/* Category sidebar */}
      <div className="w-[72px] sm:w-24 flex-shrink-0 overflow-y-auto bg-gray-50 dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800">
        {visibleCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCatId(cat.id); track('category_viewed', { categoryId: cat.id }); }}
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="sticky top-0 z-30 isolate bg-white px-3 py-2 shadow-sm dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800">
          <button type="button" onClick={onSearchOpen} className="relative w-full text-left">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <span className="block w-full overflow-hidden whitespace-nowrap rounded-xl bg-gray-100 py-2 pl-9 pr-3 text-sm text-gray-500 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-1 dark:ring-slate-600 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text">{searchPrompt}</span></span>
          </button>
        </div>
        <div className="p-2 pb-36">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">No products in this category</p>
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
