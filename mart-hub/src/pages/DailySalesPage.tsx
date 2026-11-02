import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Plus, Trash2, RefreshCw, Loader2, CalendarDays, Search, X, Banknote, Smartphone,
} from 'lucide-react';
import {
  dailySalesApi, productsApi,
  type DailySalesDay, type DailySalesMode, type OfflineSale,
} from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import PageSkeleton from '../components/PageSkeleton';

// Indian currency formatting for the ledger figures.
const inr = (n: number) => `₹${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Today in the browser's local calendar, as YYYY-MM-DD. Used to cap the date
// pickers so a future day can never be selected.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MODES: { id: DailySalesMode; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

const NOTE_OPTIONS = ['Store counter', 'Campaign', 'Offline vendor', 'Other'] as const;

type Mode = DailySalesMode;

interface StoreProduct {
  id: string;
  name: string;
  localName: string | null;
  searchAliases: string[];
  photoUrl: string | null;
  price: number;
  unit: string;
  discountPercent: number;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
}

// The storefront sells at the discounted price rounded to the rupee; offline
// rows use the same effective price so both sides of the reconciliation match.
const effectivePrice = (p: StoreProduct) =>
  p.discountPercent > 0 ? Math.round(p.price * (1 - p.discountPercent / 100)) : p.price;

export default function DailySalesPage() {
  const storeId = getActiveStoreId();
  const isSuperAdmin = useAuthStore(state => state.role === 'super_admin');

  const [mode, setMode] = useState<Mode>('today');
  const [days, setDays] = useState<DailySalesDay[]>([]);
  const [loading, setLoading] = useState(true);

  // Custom filter dates.
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());

  // Product catalogue for the offline-entry search.
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  // Add-row form.
  const [entryDate, setEntryDate] = useState(todayStr());
  const [productQuery, setProductQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | ''>('');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingEntry, setEditingEntry] = useState<OfflineSale | null>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);

  // Offline rows for the selected day.
  const [entries, setEntries] = useState<OfflineSale[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entryError, setEntryError] = useState('');

  const load = useCallback(async (m: Mode, from?: string, to?: string) => {
    setLoading(true);
    try {
      const params: { mode: Mode; from?: string; to?: string; storeId: string } = { mode: m, storeId };
      if (m === 'custom') { params.from = from || todayStr(); params.to = to || todayStr(); }
      const r = await dailySalesApi.getRange(params, { fresh: true });
      setDays(r.data.data || []);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadEntries = useCallback(async (date: string) => {
    setEntriesLoading(true);
    setEntryError('');
    try {
      const r = await dailySalesApi.getEntries(date, storeId, { fresh: true });
      setEntries(r.data.data || []);
    } catch {
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (mode === 'custom') load(mode, customFrom, customTo);
    else load(mode);
  }, [mode, customFrom, customTo, load]);

  useEffect(() => { loadEntries(entryDate); }, [entryDate, loadEntries]);

  useEffect(() => {
    productsApi.getAll(storeId, { fresh: true })
      .then(r => setProducts(r.data.data || []))
      .catch(() => setProducts([]))
      .finally(() => setProductsLoading(false));
  }, [storeId]);

  const suggestions = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products.filter(p =>
      p.name.toLowerCase().includes(q)
      || (p.localName || '').toLowerCase().includes(q)
      || (p.searchAliases || []).some(alias => alias.toLowerCase().includes(q))
      || p.unit.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, productQuery]);

  const pickProduct = (p: StoreProduct) => {
    setSelectedProduct(p);
    setProductQuery(p.name);
    setShowSuggestions(false);
    setFormError('');
  };

  const clearProduct = () => {
    setSelectedProduct(null);
    setProductQuery('');
    setShowSuggestions(false);
  };

  const selectedUnitPrice = selectedProduct ? effectivePrice(selectedProduct) : 0;
  const parsedQuantity = Number(quantity);
  const draftTotal = selectedProduct && Number.isFinite(parsedQuantity) && parsedQuantity > 0
    ? round2(selectedUnitPrice * parsedQuantity)
    : 0;

  const addEntry = async () => {
    setFormError('');
    if (!selectedProduct) { setFormError('Search and pick a product first.'); return; }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setFormError('Quantity must be greater than zero.'); return;
    }
    if (!paymentMethod) { setFormError('Select a payment method.'); return; }
    if (!notes.trim()) { setFormError('Select a sale source.'); return; }
    setAdding(true);
    try {
      await dailySalesApi.addEntry({
        date: entryDate,
        productId: selectedProduct.id,
        quantity: parsedQuantity,
        paymentMethod,
        notes: notes.trim(),
        storeId,
      });
      clearProduct();
      setQuantity('1');
      setNotes('');
      setShowEntryForm(false);
      await Promise.all([loadEntries(entryDate), load(mode, customFrom, customTo)]);
    } catch (err: any) {
      setFormError(err?.response?.data?.error || 'Could not save this offline sale.');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (entry: OfflineSale) => {
    setEditingEntry(entry);
    setShowEntryForm(true);
    setEntryDate(entry.date);
    setProductQuery(entry.productName);
    setSelectedProduct(products.find(p => p.id === entry.productId) || null);
    setQuantity(String(entry.quantity));
    setPaymentMethod(entry.paymentMethod);
    setNotes(entry.notes || '');
    setFormError('');
  };

  const updateEntry = async () => {
    if (!editingEntry) return;
    if (!selectedProduct) { setFormError('Search and pick a product first.'); return; }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) { setFormError('Quantity must be greater than zero.'); return; }
    if (!paymentMethod) { setFormError('Select a payment method.'); return; }
    if (!notes.trim()) { setFormError('Select a sale source.'); return; }
    setAdding(true);
    try {
      await dailySalesApi.updateEntry({
        id: editingEntry.id,
        date: entryDate,
        productId: selectedProduct.id,
        quantity: parsedQuantity,
        paymentMethod,
        notes: notes.trim(),
        storeId,
      });
      setEditingEntry(null);
      setShowEntryForm(false);
      await Promise.all([loadEntries(entryDate), load(mode, customFrom, customTo)]);
    } catch (err: any) {
      setFormError(err?.response?.data?.error || 'Could not save this offline sale.');
    } finally { setAdding(false); }
  };

  const removeEntry = async (entry: OfflineSale) => {
    if (!window.confirm(`Delete ${entry.productName} (${entry.quantity} ${entry.unit}) from ${entry.date}?`)) return;
    setDeletingId(entry.id);
    setEntryError('');
    try {
      await dailySalesApi.removeEntry(entry.id, storeId);
      await Promise.all([loadEntries(entryDate), load(mode, customFrom, customTo)]);
    } catch {
      setEntryError('Could not delete that row. Try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const refreshAll = () => {
    load(mode, customFrom, customTo);
    loadEntries(entryDate);
  };

  const periodTotals = useMemo(() => days.reduce((totals, day) => ({
    transactions: totals.transactions + day.ordersPlaced + day.offlineEntryCount,
    cash: totals.cash + day.codValue + day.offlineCash,
    upi: totals.upi + day.upiValue + day.offlineUpi,
    online: totals.online + day.totalDaySales - day.offlineTotal,
    offline: totals.offline + day.offlineTotal,
    sales: totals.sales + day.totalDaySales,
  }), { transactions: 0, cash: 0, upi: 0, online: 0, offline: 0, sales: 0 }), [days]);

  const entryTotals = useMemo(() => entries.reduce((acc, e) => ({
    cash: acc.cash + (e.paymentMethod === 'cash' ? e.total : 0),
    upi: acc.upi + (e.paymentMethod === 'upi' ? e.total : 0),
  }), { cash: 0, upi: 0 }), [entries]);

  return (
    <div className="max-w-6xl space-y-4">
      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                mode === m.id
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
              }`}>
              {m.id === 'custom' && <CalendarDays className="h-3 w-3" />}
              {m.label}
            </button>
          ))}
          {mode === 'custom' && (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <input type="date" value={customFrom} max={todayStr()} onChange={e => setCustomFrom(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-emerald-500 focus:outline-none sm:w-[138px] sm:flex-none dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
              <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
              <input type="date" value={customTo} max={todayStr()} onChange={e => setCustomTo(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-emerald-500 focus:outline-none sm:w-[138px] sm:flex-none dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={refreshAll} title="Refresh sales" aria-label="Refresh sales"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm transition-colors hover:bg-purple-700">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => {
            setEditingEntry(null);
            clearProduct();
            setQuantity('1');
            setNotes('');
            setFormError('');
            setShowEntryForm(true);
          }} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-black hover:shadow-md dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
            <Plus className="h-4 w-4" /> Add offline sale
          </button>
        </div>
      </div>

      {/* Add an offline sale row */}
      {showEntryForm && <section
        className="page-card border-emerald-200 p-3 sm:p-4 dark:border-emerald-500/30">
        <div className="mb-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {editingEntry ? 'Edit offline sale' : 'Add offline sale'}
            </h2>
            <button type="button" onClick={() => { setEditingEntry(null); setFormError(''); setShowEntryForm(false); }}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700" title="Close form">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Search an existing item, add the quantity and pick how it was paid. Saved rows feed the day's offline cash / UPI split.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-2">
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" /> Date
            </label>
            <input type="date" value={entryDate} max={todayStr()}
              onChange={e => setEntryDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </div>

          <div className="relative lg:col-span-4">
            <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Search className="h-3.5 w-3.5" /> Product
            </label>
            <div className="relative">
              <input
                type="text"
                value={productQuery}
                disabled={productsLoading}
                placeholder={productsLoading ? 'Loading items…' : 'Search item name or Hindi name'}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                onChange={e => {
                  setProductQuery(e.target.value);
                  setSelectedProduct(null);
                  setShowSuggestions(true);
                  setFormError('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              {productQuery && (
                <button type="button" onClick={clearProduct} title="Clear product"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {showSuggestions && !selectedProduct && !productsLoading && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {suggestions.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">No matching items.</p>
                ) : suggestions.map(p => (
                  <button key={p.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pickProduct(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
                        {p.name}{p.localName ? <span className="font-normal text-slate-400"> ({p.localName})</span> : null}
                      </span>
                      <span className="block text-xs text-slate-400">{p.unit}{p.availabilityStatus === 'out_of_stock' ? ' · out of stock' : ''}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {inr(effectivePrice(p))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Qty</label>
            <input type="number" min="0.01" step="1" value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Payment *</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'cash' | 'upi' | '')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
              <option value="" disabled>Select payment</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Sale source *</label>
            <select value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
              <option value="" disabled>Select source</option>
              {NOTE_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end lg:col-span-1">
            <button onClick={editingEntry ? updateEntry : addEntry} disabled={adding || !selectedProduct || !paymentMethod || !notes}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editingEntry ? 'Update' : 'Add'}
            </button>
          </div>
        </div>

        {selectedProduct && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {selectedProduct.name}{selectedProduct.localName ? ` (${selectedProduct.localName})` : ''}
            </span>
            <span>{selectedProduct.unit}</span>
            <span>
              Unit {inr(selectedUnitPrice)}
              {selectedProduct.discountPercent > 0 && (
                <span className="ml-1 text-slate-400 line-through">{inr(selectedProduct.price)}</span>
              )}
            </span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">Row total {inr(draftTotal)}</span>
          </div>
        )}

        {editingEntry && (
          <button onClick={() => { if (editingEntry) removeEntry(editingEntry); setEditingEntry(null); }} disabled={deletingId === editingEntry.id}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
            {deletingId === editingEntry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        )}

        {formError && <p className="mt-2 text-sm text-rose-500">{formError}</p>}
      </section>}

      {/* Offline rows for the selected day */}
      {(entriesLoading || entries.length > 0 || entryError) && <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Offline entries — {entryDate}
          </h2>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span>{entries.length} {entries.length === 1 ? 'row' : 'rows'}</span>
            <span className="text-emerald-600 dark:text-emerald-400">Cash {inr(entryTotals.cash)}</span>
            <span className="text-indigo-600 dark:text-indigo-400">UPI {inr(entryTotals.upi)}</span>
          </div>
        </header>

        {entriesLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rows…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 font-medium">Unit price</th>
                  <th className="px-3 py-2.5 font-medium">Qty</th>
                  <th className="px-3 py-2.5 font-medium">Payment</th>
                  <th className="px-3 py-2.5 font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Notes</th>
                  <th className="px-3 py-2.5 font-medium">Added by</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{e.productName}</span>
                      <span className="ml-1 text-xs text-slate-400">{e.unit}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{inr(e.unitPrice)}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{e.quantity}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.paymentMethod === 'cash'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                      }`}>
                        {e.paymentMethod === 'cash' ? <Banknote className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                        {e.paymentMethod === 'cash' ? 'Cash' : 'UPI'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">{inr(e.total)}</td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400" title={e.notes || ''}>
                      {e.notes || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400" title={e.recordedBy?.name || ''}>
                      {e.recordedBy?.username || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => startEdit(e)} className="inline-flex items-center rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-indigo-500/10">
                          Edit
                        </button>
                        <button onClick={() => removeEntry(e)} disabled={deletingId === e.id}
                          title="Delete row"
                          className="inline-flex items-center rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-rose-500/10">
                          {deletingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entryError && <p className="px-4 py-2 text-xs text-rose-500">{entryError}</p>}
      </section>}

      {/* Daily ledger */}
      {loading && days.length === 0 ? (
        <PageSkeleton />
      ) : days.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          No sales for this period. Add an offline sale above to record the counter.
        </div>
      ) : (
        <>
          <LedgerTable days={days} selectedDate={entryDate} isSuperAdmin={isSuperAdmin} />
          <PeriodTotals {...periodTotals} />
        </>
      )}
    </div>
  );
}

function LedgerTable({ days, selectedDate, isSuperAdmin }: {
  days: DailySalesDay[];
  selectedDate: string;
  isSuperAdmin: boolean;
}) {
  const columns = isSuperAdmin
    ? { date: 'w-[20%]', transactions: 'w-[14%]', coupon: 'w-[16%]', cash: 'w-[17%]', upi: 'w-[17%]', total: 'w-[16%]' }
    : { date: 'w-[22%]', transactions: 'w-[16%]', coupon: '', cash: 'w-[20%]', upi: 'w-[20%]', total: 'w-[22%]' };
  return (
    <>
      <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Online Sales</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-[600px] w-full table-fixed text-xs sm:min-w-[820px] sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <th className={`${columns.date} px-2 py-2 font-medium sm:px-4 sm:py-3`}>Date</th>
                <th className={`${columns.transactions} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>Transactions</th>
                {isSuperAdmin && <th className={`${columns.coupon} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>Gokez subsidy</th>}
                <th className={`${columns.cash} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>Cash</th>
                <th className={`${columns.upi} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>UPI</th>
                <th className={`${columns.total} px-1.5 py-2 text-right font-medium sm:px-3 sm:py-3`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => (
                <tr key={d.date} className={`border-b border-slate-100 last:border-0 dark:border-slate-700/60 ${d.date === selectedDate ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : ''}`}>
                  <td className="px-2 py-2 font-medium text-slate-800 sm:px-4 sm:py-3 dark:text-slate-100">{d.date}</td>
                  <td className="px-1.5 py-2 text-slate-600 sm:px-3 sm:py-3 dark:text-slate-300">{d.ordersPlaced}{d.ordersCancelled ? <span className="text-slate-400"> (−{d.ordersCancelled})</span> : null}</td>
                  {isSuperAdmin && <td className="px-1.5 py-2 text-purple-600 sm:px-3 sm:py-3 dark:text-purple-400">{inr(d.couponDeduction || 0)}</td>}
                  <td className="px-1.5 py-2 text-slate-600 sm:px-3 sm:py-3 dark:text-slate-300">{inr(d.codValue)}</td>
                  <td className="px-1.5 py-2 text-slate-600 sm:px-3 sm:py-3 dark:text-slate-300">{inr(d.upiValue)}</td>
                  <td className="px-1.5 py-2 text-right font-semibold text-slate-800 sm:px-3 sm:py-3 dark:text-slate-100">{inr(d.orderValueAfterCoupon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Offline Sales</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-[600px] w-full table-fixed text-xs sm:min-w-[820px] sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <th className={`${columns.date} px-2 py-2 font-medium sm:px-4 sm:py-3`}>Date</th>
                <th className={`${columns.transactions} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>Transactions</th>
                {isSuperAdmin && <th className={`${columns.coupon} px-1.5 py-2 sm:px-3 sm:py-3`} aria-label="" />}
                <th className={`${columns.cash} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>Cash</th>
                <th className={`${columns.upi} px-1.5 py-2 font-medium sm:px-3 sm:py-3`}>UPI</th>
                <th className={`${columns.total} px-1.5 py-2 text-right font-medium sm:px-3 sm:py-3`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => (
                <tr key={d.date} className={`border-b border-slate-100 last:border-0 dark:border-slate-700/60 ${d.date === selectedDate ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : ''}`}>
                  <td className="px-2 py-2 font-medium text-slate-800 sm:px-4 sm:py-3 dark:text-slate-100">{d.date}</td>
                  <td className="px-1.5 py-2 text-slate-500 sm:px-3 sm:py-3 dark:text-slate-400">{d.offlineEntryCount}</td>
                  {isSuperAdmin && <td className="px-1.5 py-2 sm:px-3 sm:py-3" />}
                  <td className="px-1.5 py-2 text-emerald-600 sm:px-3 sm:py-3 dark:text-emerald-400">{inr(d.offlineCash)}</td>
                  <td className="px-1.5 py-2 text-indigo-600 sm:px-3 sm:py-3 dark:text-indigo-400">{inr(d.offlineUpi)}</td>
                  <td className="px-1.5 py-2 text-right font-bold text-slate-900 sm:px-3 sm:py-3 dark:text-white">{inr(d.offlineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PeriodTotals({ transactions, cash, upi, online, offline, sales }: {
  transactions: number;
  cash: number;
  upi: number;
  online: number;
  offline: number;
  sales: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <p className="text-gray-500 dark:text-slate-400">Transactions <span className="font-semibold text-gray-900 dark:text-white">{transactions}</span></p>
        <p className="text-gray-500 dark:text-slate-400">Online <span className="font-semibold text-gray-900 dark:text-white">{inr(online)}</span></p>
        <p className="text-gray-500 dark:text-slate-400">Offline <span className="font-semibold text-gray-900 dark:text-white">{inr(offline)}</span></p>
        <p className="text-gray-500 dark:text-slate-400">(Cash {inr(cash)} · UPI {inr(upi)})</p>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Total period sales:</p>
        <p className="text-xl font-extrabold text-gray-900 dark:text-white">{inr(sales)}</p>
      </div>
    </div>
  );
}
