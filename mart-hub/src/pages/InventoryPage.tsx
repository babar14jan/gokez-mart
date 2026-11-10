import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package, Pencil, Loader2, X,
  AlertTriangle, CheckCircle,
  History, Plus, Search,
} from 'lucide-react';
import { inventoryApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import PageSkeleton from '../components/PageSkeleton';
import SmartImage from '../components/SmartImage';

interface InventoryItem {
  productId: string;
  name: string;
  localName: string | null;
  searchAliases: string[];
  photoUrl: string | null;
  sellingUnit: string;
  stockUnit: string | null;
  price: number;
  availabilityStatus: string;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  categoryName: string | null;
  recentRestocks?: Array<{ changeQty: number; note: string | null; createdBy?: string | null; createdByUsername?: string | null; createdAt: string }>;
  storeId?: string;
  storeName?: string;
}

const STOCK_UNITS = ['kg', 'litre', 'pcs', 'bunch', 'packet'];

function formatStock(qty: number, unit: string): string {
  if (unit === 'kg' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} g`;
  if (unit === 'litre' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} ml`;
  return `${parseFloat(qty.toFixed(3))} ${unit}`;
}

const DEFAULT_LOW_THRESHOLD = 5; // used when no threshold is explicitly set
const roundMoney = (n: number) => Math.round(n * 100) / 100;
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

function stockStatus(item: InventoryItem): 'untracked' | 'out' | 'low' | 'ok' {
  // If manually marked out_of_stock, treat as out
  if (item.availabilityStatus === 'out_of_stock') return 'out';
  if (item.stockQuantity === null) return 'untracked';
  if (item.stockQuantity <= 0) return 'out';
  // Use explicit threshold or fall back to default
  const threshold = item.lowStockThreshold ?? DEFAULT_LOW_THRESHOLD;
  if (item.stockQuantity <= threshold) return 'low';
  return 'ok';
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [enablingTracking, setEnablingTracking] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'stock_asc' | 'stock_desc'>('name');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'untracked' | 'ok'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // History drawer
  const [activeTab, setActiveTab] = useState<'stock' | 'ledger'>('stock');
  const [movementSearch, setMovementSearch] = useState('');
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ productId: '', quantity: '', unit: 'kg', unitCost: '', totalCost: '', note: '' });
  const [showMovements, setShowMovements] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ productId: '', quantity: '', reason: 'damage', note: '' });
  const [adjustQuery, setAdjustQuery] = useState('');
  const [adjustShowSuggestions, setAdjustShowSuggestions] = useState(false);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkRows, setBulkRows] = useState<Array<{ key: string; productId: string; query: string; showSuggestions: boolean; action: 'add' | 'remove' | 'set'; qty: string; unit: string; cost: string; reason: string; note: string }>>([]);
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const [purchaseShowSuggestions, setPurchaseShowSuggestions] = useState(false);

  const { role } = useAuthStore();
  const canManageTracking = role === 'super_admin' || role === 'store_owner' || role === 'store_manager';
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStoreId = searchParams.get('store') || 'all';
  const [manageableStores, setManageableStores] = useState<Array<{ id: string; name: string; address?: string | null; isOwn?: boolean }>>([]);
  const canSwitchStores = role !== 'super_admin' && manageableStores.length > 1;
  const selectedStore = manageableStores.find(s => s.id === selectedStoreId);
  // A zone head may manage stock for member stores even when that store's own
  // tracking switch is off, so the list is not hidden in that case.
  const managingMemberStore = canSwitchStores && selectedStore != null && !selectedStore.isOwn;

  useEffect(() => {
    if (role === 'super_admin') return;
    inventoryApi.getStores().then(r => {
      const list = r.data.data || [];
      setManageableStores(list);
      if (selectedStoreId !== 'all' && !list.some((s: any) => s.id === selectedStoreId)) {
        const own = list.find((s: any) => s.isOwn)?.id || list[0]?.id;
        if (own) {
          setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('store', own);
            return next;
          }, { replace: true });
        }
      }
    }).catch(() => {});
  }, [role]);

  const load = async (fresh = false) => {
    if (selectedStoreId === 'all') {
      const stores = manageableStores.length ? manageableStores : [];
      const targetStores = stores.length ? stores : [{ id: getActiveStoreId(), name: 'This store', isOwn: true }];
      const results = await Promise.all(targetStores.map(async store => {
        const inv = await inventoryApi.getAll(store.id, { fresh });
        return (inv.data.data || []).map((item: any) => ({ ...item, storeId: store.id, storeName: store.name && store.name !== 'This store' ? store.name : undefined }));
      }));
      setItems(results.flat());
      try {
        const meta = await inventoryApi.getSettings(targetStores.find(s => s.isOwn)?.id || targetStores[0].id);
        setTrackingEnabled(Boolean(meta.data.data?.inventoryTracking));
      } catch { setTrackingEnabled(false); }
      setLoading(false);
      return;
    }

    const [inv, meta] = await Promise.all([
      inventoryApi.getAll(selectedStoreId, { fresh }),
      inventoryApi.getSettings(selectedStoreId),
    ]);
    setItems([...(inv.data.data || []).map((item: any) => ({ ...item, storeId: selectedStoreId, storeName: manageableStores.find(s => s.id === selectedStoreId)?.name || selectedStore }))]);
    setTrackingEnabled(Boolean(meta.data.data?.inventoryTracking));
    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedStoreId]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedStoreId]);

  const enableInventoryTracking = async () => {
    setEnablingTracking(true);
    try {
      await inventoryApi.updateSettings({ inventoryTracking: true }, selectedStoreId);
      setTrackingEnabled(true);
      await load(true);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not enable inventory tracking');
    } finally {
      setEnablingTracking(false);
    }
  };

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(item => { if (item.categoryName) map.set(item.categoryName, item.categoryName); });
    return [...map.keys()].sort();
  }, [items]);

  const sorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = items.filter(item => {
      const matchesQuery = !query
        || item.name.toLowerCase().includes(query)
        || (item.localName || '').toLowerCase().includes(query)
        || (item.searchAliases ?? []).some((alias: string) => alias.toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'all' || stockStatus(item) === statusFilter;
      const matchesCategory = categoryFilter === 'all' || item.categoryName === categoryFilter;
      return matchesQuery && matchesStatus && matchesCategory;
    });
    const sortedList = [...list];
    if (sortBy === 'name') return sortedList.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'stock_asc') return sortedList.sort((a, b) => (a.stockQuantity ?? Number.MAX_SAFE_INTEGER) - (b.stockQuantity ?? Number.MAX_SAFE_INTEGER));
    if (sortBy === 'stock_desc') return sortedList.sort((a, b) => (b.stockQuantity ?? -1) - (a.stockQuantity ?? -1));
    return sortedList;  }, [items, sortBy, searchQuery, statusFilter, categoryFilter]);

  const outCount = items.filter(i => stockStatus(i) === 'out').length;
  const lowCount = items.filter(i => stockStatus(i) === 'low').length;


  const loadMovements = async () => {
    setMovementsLoading(true);
    try {
      const res = await inventoryApi.getMovements(selectedStoreId);
      setMovements(res.data.data || []);
    } finally { setMovementsLoading(false); }
  };

  if (activeTab === 'ledger') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Inventory Movement Ledger</h2>
          <button onClick={() => setActiveTab('stock')} className="text-xs font-semibold text-emerald-600 hover:underline">Back to Stock</button>
        </div>
        <input type="text" value={movementSearch} onChange={e => setMovementSearch(e.target.value)}
          placeholder="Search product, reason or source"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
        {movementsLoading ? <p className="text-sm text-gray-500">Loading...</p> : (
          <div className="space-y-2">
            {movements.filter(m => {
              const q = movementSearch.trim().toLowerCase();
              if (!q) return true;
              return [m.productName, m.productLocalName, m.movementType, m.reason, m.remarks, m.sourceType]
                .some(value => String(value || '').toLowerCase().includes(q));
            }).map(m => (
              <div key={m.id} className="rounded-xl border border-gray-100 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{m.productName || m.productId}{m.productLocalName ? ` (${m.productLocalName})` : ''}</span>
                  <span className="text-gray-500">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-gray-600 dark:text-slate-300">
                  <span className="font-semibold">{m.movementType}</span>
                  <span>In: {m.quantityIn}</span>
                  <span>Out: {m.quantityOut}</span>
                  <span>Balance: {m.newBalance}</span>
                  {m.totalCost != null && <span>Cost: {m.totalCost}</span>}
                </div>
                <div className="mt-1 text-gray-500 dark:text-slate-400">
                  {m.reason}{m.remarks ? ` · ${m.remarks}` : ''}{m.sourceType ? ` · ${m.sourceType}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const saveBulkUpdate = async () => {
    const rows = bulkRows.filter(row => row.productId && row.qty && Number(row.qty) !== 0);
    if (rows.length === 0) { setShowBulkUpdate(false); return; }
    setBulkSaving(true);
    try {
      for (const row of rows) {
        const key = crypto.randomUUID();
        if (row.action === 'add') {
          await inventoryApi.restock(row.productId, Number(row.qty), row.note, selectedStoreId, row.unit, key, row.cost ? Number(row.cost) : undefined);
        } else if (row.action === 'remove') {
          await inventoryApi.adjustStock(row.productId, -Math.abs(Number(row.qty)), row.reason, row.note, selectedStoreId, key);
        } else {
          await inventoryApi.setStock(row.productId, Number(row.qty), selectedStoreId, key, row.unit);
        }
      }
      setShowBulkUpdate(false);
      setBulkRows([]);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Bulk update failed');
    } finally {
      setBulkSaving(false);
    }
  };

  if (showBulkUpdate) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Bulk Update</h2>
            <button onClick={() => setShowBulkUpdate(false)} className="text-xs font-semibold text-emerald-600 hover:underline">Back to Inventory</button>
          </div>
          <div className="p-4">
            <div className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 dark:border-slate-700">
              {bulkRows.map((row) => (
                <div key={row.key} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-100 p-3 dark:border-slate-700 sm:grid-cols-12">
                  <div className="relative sm:col-span-3">
                    <input type="text" value={row.query}
                      onFocus={() => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, showSuggestions: true } : r))}
                      onBlur={() => window.setTimeout(() => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, showSuggestions: false } : r)), 120)}
                      onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, query: e.target.value, productId: '' } : r))}
                      placeholder="Search product"
                      className={inp + ' pr-9'} />
                    {row.query && (
                      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, query: '', productId: '', showSuggestions: false } : r))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-slate-400">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {row.showSuggestions && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                        {items.filter(item => {
                          const q = row.query.trim().toLowerCase();
                          return q ? (item.name.toLowerCase().startsWith(q) || (item.localName || '').toLowerCase().startsWith(q)) : false;
                        }).slice(0, 8).map(item => (
                          <button key={item.productId} type="button" onMouseDown={e => e.preventDefault()}
                            onClick={() => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, productId: item.productId, query: `${item.name}${item.localName ? ` (${item.localName})` : ''}`, unit: item.stockUnit || r.unit, showSuggestions: false } : r))}
                            className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</span>
                            {item.localName && <span className="text-xs text-slate-400">{item.localName}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select value={row.action} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, action: e.target.value as any } : r))} className={inp + ' sm:col-span-2'}>
                    <option value="add">Add</option>
                    <option value="remove">Remove</option>
                    <option value="set">Set</option>
                  </select>
                  <input type="number" value={row.qty} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, qty: e.target.value } : r))} placeholder="Qty" className={inp + ' sm:col-span-1'} />
                  <input type="text" value={row.unit} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, unit: e.target.value } : r))} placeholder="Unit" className={inp + ' sm:col-span-1'} />
                  {row.action === 'add' && <input type="number" value={row.cost} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, cost: e.target.value } : r))} placeholder="Cost/unit" className={inp + ' sm:col-span-2'} />}
                  {row.action === 'remove' && (
                    <select value={row.reason} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, reason: e.target.value } : r))} className={inp + ' sm:col-span-2'}>
                      <option value="damage">Damage</option>
                      <option value="spoiled">Spoiled</option>
                      <option value="expired">Expired</option>
                      <option value="lost">Lost</option>
                      <option value="missing">Missing</option>
                      <option value="consumption">Consumption</option>
                      <option value="quality_rejection">Quality rejection</option>
                      <option value="other">Other</option>
                    </select>
                  )}
                  <input type="text" value={row.note} onChange={e => setBulkRows(rows => rows.map(r => r.key === row.key ? { ...r, note: e.target.value } : r))} placeholder="Note" className={inp + ' sm:col-span-2'} />
                  <button onClick={() => setBulkRows(rows => rows.filter(r => r.key !== row.key))} className="text-red-500 text-xs">Remove</button>
                </div>
              ))}
              <button onClick={() => setBulkRows(rows => [...rows, { key: crypto.randomUUID(), productId: '', query: '', showSuggestions: false, action: 'add', qty: '', unit: items[0]?.stockUnit || 'kg', cost: '', reason: 'damage', note: '' }])}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs font-semibold rounded-xl">
                <Plus className="w-3.5 h-3.5" /> Add row
              </button>
            </div>
          </div>
        </div>
        <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3 flex gap-3">
          <button onClick={() => setShowBulkUpdate(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
          <button disabled={bulkSaving} onClick={saveBulkUpdate}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50">
            {bulkSaving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
    );
  }
  if (loading) return <PageSkeleton />;

  if (!trackingEnabled && !managingMemberStore) return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <Package className="w-12 h-12 text-gray-200 dark:text-slate-700" />
      <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">Inventory tracking is disabled</p>
      <p className="text-xs text-gray-500 dark:text-slate-400">Enable it here to record stock and keep product availability up to date.</p>
      {canManageTracking ? (
        <button type="button" onClick={enableInventoryTracking} disabled={enablingTracking}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
          {enablingTracking && <Loader2 className="h-4 w-4 animate-spin" />}
          Enable inventory tracking
        </button>
      ) : (
        <p className="text-xs text-gray-500 dark:text-slate-400">Ask a store owner or manager to enable it.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Zone-head store picker — a head store owner manages the stock of
          every store tagged into its active zone. Other roles see no picker. */}
      {!trackingEnabled && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <span>Inventory tracking is disabled for this store. Restocks still update its stock.</span>
          {canManageTracking && (
            <button type="button" onClick={enableInventoryTracking} disabled={enablingTracking}
              className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50">
              {enablingTracking ? 'Enabling...' : 'Enable'}
            </button>
          )}
        </div>
      )}

      {/* Compact filter pills + KPIs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { key: 'all', label: `All ${items.length}`, color: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
          { key: 'out', label: `Out ${outCount}`, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
          { key: 'low', label: `Low ${lowCount}`, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
          { key: 'untracked', label: `Untracked ${items.filter(i => stockStatus(i) === 'untracked').length}`, color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300' },
        ].map(pill => (
          <button key={pill.key} onClick={() => setStatusFilter(pill.key as any)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${statusFilter === pill.key ? 'bg-emerald-500 text-white' : pill.color}`}>
            {pill.label}
          </button>
        ))}
      </div>

      {/* Sort + category filter */}
      <div className="flex items-center gap-2">
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} title="Sort inventory"
          className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="name">Name (A-Z)</option>
          <option value="stock_asc">Stock low to high</option>
          <option value="stock_desc">Stock high to low</option>
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All categories</option>
          {categories.map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </div>

      {/* Toolbar */}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input type="text" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search inventory..." className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-9 pr-8 text-xs text-gray-900 placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
          {searchQuery && <button onClick={() => setSearchQuery('')} aria-label="Clear inventory search" className="absolute right-2 top-1/2 -translate-y-1/2"><X className="h-3.5 w-3.5 text-gray-500 hover:text-gray-700" /></button>}
        </div>
        <button onClick={() => { setBulkRows([{ key: crypto.randomUUID(), productId: '', query: '', showSuggestions: false, action: 'add', qty: '', unit: items[0]?.stockUnit || 'kg', cost: '', reason: 'damage', note: '' }]); setShowBulkUpdate(true); }}
          className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
          <Pencil className="w-3.5 h-3.5" /> Bulk Update
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button onClick={() => { setPurchaseForm({ productId: '', quantity: '', unit: items[0]?.stockUnit || 'kg', unitCost: '', totalCost: '', note: '' }); setPurchaseQuery(''); setShowPurchase(true); }}
            className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <Plus className="w-3.5 h-3.5" /> Record Purchase
          </button>
          <button onClick={() => { setAdjustForm({ productId: items[0]?.productId || '', quantity: '', reason: 'damage', note: '' }); setShowAdjust(true); }}
            className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-red-400 hover:text-red-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <AlertTriangle className="w-3.5 h-3.5" /> Adjust Stock
          </button>
          <button onClick={() => { setActiveTab('ledger'); void loadMovements(); }}
            className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-gray-400 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <History className="w-3.5 h-3.5" /> View Ledger
          </button>
          <button onClick={() => { window.location.href = '/daily-sales'; }}
            className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <Plus className="w-3.5 h-3.5" /> Offline Sale
          </button>
        </div>

      {/* Inventory table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No products found.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {sorted.map(item => {
              const s = stockStatus(item);
              const stockColor = s === 'out' ? 'text-red-600 dark:text-red-400'
                : s === 'low' ? 'text-amber-600 dark:text-amber-400'
                : s === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-500 dark:text-slate-400';
              return (
                <div key={item.productId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  {/* Photo */}
                  <SmartImage
                    src={item.photoUrl}
                    alt={item.name}
                    className="w-10 h-10 rounded-xl flex-shrink-0 border border-gray-100 dark:border-slate-600"
                    imgClassName="object-cover"
                    fallback={
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                        <Package className="w-5 h-5 text-gray-300" />
                      </div>
                    }
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name}</p>
                      {s === 'out' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Out</span>}
                      {s === 'low' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Low</span>}
                      {s === 'ok' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />OK</span>}
                    </div>
                    {item.localName && <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{item.localName}</p>}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.price != null && item.price > 0 ? (
                        <span className="text-xs text-gray-500 dark:text-slate-400">₹{item.price}/{item.sellingUnit}</span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-slate-400">{item.sellingUnit}</span>
                      )}
                      {selectedStoreId === 'all' && item.storeName && item.storeName !== 'This store' && <span className="text-xs text-gray-500 dark:text-slate-400">· {item.storeName}</span>}
                    </div>
                    {item.recentRestocks?.length ? (
                      <div className="mt-1 space-y-0.5">
                        {item.recentRestocks.slice(0, 2).map((r, i) => (
                          <p key={i} className="text-[10px] text-gray-500 dark:text-slate-400">
                            Purchase: {r.changeQty > 0 ? '+' : ''}{r.changeQty} · {new Date(r.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })} · {r.createdBy || r.createdByUsername || 'System'}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Current stock */}
                  <div className="text-right flex-shrink-0 min-w-[48px]">
                    {item.stockQuantity !== null ? (
                      <>
                        <p className={`text-sm font-bold tabular-nums ${stockColor}`}>
                          {formatStock(item.stockQuantity!, item.stockUnit || 'units')}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-slate-400">—</p>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Record purchase modal */}
      {showPurchase && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Record Purchase</h3>
              <button onClick={() => setShowPurchase(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="relative">
              <input type="text" value={purchaseQuery}
                onFocus={() => setPurchaseShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setPurchaseShowSuggestions(false), 120)}
                onChange={e => { setPurchaseQuery(e.target.value); setPurchaseForm(f => ({ ...f, productId: '' })); }}
                placeholder="Search product name or Hindi name"
                className={inp} />
              {purchaseQuery && (
                <button type="button" onClick={() => { setPurchaseQuery(''); setPurchaseForm(f => ({ ...f, productId: '' })); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              {purchaseShowSuggestions && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                  {items.filter(item => {
                    const q = purchaseQuery.trim().toLowerCase();
                    return !q || item.name.toLowerCase().includes(q) || (item.localName || '').toLowerCase().includes(q) || (item.searchAliases ?? []).some((a: string) => a.toLowerCase().includes(q));
                  }).slice(0, 12).map(item => (
                    <button key={item.productId} type="button" onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setPurchaseForm(f => ({ ...f, productId: item.productId, unit: item.stockUnit || f.unit }));
                        setPurchaseQuery(`${item.name}${item.localName ? ` (${item.localName})` : ''}`);
                        setPurchaseShowSuggestions(false);
                      }}
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</span>
                      <span className="text-xs text-slate-400">
                        {item.localName ? `${item.localName} · ` : ''}{item.stockQuantity != null ? `${item.stockQuantity} ${item.stockUnit || item.sellingUnit}` : 'Not tracked'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={purchaseForm.quantity} onChange={e => {
                const value = e.target.value;
                setPurchaseForm(f => {
                  const next = { ...f, quantity: value };
                  const q = Number(value); const u = Number(next.unitCost); const t = Number(next.totalCost);
                  if (value && next.unitCost && Number.isFinite(q) && q > 0) next.totalCost = String(roundMoney(q * u));
                  else if (value && next.totalCost && Number.isFinite(q) && q > 0 && !next.unitCost) next.unitCost = String(roundMoney(t / q));
                  return next;
                });
              }} placeholder="Qty" className={inp} />
              {purchaseForm.productId && items.find(i => i.productId === purchaseForm.productId)?.stockUnit ? (
                <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  {items.find(i => i.productId === purchaseForm.productId)?.stockUnit}
                </div>
              ) : (
                <select value={purchaseForm.unit} onChange={e => setPurchaseForm(f => ({ ...f, unit: e.target.value }))} className={inp}>
                  {STOCK_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              )}
              <input type="number" value={purchaseForm.unitCost} onChange={e => {
                const value = e.target.value;
                setPurchaseForm(f => {
                  const next = { ...f, unitCost: value };
                  const q = Number(next.quantity); const u = Number(value); const t = Number(next.totalCost);
                  if (value && next.quantity && Number.isFinite(u) && u >= 0) next.totalCost = String(roundMoney(q * u));
                  else if (value && next.totalCost && Number.isFinite(u) && u > 0 && !next.quantity) next.quantity = String(roundMoney(t / u));
                  return next;
                });
              }} placeholder="Cost/unit" className={inp} />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Total cost (optional)</label>
              <input type="number" value={purchaseForm.totalCost} onChange={e => {
                const value = e.target.value;
                setPurchaseForm(f => {
                  const next = { ...f, totalCost: value };
                  const q = Number(next.quantity); const u = Number(next.unitCost); const t = Number(value);
                  if (value && next.quantity && Number.isFinite(t) && t >= 0) next.unitCost = q > 0 ? String(roundMoney(t / q)) : next.unitCost;
                  else if (value && next.unitCost && Number.isFinite(t) && t >= 0 && !next.quantity && u > 0) next.quantity = String(roundMoney(t / u));
                  return next;
                });
              }} placeholder="Total cost" className={inp} />
            </div>
            <input type="text" value={purchaseForm.note} onChange={e => setPurchaseForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className={inp} />
            <button disabled={purchaseSaving} onClick={async () => {
              const qty = Number(purchaseForm.quantity);
              const unitCost = purchaseForm.unitCost.trim()
                ? Number(purchaseForm.unitCost)
                : (purchaseForm.totalCost.trim() && qty > 0 ? Number(purchaseForm.totalCost) / qty : NaN);
              const finalQty = qty > 0 ? qty : (purchaseForm.totalCost.trim() && purchaseForm.unitCost.trim() ? Number(purchaseForm.totalCost) / Number(purchaseForm.unitCost) : 0);
              setPurchaseSaving(true);
              try {
                await inventoryApi.recordPurchase(purchaseForm.productId, finalQty, purchaseForm.unit, unitCost, purchaseForm.note, selectedStoreId, crypto.randomUUID());
                setShowPurchase(false);
                await load();
              } catch (e: any) { alert(e?.response?.data?.error || 'Purchase failed'); }
              finally { setPurchaseSaving(false); }
            }} className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50">
              {purchaseSaving ? 'Saving...' : 'Save Purchase'}
            </button>
          </div>
        </div>
      )}

      {/* Movement ledger modal */}
      {showMovements && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Inventory Movement Ledger</h3>
              <button onClick={() => setShowMovements(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {movementsLoading ? <p className="text-sm text-gray-500">Loading...</p> : movements.map(m => (
                <div key={m.id} className="text-xs border border-gray-100 dark:border-slate-700 rounded-xl p-2">
                  <div className="flex justify-between font-semibold">
                    <span>{m.movementType}</span>
                    <span>{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                  </div>
                  <div>In: {m.quantityIn} · Out: {m.quantityOut} · Balance: {m.newBalance} · Cost: {m.totalCost ?? '-'}</div>
                  <div className="text-gray-500">{m.reason}{m.remarks ? ` · ${m.remarks}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stock adjustment modal */}
      {showAdjust && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Adjust Stock</h3>
              <button onClick={() => setShowAdjust(false)}><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="relative">
              <input type="text" value={adjustQuery}
                onFocus={() => setAdjustShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setAdjustShowSuggestions(false), 120)}
                onChange={e => { setAdjustQuery(e.target.value); setAdjustForm(f => ({ ...f, productId: '' })); }}
                placeholder="Search product name or Hindi name"
                className={inp} />
              {adjustQuery && (
                <button type="button" onClick={() => { setAdjustQuery(''); setAdjustForm(f => ({ ...f, productId: '' })); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              {adjustShowSuggestions && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                  {items.filter(item => {
                    const q = adjustQuery.trim().toLowerCase();
                    return !q || item.name.toLowerCase().includes(q) || (item.localName || '').toLowerCase().includes(q) || (item.searchAliases ?? []).some((a: string) => a.toLowerCase().includes(q));
                  }).slice(0, 12).map(item => (
                    <button key={item.productId} type="button" onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setAdjustForm(f => ({ ...f, productId: item.productId }));
                        setAdjustQuery(`${item.name}${item.localName ? ` (${item.localName})` : ''}`);
                        setAdjustShowSuggestions(false);
                      }}
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</span>
                      <span className="text-xs text-slate-400">
                        {item.localName ? `${item.localName} · ` : ''}{item.stockQuantity != null ? `${item.stockQuantity} ${item.stockUnit || item.sellingUnit}` : 'Not tracked'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <input type="number" value={adjustForm.quantity} onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Qty (+/-)" className={inp} />
                <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {items.find(i => i.productId === adjustForm.productId)?.stockUnit || items.find(i => i.productId === adjustForm.productId)?.sellingUnit || 'unit'}
                </span>
              </div>
              <select value={adjustForm.reason} onChange={e => setAdjustForm(f => ({ ...f, reason: e.target.value }))} className={inp}>
                <option value="damage">Damage</option>
                <option value="spoiled">Spoiled</option>
                <option value="expired">Expired</option>
                <option value="lost">Lost</option>
                <option value="missing">Missing</option>
                <option value="consumption">Consumption</option>
                <option value="quality_rejection">Quality rejection</option>
                <option value="other">Other</option>
              </select>
            </div>
            <input type="text" value={adjustForm.note} onChange={e => setAdjustForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className={inp} />
            <button disabled={adjustSaving} onClick={async () => {
              setAdjustSaving(true);
              try {
                await inventoryApi.adjustStock(adjustForm.productId, Number(adjustForm.quantity), adjustForm.reason, adjustForm.note, selectedStoreId, crypto.randomUUID());
                setShowAdjust(false);
                await load();
              } catch (e: any) { alert(e?.response?.data?.error || 'Adjustment failed'); }
              finally { setAdjustSaving(false); }
            }} className="w-full py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl disabled:opacity-50">
              {adjustSaving ? 'Saving...' : 'Save Adjustment'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
