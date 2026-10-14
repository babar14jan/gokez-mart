import { useEffect, useState } from 'react';
import { ChevronLeft, Search, Tag, X } from 'lucide-react';
import type { Product } from '../services/api';
import ProductCard from './ProductCard';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';

interface DealsSheetProps {
  title: string;
  subtitle?: string;
  products: Product[];
  onClose: () => void;
}

/**
 * Full-screen deals sheet, presented exactly like ComboSheet so the home
 * section's "View all Deals" opens in place instead of navigating to a page.
 * The header keeps the section's title plus the standard deals strapline and a
 * live "N deals" count.
 */
export default function DealsSheet({ title, subtitle = 'Limited-time price drops on everyday essentials', products, onClose }: DealsSheetProps) {
  const [search, setSearch] = useState('');
  const { ref: inputRef, dismiss, onKeyDown, onSurfaceClick } = useKeyboardDismiss();
  const query = search.trim().toLowerCase();
  const deals = products
    .filter(p => (p.discountPercent || 0) > 0 && p.availabilityStatus !== 'hidden')
    .filter(product => !query ||
      product.name.toLowerCase().includes(query) ||
      (product.localName ?? '').toLowerCase().includes(query) ||
      (product.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query))
    )
    .sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} onClick={onSurfaceClick}>
      <button type="button" aria-label="Close deals" onClick={onClose}
        className="absolute inset-0 hidden bg-slate-900/40 backdrop-blur-sm sm:block" />
      <section className="absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 sm:left-auto sm:w-full sm:max-w-md sm:shadow-2xl">
        <header className="relative flex shrink-0 items-center gap-3 border-b border-gray-100 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={onClose} aria-label="Back to home"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-white dark:hover:bg-slate-700">
            <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
          </button>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/20">
            <Tag className="h-5 w-5 text-red-500" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-gray-900 dark:text-white">{title}</h1>
            {subtitle && <p className="truncate text-xs text-gray-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </header>

        <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <input ref={inputRef} type="text" inputMode="search" enterKeyHint="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={onKeyDown}
              placeholder="Search deals..."
              className="w-full rounded-xl border-0 bg-gray-100 py-2.5 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-300" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear deals search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]" onScroll={dismiss}>
          {deals.length ? (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                {deals.length} deal{deals.length !== 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {deals.map(p => <ProductCard key={p.id} product={p} />)}
              </div>
            </>
          ) : (
            <div className="py-20 text-center">
              <div className="mb-3 text-5xl">🏷️</div>
              <p className="mb-1 text-base font-semibold text-gray-900 dark:text-white">No deals right now</p>
              <p className="text-sm text-gray-500 dark:text-slate-400">Check back soon — fresh offers are added often.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
