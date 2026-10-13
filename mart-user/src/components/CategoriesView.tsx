import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Category, Product } from '../services/api';
import ProductCard from './ProductCard';
import CategoryIcon from './CategoryIcon';
import { track } from '../utils/track';

interface CategoriesViewProps {
  categories: Category[];
  products: Product[];
}

// Per-category accent so the active tab reads as a colourful highlighter and
// neighbouring categories stay visually distinct.
const ACCENTS = [
  { bar: 'border-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  { bar: 'border-blue-500',    bg: 'bg-blue-50 dark:bg-blue-500/15',       text: 'text-blue-700 dark:text-blue-300' },
  { bar: 'border-violet-500',  bg: 'bg-violet-50 dark:bg-violet-500/15',   text: 'text-violet-700 dark:text-violet-300' },
  { bar: 'border-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/15',     text: 'text-amber-700 dark:text-amber-300' },
  { bar: 'border-rose-500',    bg: 'bg-rose-50 dark:bg-rose-500/15',       text: 'text-rose-700 dark:text-rose-300' },
  { bar: 'border-cyan-500',    bg: 'bg-cyan-50 dark:bg-cyan-500/15',       text: 'text-cyan-700 dark:text-cyan-300' },
  { bar: 'border-orange-500',  bg: 'bg-orange-50 dark:bg-orange-500/15',   text: 'text-orange-700 dark:text-orange-300' },
  { bar: 'border-pink-500',    bg: 'bg-pink-50 dark:bg-pink-500/15',       text: 'text-pink-700 dark:text-pink-300' },
];

function matches(product: Product, query: string): boolean {
  const name = product.name.toLowerCase();
  const local = (product.localName ?? '').toLowerCase();
  const aliases = (product.searchAliases ?? []).map(alias => alias.toLowerCase());
  return name.includes(query) || local.includes(query) || aliases.some(alias => alias.includes(query));
}

export default function CategoriesView({ categories, products }: CategoriesViewProps) {
  // Hide categories with no visible products for this store
  const visibleCategories = categories.filter(cat => products.some(p => p.categoryId === cat.id));
  const [activeCatId, setActiveCatId] = useState<string>(visibleCategories[0]?.id || '');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visibleCategories.some(category => category.id === activeCatId)) {
      setActiveCatId(visibleCategories[0]?.id || '');
    }
  }, [activeCatId, visibleCategories]);

  const activeCategory = visibleCategories.find(category => category.id === activeCatId);
  const query = search.trim().toLowerCase();
  // Search stays inside the selected category — name, Hindi name or any alias.
  const filteredProducts = products.filter(
    product => product.categoryId === activeCatId && (!query || matches(product, query))
  );

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100dvh - var(--kb, 0px) - 8rem)' }}>

      {/* Category sidebar */}
      <div className="w-[72px] sm:w-24 flex-shrink-0 overflow-y-auto bg-gray-50 dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800">
        {visibleCategories.map((cat, index) => {
          const isActive = activeCatId === cat.id;
          const accent = ACCENTS[index % ACCENTS.length];
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveCatId(cat.id); track('category_viewed', { categoryId: cat.id }); }}
              className={`w-full flex flex-col items-center gap-1 py-3 px-1 border-l-2 transition-colors ${
                isActive ? `${accent.bar} ${accent.bg}` : 'border-transparent hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              <CategoryIcon icon={cat.icon} name={cat.name} className="w-8 h-8 object-contain" />
              <span className={`text-[9px] font-semibold text-center leading-tight line-clamp-2 ${
                isActive ? accent.text : 'text-gray-500 dark:text-slate-400'
              }`}>{cat.name}</span>
            </button>
          );
        })}
      </div>

      {/* Right — products */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="sticky top-0 z-30 isolate border-b border-gray-100 bg-white px-2 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              inputMode="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={activeCategory ? `Search in ${activeCategory.name}` : 'Search'}
              className="w-full rounded-xl bg-gray-100 py-2 pl-9 pr-9 text-sm text-gray-900 ring-1 ring-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:placeholder:text-slate-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <div className="p-2 pb-36">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-slate-400">
              <p className="text-sm">{query ? 'No matching products in this category' : 'No products in this category'}</p>
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
