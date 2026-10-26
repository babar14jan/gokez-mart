import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ShoppingCart } from 'lucide-react';
import type { Category, Product } from '../services/api';
import CategoryIcon from './CategoryIcon';
import ProductCard from './ProductCard';
import SmartImage from './SmartImage';
import PageHeader from './PageHeader';
import { useCartStore } from '../store/cartStore';
import { track } from '../utils/track';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';

interface CatalogSearchSheetProps {
  categories: Category[];
  products: Product[];
  searchPrompt: string;
  autoFocus?: boolean;
  onClose: () => void;
  onOpenCart: () => void;
}

/**
 * Ranks a product against the search query so the closest keyword matches sort
 * first. Lower is better; 7 means "no match". Exact and prefix name matches
 * outrank local-name and alias matches, which outrank plain "contains" matches.
 */
function matchScore(product: Product, query: string): number {
  const name = product.name.trim().toLowerCase();
  const local = (product.localName ?? '').trim().toLowerCase();
  const aliases = (product.searchAliases ?? []).map(alias => alias.toLowerCase());
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (local.startsWith(query)) return 2;
  if (aliases.some(alias => alias.startsWith(query))) return 3;
  if (name.includes(query)) return 4;
  if (local.includes(query)) return 5;
  if (aliases.some(alias => alias.includes(query))) return 6;
  return 7;
}

export default function CatalogSearchSheet({ categories, products, searchPrompt, autoFocus = true, onClose, onOpenCart }: CatalogSearchSheetProps) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const totalItems = useCartStore(s => s.totalItems());
  const { ref: inputRef, dismiss: dismissKeyboard, onKeyDown: handleKeyDown, onSurfaceClick: handleSurfaceClick } = useKeyboardDismiss();
  const query = search.trim().toLowerCase();
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const categoriesWithProducts = useMemo(
    () => categories.filter(category => products.some(product => product.categoryId === category.id)),
    [categories, products]
  );
  // Live matches, closest keyword first. Recomputed on every keystroke — the
  // catalogue already lives on the client, so no request is needed.
  const results = useMemo(() => {
    if (!query) return [] as Product[];
    return products
      .map((product, index) => ({ product, index, score: matchScore(product, query) }))
      .filter(entry => entry.score < 7)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(entry => entry.product);
  }, [products, query]);
  const suggestions = results.slice(0, 8);
  const displayed = useMemo(
    () => (query ? results : products.filter(product => !categoryId || product.categoryId === categoryId)),
    [query, results, products, categoryId]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Record a search once the shopper pauses on a query, and flag the ones that
  // returned nothing so the catalogue's real gaps are visible. The typed text is
  // never sent -- only the result count -- so a phone number typed in the box
  // can never reach the analytics table.
  const lastTrackedQuery = useRef('');
  useEffect(() => {
    if (query.length < 2) return;
    const timer = setTimeout(() => {
      if (lastTrackedQuery.current === query) return;
      lastTrackedQuery.current = query;
      track('product_search', { itemCount: results.length });
      if (results.length === 0) track('search_zero_results');
    }, 700);
    return () => clearTimeout(timer);
  }, [query, results.length]);

  const selectCategory = (id: string) => {
    setCategoryId(current => current === id ? null : id);
    setSearch('');
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search products" onClick={handleSurfaceClick}>
      <button type="button" aria-label="Close product search" onClick={onClose}
        className="absolute inset-0 hidden bg-slate-900/40 backdrop-blur-sm sm:block" />
      <section className="absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 sm:left-auto sm:w-full sm:max-w-md sm:shadow-2xl">
        <div className={`shrink-0 ${query ? 'bg-yellow-100/60 dark:bg-yellow-950/40' : 'bg-white dark:bg-slate-900'}`}>
          <PageHeader onBack={onClose} backLabel="Back to home" position="static" backStyle="square" backSize="sm">
            <div className="relative min-w-0 flex-1">
              <input ref={inputRef} autoFocus={autoFocus} type="text" inputMode="search" enterKeyHint="search"
                value={search} onChange={event => { setSearch(event.target.value); setCategoryId(null); }}
                onKeyDown={handleKeyDown}
                placeholder={searchPrompt}
                className="w-full rounded-xl border-0 bg-white py-2 pl-4 pr-11 text-sm text-gray-900 shadow-sm ring-1 ring-black/5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-white/70 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:placeholder:text-slate-400 dark:focus:ring-slate-500" />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear product search"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>

            {/* Cart — appears only once the shopper has added something; taps straight to checkout. */}
            {totalItems > 0 && (
              <button type="button" onClick={onOpenCart} aria-label={`View cart, ${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
                className="relative mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10">
                <ShoppingCart className="h-6 w-6" />
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-[#14532d] ring-1 ring-black/5">
                  {totalItems}
                </span>
              </button>
            )}
          </PageHeader>

          {/* Live suggestions — compact white rows inside the yellow search area, bounded so results stay reachable. */}
          {query && suggestions.length > 0 && (
            <div className="border-b border-yellow-200/60 px-3 pt-2 dark:border-yellow-900/40">
              <div className="max-h-56 space-y-1 overflow-y-auto" onScroll={dismissKeyboard}>
                {suggestions.map(product => {
                  const category = categoryById.get(product.categoryId);
                  const localName = product.localName?.trim() && product.localName.trim() !== product.name.trim()
                    ? product.localName.trim()
                    : '';
                  return (
                    <button type="button" key={product.id} onClick={() => { setSearch(product.name); dismissKeyboard(); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-yellow-200/50 active:bg-yellow-200/70 dark:hover:bg-yellow-900/30">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-100 dark:bg-slate-800 dark:ring-slate-600">
                        <SmartImage
                          src={product.photoUrl}
                          alt=""
                          className="h-full w-full"
                          imgClassName="object-cover"
                          fallback={<CategoryIcon icon={category?.icon || ''} name={category?.name || product.name} className="h-5 w-5 object-contain" />}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        {/* Two lines rather than one: the label carries the
                            Hindi name as well, and a single truncated line cut
                            it off for most products. */}
                        <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">
                          {product.name}
                          {localName && <span> ({localName})</span>}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 dark:bg-slate-900" onScroll={dismissKeyboard}>
          {/* Initial state (empty query): browse categories. */}
          {!query && categoriesWithProducts.length > 1 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Browse categories</h2>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                <button type="button" onClick={() => setCategoryId(null)}
                  className={`flex min-w-[78px] flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors ${
                    categoryId === null
                      ? 'border-gokez-700 bg-gokez-50 text-gokez-800 dark:bg-gokez-950/20 dark:text-gokez-300'
                      : 'border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-current/10"><ShoppingCart className="h-4 w-4" /></span>
                  <span className="line-clamp-2 text-[10px] font-semibold leading-tight">All products</span>
                </button>
                {categoriesWithProducts.slice(0, 5).map(category => {
                  const selected = category.id === categoryId;
                  return (
                    <button type="button" key={category.id} onClick={() => selectCategory(category.id)}
                      className={`flex min-w-[78px] flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors ${
                        selected
                          ? 'border-gokez-700 bg-gokez-50 text-gokez-800 dark:bg-gokez-950/20 dark:text-gokez-300'
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

          {/* Live product results. */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">
              {query
                ? `Showing results for “${search.trim()}”`
                : categoryId ? categoryById.get(categoryId)?.name || 'Products' : 'All products'}
            </h2>
            {displayed.length ? (
              <div className="grid grid-cols-3 gap-2.5">
                {displayed.map(product => <ProductCard key={product.id} product={product} />)}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">No products found for “{search.trim()}”</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
