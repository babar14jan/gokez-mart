import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronLeft, RefreshCw, Search, X } from 'lucide-react';
import type { Category, Product } from '../services/api';
import CategoryIcon from './CategoryIcon';
import ProductCard from './ProductCard';
import SmartImage from './SmartImage';
import PageHeader from './PageHeader';
import BottomNav from './BottomNav';
import FloatingCart from './FloatingCart';
import { loadRecentSearches, recordRecentSearch, clearRecentSearches } from '../utils/recentSearches';
import { loadRecentlyViewedIds } from '../utils/recentlyViewed';
import { track } from '../utils/track';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';

interface CatalogSearchSheetProps {
  categories: Category[];
  products: Product[];
  searchPrompt: string;
  autoFocus?: boolean;
  /** `fresh` renders the admin-configured Fresh tabs; `catalog` keeps search. */
  mode?: 'catalog' | 'fresh';
  /** Ordered category slugs for the Fresh tabs (from the Home Section config). */
  freshCategorySlugs?: string[];
  freshColumns?: number | null;
  freshLimit?: number | null;
  freshLayout?: 'row' | 'grid';
  onClose: () => void;
  onOpenCart: () => void;
  onRefresh: () => Promise<void>;
  /** Render as an in-flow page (no overlay chrome); the app shell provides header/cart/nav. */
  inline?: boolean;
  /** Active app view, so the in-search bottom nav can highlight the current tab. */
  activeView?: 'home' | 'categories' | 'orders' | 'account';
  /** Close the search and hand the tab change to the parent (returns to the page). */
  onNavigate?: (view: 'home' | 'categories' | 'orders' | 'account') => void;
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

export default function CatalogSearchSheet({
  categories, products, searchPrompt, autoFocus = true,
  mode = 'catalog', freshCategorySlugs, freshColumns = 3, freshLimit = null, freshLayout = 'grid',
  onClose, onOpenCart, onRefresh,
  activeView, onNavigate,
  inline = false,
}: CatalogSearchSheetProps) {
  const freshMode = mode === 'fresh';
  const [search, setSearch] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() => loadRecentlyViewedIds());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const { ref: inputRef, dismiss: dismissKeyboard, onKeyDown: handleKeyDown, onSurfaceClick: handleSurfaceClick } = useKeyboardDismiss();
  const query = search.trim().toLowerCase();
  const placeholder = freshMode ? 'Search Fresh Vegetables and Fruits' : searchPrompt;
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const categoriesWithProducts = useMemo(
    () => categories.filter(category => products.some(product => product.categoryId === category.id)),
    [categories, products]
  );
  // Fresh tabs: the configured slugs, in order, limited to categories that
  // actually have products. No "All products" tab by design.
  const freshTabs = useMemo(() => {
    if (!freshMode) return [] as Category[];
    const bySlug = new Map(categoriesWithProducts.map(category => [String(category.slug).toLowerCase(), category]));
    return (freshCategorySlugs || [])
      .map(slug => bySlug.get(String(slug).toLowerCase()))
      // A tab whose only products are combos would render empty (combos are
      // excluded from Fresh), so drop it up front.
      .filter((category): category is Category =>
        Boolean(category) && products.some(product => product.categoryId === category!.id && !product.isBundle)
      );
  }, [freshMode, freshCategorySlugs, categoriesWithProducts, products]);
  // The catalogue opens on a concrete category instead of an "All" view.
  // Fresh starts on its first configured tab; search falls back to Vegetables,
  // then the first category that has products.
  const defaultCategoryId = useMemo(() => {
    if (freshMode) return freshTabs[0]?.id || null;
    const vegetables = categoriesWithProducts.find(
      category => String(category.slug).toLowerCase() === 'vegetables'
    );
    return vegetables?.id || categoriesWithProducts[0]?.id || null;
  }, [freshMode, freshTabs, categoriesWithProducts]);

  // Live matches, closest keyword first. Recomputed on every keystroke — the
  // catalogue already lives on the client, so no request is needed.
  const results = useMemo(() => {
    if (!query) return [] as Product[];
    return products
      .filter(product => !freshMode || !product.isBundle)
      .map((product, index) => ({ product, index, score: matchScore(product, query) }))
      .filter(entry => entry.score < 7)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(entry => entry.product);
  }, [products, query]);
  const suggestions = results.slice(0, 8);
  // Before the effect below has run (or while categories are still loading),
  // fall back to the default so the sheet never flashes an "all products" grid.
  const activeCategoryId = categoryId ?? defaultCategoryId;
  const displayed = useMemo(() => {
    if (query) return results;
    // Fresh never falls back to "all products": if no configured tab resolves,
    // the page is empty rather than leaking the rest of the catalogue.
    if (freshMode && !activeCategoryId) return [] as Product[];
    if (!freshMode && !query) return [] as Product[];
    const list = products.filter(product =>
      (!freshMode || !product.isBundle) &&
      (!activeCategoryId || product.categoryId === activeCategoryId)
    );
    return freshMode && freshLimit && freshLimit > 0 ? list.slice(0, freshLimit) : list;
  }, [query, results, products, activeCategoryId, freshMode, freshLimit]);
  const gridCols = !query && freshMode && freshLayout === 'grid'
    ? freshColumns === 2 ? 'grid-cols-2 md:grid-cols-6' : freshColumns === 4 ? 'grid-cols-4 md:grid-cols-6' : 'grid-cols-3 md:grid-cols-6'
    : 'grid-cols-3 sm:grid-cols-5 md:grid-cols-6';
  const recentlyViewedProducts = useMemo(
    () => recentlyViewedIds.map(id => products.find(p => p.id === id)).filter((p): p is Product => Boolean(p)),
    [recentlyViewedIds, products]
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

  useEffect(() => {
    if (!defaultCategoryId) return;
    if (!categoryId || !categoriesWithProducts.some(category => category.id === categoryId)) {
      setCategoryId(defaultCategoryId);
    }
  }, [categoryId, categoriesWithProducts, defaultCategoryId]);

  useEffect(() => {
    const refreshRecent = () => setRecentSearches(loadRecentSearches());
    const refreshViewed = () => setRecentlyViewedIds(loadRecentlyViewedIds());
    window.addEventListener('mart:recent-searches', refreshRecent);
    window.addEventListener('mart:recently-viewed', refreshViewed);
    window.addEventListener('storage', refreshRecent);
    window.addEventListener('storage', refreshViewed);
    return () => {
      window.removeEventListener('mart:recent-searches', refreshRecent);
      window.removeEventListener('mart:recently-viewed', refreshViewed);
      window.removeEventListener('storage', refreshRecent);
      window.removeEventListener('storage', refreshViewed);
    };
  }, []);

  const selectCategory = (id: string) => {
    setCategoryId(id);
    setSearch('');
  };
  const recordSearch = (term: string) => {
    const next = recordRecentSearch(term);
    setRecentSearches(next);
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(event);
    if (event.key === 'Enter' && search.trim()) recordSearch(search.trim());
  };

  useEffect(() => {
    if (inline) return;
    const resultsElement = resultsRef.current;
    if (!resultsElement) return;

    const cancelPull = () => {
      pullStart.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };
    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1 || resultsElement.scrollTop !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
      const touch = event.touches[0];
      pullStart.current = { x: touch.clientX, y: touch.clientY };
    };
    const onTouchMove = (event: TouchEvent) => {
      const start = pullStart.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const deltaY = touch.clientY - start.y;
      const deltaX = Math.abs(touch.clientX - start.x);
      if (deltaY <= 0 || deltaX > Math.max(16, deltaY * 0.6)) {
        cancelPull();
        return;
      }
      event.preventDefault();
      pullDistanceRef.current = Math.min(deltaY, 76);
      setPullDistance(pullDistanceRef.current);
    };
    const onTouchEnd = () => {
      const shouldRefresh = pullDistanceRef.current >= 76;
      cancelPull();
      if (!shouldRefresh || refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      const startedAt = Date.now();
      onRefresh().catch(() => undefined).finally(() => {
        window.setTimeout(() => {
          refreshingRef.current = false;
          setRefreshing(false);
        }, Math.max(0, 450 - (Date.now() - startedAt)));
      });
    };

    resultsElement.addEventListener('touchstart', onTouchStart, { passive: true });
    resultsElement.addEventListener('touchmove', onTouchMove, { passive: false });
    resultsElement.addEventListener('touchend', onTouchEnd);
    resultsElement.addEventListener('touchcancel', cancelPull);
    return () => {
      resultsElement.removeEventListener('touchstart', onTouchStart);
      resultsElement.removeEventListener('touchmove', onTouchMove);
      resultsElement.removeEventListener('touchend', onTouchEnd);
      resultsElement.removeEventListener('touchcancel', cancelPull);
    };
  }, [onRefresh]);

  return (
    <div className={inline ? "flex flex-col" : "fixed inset-0 z-50 md:top-[calc(3.5rem+env(safe-area-inset-top,0px)+1px)] md:z-30"} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-label="Search products" onClick={inline ? undefined : handleSurfaceClick}>
      <section className={inline ? "flex flex-col bg-white dark:bg-slate-900" : "absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900"}>
        {!inline && (<div className={`shrink-0 ${(!freshMode && query) ? 'bg-yellow-100/60 dark:bg-yellow-950/40' : 'bg-white dark:bg-slate-900'}`}>
          {/* Mobile chrome only. On desktop the site header stays visible above
              the search page, so its cart is the shopper's cart — no need to
              repeat it in the search bar. */}
          <div className="md:hidden">
            {freshMode ? (
              <PageHeader onBack={onClose} backLabel="Back to home" position="static" backStyle="square" backSize="sm" />
            ) : (
            <PageHeader onBack={onClose} backLabel="Back to home" position="static" backStyle="square" backSize="sm">
              <div className="relative min-w-0 flex-1">
                <input ref={inputRef} autoFocus={autoFocus} type="text" inputMode="search" enterKeyHint="search"
                  value={search} onChange={event => setSearch(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={placeholder}
                  className="w-full rounded-xl border-0 bg-white py-2 pl-4 pr-11 text-sm text-gray-900 shadow-sm ring-1 ring-black/5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-white/70 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:placeholder:text-slate-400 dark:focus:ring-slate-500" />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="Clear product search"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                    <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </PageHeader>
            )}
          </div>

          {/* Desktop: the search field lives in the page body, under the site
              header, with a "Back to home" control on its left. */}
          <div className="mx-auto hidden w-full max-w-6xl items-center gap-2 px-3 pb-4 pt-4 sm:px-6 md:flex lg:px-8">
            <button type="button" onClick={onClose} aria-label="Back to home"
              className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gray-100 px-3 py-3.5 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600">
              <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              <span>Back to home</span>
            </button>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-gray-400 dark:text-slate-400" />
              <input autoFocus={autoFocus} type="text" inputMode="search" enterKeyHint="search"
                value={search} onChange={event => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={placeholder}
                className="w-full rounded-2xl border-0 bg-gray-100 py-3.5 pl-11 pr-11 text-sm text-gray-900 ring-1 ring-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gokez-700/40 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:placeholder:text-slate-400" />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear product search"
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>

        </div>
        )} 

        {/* Live suggestions — compact white rows, shown whenever typing. */}
        {!inline && query && suggestions.length > 0 && (
          <div className="border-b border-yellow-200/60 px-3 pt-2 dark:border-yellow-900/40">
            <div className="mx-auto max-h-56 w-full max-w-6xl space-y-1 overflow-y-auto md:px-6 lg:px-8" onScroll={dismissKeyboard}>
              {suggestions.map(product => {
                const category = categoryById.get(product.categoryId);
                const localName = product.localName?.trim() && product.localName.trim() !== product.name.trim()
                  ? product.localName.trim()
                  : '';
                return (
                  <button type="button" key={product.id} onClick={() => { setSearch(product.name); recordSearch(product.name); dismissKeyboard(); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-yellow-200/50 active:bg-yellow-200/70 dark:hover:bg-yellow-900/30">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-100 dark:bg-slate-800 dark:ring-slate-600">
                      <SmartImage
                        src={product.smallUrl || product.thumbnailUrl || product.photoVariants?.[0]?.smallUrl || product.photoVariants?.[0]?.thumbnailUrl || product.photoUrl}
                        alt=""
                        className="h-full w-full"
                        imgClassName="object-cover"
                        fallback={<CategoryIcon icon={category?.icon || ''} name={category?.name || product.name} className="h-5 w-5 object-contain" />}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
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

        <div ref={resultsRef} className={`relative mx-auto w-full max-w-6xl bg-white px-3 dark:bg-slate-900 md:px-6 lg:px-8 ${inline ? "" : "min-h-0 flex-1 overflow-y-auto overscroll-y-contain"} ${freshMode ? "pt-1 pb-[calc(7rem+env(safe-area-inset-bottom,0px))]" : "pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"}`} onScroll={dismissKeyboard}>
          {(refreshing || pullDistance > 0) && (
            <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2" style={{ opacity: refreshing ? 1 : Math.min(1, pullDistance / 40) }} aria-live="polite">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-md ring-1 ring-black/5 dark:bg-slate-800/90 dark:ring-white/10">
                <RefreshCw className={`h-4 w-4 text-emerald-600 dark:text-emerald-300 ${refreshing || pullDistance >= 76 ? 'animate-spin' : ''}`} style={refreshing || pullDistance >= 76 ? undefined : { transform: `rotate(${pullDistance * 4}deg)` }} aria-hidden="true" />
              </div>
            </div>
          )}
          {freshMode && (
            <div className="sticky top-14 z-40 -mx-3 mb-2 bg-white px-3 py-1 dark:bg-slate-900 md:mx-0 md:px-0">
              <div className="relative">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="search"
                    enterKeyHint="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder=""
                    aria-label={placeholder}
                    className="w-full rounded-xl bg-gray-100 py-2 pl-9 pr-9 text-sm text-gray-900 ring-1 ring-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gokez-700/40 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:placeholder:text-slate-400"
                  />
                  {!search && (
                    <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-slate-400">
                      Search Fresh <span className="font-bold text-gray-600 dark:text-slate-300">Vegetables</span> and <span className="font-bold text-gray-600 dark:text-slate-300">Fruits</span>
                    </span>
                  )}
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear product search"
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
                {inline && query && suggestions.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-yellow-200/60 bg-white dark:border-yellow-900/40 dark:bg-slate-800">
                    <div className="space-y-1 px-2 py-2">
                      {suggestions.map(product => {
                        const category = categoryById.get(product.categoryId);
                        const localName = product.localName?.trim() && product.localName.trim() !== product.name.trim()
                          ? product.localName.trim()
                          : '';
                        return (
                          <button type="button" key={product.id} onClick={() => { setSearch(product.name); recordSearch(product.name); dismissKeyboard(); }}
                            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-yellow-200/50 active:bg-yellow-200/70 dark:hover:bg-yellow-900/30">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 ring-1 ring-gray-100 dark:bg-slate-800 dark:ring-slate-600">
                              <SmartImage
                                src={product.smallUrl || product.thumbnailUrl || product.photoVariants?.[0]?.smallUrl || product.photoVariants?.[0]?.thumbnailUrl || product.photoUrl}
                                alt=""
                                className="h-full w-full"
                                imgClassName="object-cover"
                                fallback={<CategoryIcon icon={category?.icon || ''} name={category?.name || product.name} className="h-5 w-5 object-contain" />}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
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
            </div>
          )}

          {/* Fresh: only the admin-configured category tabs. Hidden while
              searching so results span the whole catalogue (point 5). */}
          {!query && freshMode && freshTabs.length > 0 && (
            <section className="mb-5">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {freshTabs.map(category => {
                  const selected = category.id === activeCategoryId;
                  return (
                    <button type="button" key={category.id} onClick={() => selectCategory(category.id)}
                      className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 transition-colors ${
                        selected
                          ? 'border-gokez-700 bg-gokez-50 text-gokez-800 dark:bg-gokez-950/20 dark:text-gokez-300'
                          : 'border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}>
                      <CategoryIcon icon={category.icon} name={category.name} className="h-6 w-6 object-contain" />
                      <span className="whitespace-nowrap text-xs font-semibold leading-tight">{category.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Live product results. */}
          <section>
            {(!query && !freshMode) ? null : (
            <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">
              {query
                ? `Showing results for “${search.trim()}”`
                : freshMode
                  ? categoryById.get(activeCategoryId ?? '')?.name || 'Products'
                  : 'Products'}
            </h2>
            )}
            {displayed.length ? (
              freshMode && !query && freshLayout === 'row' ? (
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 scrollbar-hide md:mx-0 md:grid md:grid-cols-6 md:gap-2.5 md:overflow-visible md:px-0 md:pb-0">
                  {displayed.map(product => (
                    <div key={product.id} className="w-[calc((100%-1.25rem)/2.85)] min-w-[calc((100%-1.25rem)/2.85)] flex-shrink-0 md:w-auto md:min-w-0 md:shrink">
                      <ProductCard product={product} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`grid ${gridCols} gap-2.5`}>
                  {displayed.map(product => <ProductCard key={product.id} product={product} />)}
                </div>
              )
            ) : (!query && !freshMode) ? (
              <div className="space-y-6">
                {recentSearches.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Recent searches</h3>
                      <button type="button" onClick={() => { clearRecentSearches(); setRecentSearches([]); }}
                        className="text-xs font-semibold text-gokez-700 dark:text-gokez-300">
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentSearches.map(term => (
                        <button key={term} type="button" onClick={() => setSearch(term)}
                          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                          {term}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {recentlyViewedProducts.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Continue browsing</h3>
                    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6">
                      {recentlyViewedProducts.map(product => <ProductCard key={product.id} product={product} />)}
                    </div>
                  </section>
                )}
                {products.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">Popular picks</h3>
                    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6">
                      {products.slice(0, 12).map(product => <ProductCard key={product.id} product={product} />)}
                    </div>
                  </section>
                )}
                {recentSearches.length === 0 && recentlyViewedProducts.length === 0 && products.length === 0 && (
                  <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">Start typing to search…</p>
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
                {query ? `No products found for “${search.trim()}”` : 'No products in this category'}
              </p>
            )}
          </section>
        </div>
        {freshMode && !inline && <FloatingCart onOpen={onOpenCart} />}
        {freshMode && !inline && (
        <div className="shrink-0 border-t border-gray-200 bg-[#f7f8fa] dark:border-slate-800 dark:bg-slate-900 sm:hidden">
          <BottomNav
            active={activeView ?? 'home'}
            onChange={(v) => { onClose(); onNavigate?.(v); }}
            onOpenSearch={() => onClose()}
            freshActive={freshMode}
          />
        </div>
        )}
      </section>
    </div>
  );
}
