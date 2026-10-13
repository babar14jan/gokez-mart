import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import type { Category, Product } from '../services/api';
import CategoryIcon from './CategoryIcon';
import ProductCard from './ProductCard';
import ProductDetailSheet from './ProductDetailSheet';

interface CatalogSearchSheetProps {
  categories: Category[];
  products: Product[];
  searchPrompt: string;
  onClose: () => void;
}

function productMatches(product: Product, query: string): boolean {
  return product.name.toLowerCase().includes(query)
    || (product.localName ?? '').toLowerCase().includes(query)
    || (product.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query));
}

export default function CatalogSearchSheet({ categories, products, searchPrompt, onClose }: CatalogSearchSheetProps) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const query = search.trim().toLowerCase();
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const categoriesWithProducts = useMemo(
    () => categories.filter(category => products.some(product => product.categoryId === category.id)),
    [categories, products]
  );
  const visibleProducts = useMemo(() => products.filter(product => {
    if (query && !productMatches(product, query)) return false;
    return !categoryId || product.categoryId === categoryId;
  }), [products, query, categoryId]);
  const topMatches = query ? visibleProducts.slice(0, 5) : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const selectCategory = (id: string) => {
    setCategoryId(current => current === id ? null : id);
    setSearch('');
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search products">
      <button type="button" aria-label="Close product search" onClick={onClose}
        className="absolute inset-0 hidden bg-slate-900/40 backdrop-blur-sm sm:block" />
      <section className="absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 sm:left-auto sm:w-full sm:max-w-md sm:shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={onClose} aria-label="Back to home"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-slate-700 dark:hover:bg-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <input autoFocus type="text" inputMode="search" value={search} onChange={event => { setSearch(event.target.value); setCategoryId(null); }}
              placeholder={searchPrompt}
              className="h-11 w-full rounded-xl border-0 bg-gray-100 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-300" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear product search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-3 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-4 dark:bg-slate-900">
          {!query && categoriesWithProducts.length > 1 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Browse categories</h2>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {categoriesWithProducts.slice(0, 5).map(category => {
                  const selected = category.id === categoryId;
                  return (
                    <button type="button" key={category.id} onClick={() => selectCategory(category.id)}
                      className={`flex min-w-[78px] flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : 'border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}>
                      <CategoryIcon icon={category.icon} name={category.name} className="h-7 w-7 object-contain" />
                      <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{category.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {topMatches.length > 0 && (
            <section className="mb-4">
              <div className="space-y-1.5">
                {topMatches.map(product => {
                  const category = categoryById.get(product.categoryId);
                  return (
                    <button type="button" key={product.id} onClick={() => setSelectedProduct(product)}
                      className="flex w-full items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-left transition-colors hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 dark:bg-slate-800">
                        {product.photoUrl
                          ? <img src={product.photoUrl} alt="" className="h-full w-full object-cover" />
                          : <CategoryIcon icon={category?.icon || ''} name={category?.name || product.name} className="h-6 w-6 object-contain" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{product.name}</p>
                        {product.localName && product.localName.trim() !== product.name.trim() && (
                          <p className="truncate text-xs text-gray-500 dark:text-slate-400">{product.localName}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">{query ? 'All results' : categoryId ? categoryById.get(categoryId)?.name || 'Products' : 'All products'}</h2>
            {visibleProducts.length ? (
              <div className="grid grid-cols-2 gap-2.5">
                {visibleProducts.map(product => <ProductCard key={product.id} product={product} />)}
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">No matching products</p>
            )}
          </section>
        </div>
      </section>

      {selectedProduct && <ProductDetailSheet product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
    </div>
  );
}