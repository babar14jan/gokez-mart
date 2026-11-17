import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import type { Category, Product } from '../services/api';
import ProductCard from './ProductCard';
import CategoryIcon from './CategoryIcon';
import { track } from '../utils/track';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';
import { usePageBottom } from '../utils/pageBottom';

interface CategoriesViewProps {
  categories: Category[];
  products: Product[];
  initialCategoryId?: string | null;
  initialCategorySlug?: string | null;
  loading?: boolean;
  onEmpty: () => void;
  /**
   * The products pane is this page's ONLY scroller (the outer .app-scroll
   * never moves). App attaches the shared chrome hook to it, so the header
   * delivery row and bottom nav hide/return on this page exactly as they do
   * everywhere else.
   */
  paneScrollRef?: Ref<HTMLDivElement>;
}

// Per-category accent so the active tab reads as a colourful highlighter and
// neighbouring categories stay visually distinct.
const ACCENTS = [
  { bar: 'bg-gokez-700', text: 'text-gokez-800 dark:text-gokez-300' },
  { bar: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300' },
  { bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
  { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  { bar: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300' },
  { bar: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-300' },
  { bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300' },
  { bar: 'bg-pink-500', text: 'text-pink-700 dark:text-pink-300' },
];

function matches(product: Product, query: string): boolean {
  const name = product.name.toLowerCase();
  const local = (product.localName ?? '').toLowerCase();
  const aliases = (product.searchAliases ?? []).map(alias => alias.toLowerCase());
  return name.includes(query) || local.includes(query) || aliases.some(alias => alias.includes(query));
}

export default function CategoriesView({ categories, products, initialCategoryId, initialCategorySlug, loading = false, onEmpty, paneScrollRef }: CategoriesViewProps) {
  // Hide categories with no visible products for this store
  const visibleCategories = useMemo(
    () => categories.filter(category => products.some(product => product.categoryId === category.id)),
    [categories, products],
  );
  const getInitial = () => {
    if (initialCategoryId && visibleCategories.some(c=>c.id===initialCategoryId)) return initialCategoryId;
    if (initialCategorySlug) {
      const found = visibleCategories.find(c=>String(c.slug).toLowerCase()===String(initialCategorySlug).toLowerCase());
      if (found) return found.id;
    }
    return visibleCategories[0]?.id || '';
  };
  const [activeCatId, setActiveCatId] = useState<string>(getInitial());
  const [search, setSearch] = useState('');
  const appliedInitialSelection = useRef<string | null>(null);
  const { ref: inputRef, dismiss, onKeyDown, onSurfaceClick } = useKeyboardDismiss();
  // Same end clearance as Home/Fresh: the floating cart overlays the bottom of
  // the scroll area, so without this the last product card sat behind it.
  const pageBottom = usePageBottom();
  // Same as Fresh: the search row is portaled into the fixed header band
  // ("band-search-slot" in Navbar) so it sits above the scrollport — full-bleed
  // like Home's row 2, with no scrollbar indicator overlapping it. Resolved
  // after commit, before paint, so it never flickers. Falls back to an inline
  // sticky row when the band is not rendered (embed mode).
  const [bandSlot, setBandSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setBandSlot(document.getElementById('band-search-slot'));
  }, []);

  useEffect(() => {
    const selectionKey = initialCategoryId
      ? `id:${initialCategoryId}`
      : initialCategorySlug
        ? `slug:${initialCategorySlug.toLowerCase()}`
        : '';

    if (selectionKey && appliedInitialSelection.current !== selectionKey) {
      const targetId = initialCategoryId && visibleCategories.some(category => category.id === initialCategoryId)
        ? initialCategoryId
        : visibleCategories.find(category => String(category.slug).toLowerCase() === String(initialCategorySlug).toLowerCase())?.id;
      if (targetId) {
        appliedInitialSelection.current = selectionKey;
        setActiveCatId(targetId);
        return;
      }
    }

    if (!selectionKey) appliedInitialSelection.current = selectionKey;
    if (!visibleCategories.some(category => category.id === activeCatId)) {
      setActiveCatId(visibleCategories[0]?.id || '');
    }
  }, [initialCategoryId, initialCategorySlug, visibleCategories, activeCatId]);

  const query = search.trim().toLowerCase();
  // A search is always catalogue-wide — name, Hindi name or any alias — even
  // while a category tab is open. With no query the active tab's products show.
  const filteredProducts = query
    ? products.filter(product => matches(product, query))
    : products.filter(product => product.categoryId === activeCatId);
  const redirected = useRef(false);

  useEffect(() => {
    if (loading || query || redirected.current) return;
    const hasActiveCategory = visibleCategories.some(category => category.id === activeCatId);
    if (!hasActiveCategory && visibleCategories.length > 0) return;
    if (hasActiveCategory && filteredProducts.length > 0) return;
    redirected.current = true;
    onEmpty();
  }, [loading, query, activeCatId, visibleCategories, filteredProducts.length, onEmpty]);

  // One search field, rendered either in the band (normal) or in a sticky row
  // inside the pane (embed fallback) — identical markup, same state.
  const searchField = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-gray-900 dark:text-white" />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search any product, all categories"
        aria-label="Search any product, all categories"
        className="w-full rounded-xl border border-white/70 bg-white py-2.5 pl-10 pr-9 text-sm text-gray-900 shadow-sm placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-white/70 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-300"
      />
      {search && (
        <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Search row in the fixed band — same place and styling as Home's row 2
          and the Fresh page, so it is full-bleed and no scrollbar can overlap
          it. */}
      {bandSlot && createPortal(
        <div className="bg-gokez-700 dark:bg-[#18191a]">
          <div className="mx-auto w-full max-w-6xl page-x py-1">
            {searchField}
          </div>
        </div>,
        bandSlot,
      )}
      <div className="categories-pane app-bleed-x flex overflow-hidden" onClick={onSurfaceClick}>

      {/* Category sidebar. scrollbar-hide: the rail still scrolls (wheel/touch)
          but draws no scrollbar of its own, so Categories shows exactly ONE
          scrollbar — the products pane's, at the screen's right edge — the same
          pattern as Home/Fresh. app-bleed-x on the pane above makes the rail
          start flush at the screen's left edge, over .app-scroll's stable
          scrollbar gutter. */}
      <div className="categories-scroll scrollbar-hide w-[72px] sm:w-24 flex-shrink-0 overflow-y-auto bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700">
        {visibleCategories.map((cat, index) => {
          const isActive = activeCatId === cat.id;
          const accent = ACCENTS[index % ACCENTS.length];
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveCatId(cat.id); track('category_viewed', { categoryId: cat.id }); }}
              className={`w-full relative flex flex-col items-center gap-1 py-3 px-1 transition-all ${
                isActive
                  ? `bg-white dark:bg-slate-800 ${accent.text}`
                  : 'bg-gray-50 dark:bg-slate-900 text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              {isActive && <span aria-hidden="true" className={`absolute bottom-2 left-0 top-2 w-1 rounded-r ${accent.bar}`} />}
              <CategoryIcon icon={cat.icon} name={cat.name} className="w-8 h-8 object-contain" />
              <span className="text-[9px] font-semibold text-center leading-tight line-clamp-2">{cat.name}</span>
            </button>
          );
        })}
      </div>

      {/* Right — products. This pane is the page's scroll owner (see
          paneScrollRef); the search lives in the band above, so nothing in the
          pane has to stay pinned. */}
      <div ref={paneScrollRef} className="categories-scroll flex-1 min-h-0 overflow-y-auto" onScroll={dismiss}>
        {!bandSlot && (
          <div className="sticky top-0 z-30 isolate border-b border-gray-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
            {searchField}
          </div>
        )}

        <div className={`page-x pt-3 ${pageBottom}`}>
          {filteredProducts.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-slate-400">
              <p className="text-sm">{query ? 'No products match your search' : 'No products in this category'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-6 gap-2">
              {filteredProducts.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
