import { useEffect, useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import type { Product } from '../services/api';
import ProductCard from './ProductCard';

interface ComboSheetProps {
  title: string;
  products: Product[];
  onClose: () => void;
}

export default function ComboSheet({ title, products, onClose }: ComboSheetProps) {
  const [search, setSearch] = useState('');
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
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close combos" onClick={onClose}
        className="absolute inset-0 hidden bg-slate-900/40 backdrop-blur-sm sm:block" />
      <section className="absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-slate-900 sm:left-auto sm:w-full sm:max-w-md sm:shadow-2xl">
        <header className="flex shrink-0 items-center border-b border-gray-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={onClose} aria-label="Back to home"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-slate-700 dark:hover:bg-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 flex-1 text-center text-base font-bold text-gray-900 dark:text-white">{title}</h1>
          <span className="w-11 shrink-0" />
        </header>

        <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <input type="text" inputMode="search" value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Search combos..."
              className="w-full rounded-xl border-0 bg-gray-100 py-2.5 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-300" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear combo search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
          {matches.length ? (
            <div className="grid grid-cols-2 gap-2.5">
              {matches.map(product => <ProductCard key={product.id} product={product} />)}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">No matching combos</p>
          )}
        </div>
      </section>
    </div>
  );
}