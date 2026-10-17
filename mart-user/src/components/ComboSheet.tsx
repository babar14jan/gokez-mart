import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Product } from '../services/api';
import ProductCard from './ProductCard';
import PageHeader from './PageHeader';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';

interface ComboSheetProps {
  title: string;
  products: Product[];
  onClose: () => void;
}

export default function ComboSheet({ title, products, onClose }: ComboSheetProps) {
  const [search, setSearch] = useState('');
  const { ref: inputRef, dismiss, onKeyDown, onSurfaceClick } = useKeyboardDismiss();
  const query = search.trim().toLowerCase();
  const matches = products.filter(product => !query ||
    product.name.toLowerCase().includes(query) ||
    (product.localName ?? '').toLowerCase().includes(query) ||
    (product.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query))
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} onClick={onSurfaceClick}>
      <button type="button" aria-label="Close combos" onClick={onClose}
        className="absolute inset-0 hidden bg-slate-900/40 backdrop-blur-sm sm:block" />
      <section className="absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 sm:left-auto sm:w-full sm:max-w-md sm:shadow-2xl">
        <PageHeader
          title={title}
          onBack={onClose}
          backLabel="Back to home"
          position="static"
          backStyle="square"
          backSize="sm"
        />

        <div className="shrink-0 bg-white px-3 py-2.5 dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <input ref={inputRef} type="text" inputMode="search" enterKeyHint="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={onKeyDown}
              placeholder="Search combos..."
              className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-400 dark:focus:ring-emerald-500/40" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear combo search"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]" onScroll={dismiss}>
          {matches.length ? (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                {matches.length} combo{matches.length !== 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {matches.map(product => <ProductCard key={product.id} product={product} />)}
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">No matching combos</p>
          )}
        </div>
      </section>
    </div>
  );
}