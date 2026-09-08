import { useState } from 'react';
import type { Category, Product } from '../services/api';
import ProductCard from './ProductCard';
import CategoryIcon from './CategoryIcon';

interface CategoriesViewProps {
  categories: Category[];
  products: Product[];
}

export default function CategoriesView({ categories, products }: CategoriesViewProps) {
  const [activeCatId, setActiveCatId] = useState<string>(categories[0]?.id || '');

  const filteredProducts = products.filter(p => p.categoryId === activeCatId);

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden">

      {/* Left sidebar */}
      <div className="w-[72px] sm:w-24 flex-shrink-0 overflow-y-auto bg-gray-50 dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800">
        {categories.map(cat => (
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
        <div className="p-2 pb-36">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
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
