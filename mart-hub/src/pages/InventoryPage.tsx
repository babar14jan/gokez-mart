import { useEffect, useState, useMemo } from 'react';
import {
  Package, Pencil, Eye, Loader2, Save, X,
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  History, ArrowDownCircle, Plus, Search,
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
}

interface LogEntry {
  id: string; changeQty: number; reason: string;
  orderNumber: string | null; note: string | null;
  createdAt: string; createdByName: string | null; createdByUsername: string | null;
  stockUnit: string | null;
}

interface EditRow {
  qty: string;
  stockUnit: string;
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
  const [inventoryPolicy, setInventoryPolicy] = useState({ autoOutOfStock: true, lowStockThreshold: '' });
  const [editMode, setEditMode] = useState(false);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortLowFirst, setSortLowFirst] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // History drawer
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
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
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const [purchaseShowSuggestions, setPurchaseShowSuggestions] = useState(false);

  const { role } = useAuthStore();
  const canManageTracking = role === 'super_admin' || role === 'store_owner' || role === 'store_manager';
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => getActiveStoreId());
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
      setSelectedStoreId(prev => {
        if (list.some((s: any) => s.id === prev)) return prev;
        const own = list.find((s: any) => s.isOwn)?.id;
        return own || list[0]?.id || prev;
      });
    }).catch(() => {});
  }, [role]);

  const load = async (fresh = false) => {
    const [inv, meta] = await Promise.all([
      inventoryApi.getAll(selectedStoreId, { fresh }),
      inventoryApi.getSettings(selectedStoreId),
    ]);
    setItems([...(inv.data.data || [])]);
    setTrackingEnabled(Boolean(meta.data.data?.inventoryTracking));
    setInventoryPolicy({
      autoOutOfStock: meta.data.data?.autoOutOfStock !== false,
      lowStockThreshold: meta.data.data?.lowStockThreshold == null ? '' : String(meta.data.data.lowStockThreshold),
    });
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

  const sorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = query
      ? items.filter(i => i.name.toLowerCase().includes(query) || (i.localName || '').toLowerCase().includes(query)
        || (i.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query)))
      : [...items];
    if (!sortLowFirst) return list;
    const order = { out: 0, low: 1, ok: 2, untracked: 3 };
    return list.sort((a, b) => order[stockStatus(a)] - order[stockStatus(b)]);
  }, [items, sortLowFirst, searchQuery]);

  const tracked  = items.filter(i => i.stockQuantity !== null);
  const outCount = items.filter(i => stockStatus(i) === 'out').length;
  const lowCount = items.filter(i => stockStatus(i) === 'low').length;
  const activeLowStockThreshold = Number(inventoryPolicy.lowStockThreshold || DEFAULT_LOW_THRESHOLD);

  const enterEditMode = () => {
    const rows: Record<string, EditRow> = {};
    items.forEach(item => {
      rows[item.productId] = { qty: '', stockUnit: item.stockUnit || 'kg' };
    });
    setEditRows(rows);
    setNote('');
    setEditMode(true);
  };

  const cancelEdit = () => { setEditMode(false); setEditRows({}); setNote(''); };

  const handleStoreChange = (id: string) => {
    if (id === selectedStoreId) return;
    cancelEdit();
    setHistoryItem(null);
    setHistory([]);
    setSearchQuery('');
    setLoading(true);
    setSelectedStoreId(id);
  };

  const handleSaveAll = async () => {
    const toSave = Object.entries(editRows)
      .filter(([, row]) => row.qty !== '' && !isNaN(parseFloat(row.qty)) && parseFloat(row.qty) !== 0)
      .map(([productId, row]) => ({ productId, qty: parseFloat(row.qty), stockUnit: row.stockUnit }));

    if (toSave.length === 0) { cancelEdit(); return; }

    setSaving(true);
    try {
      await inventoryApi.bulkRestock(toSave, note, selectedStoreId, crypto.randomUUID());
      setEditMode(false);
      setEditRows({});
      setNote('');
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const openHistory = async (item: InventoryItem) => {
    setHistoryItem(item);
    setHistoryLoading(true);
    try {
      const res = await inventoryApi.getHistory(item.productId, selectedStoreId);
      setHistory(res.data.data || []);
    } finally { setHistoryLoading(false); }
  };

  const pendingCount = Object.values(editRows).filter(r => r.qty !== '' && !isNaN(parseFloat(r.qty)) && parseFloat(r.qty) !== 0).length;

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
      {canSwitchStores && (
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 flex-shrink-0">Zone store</span>
          <select
            value={selectedStoreId}
            onChange={e => handleStoreChange(e.target.value)}
            aria-label="Select store to manage inventory for"
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-gray-900 dark:text-white focus:outline-none cursor-pointer"
          >
            {manageableStores.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.isOwn ? ' — Head store' : ''}</option>
            ))}
          </select>
        </div>
      )}

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

      {/* Inventory KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="kpi-card h-full cursor-default p-3">
          <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Package className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-bold leading-none text-gray-900 dark:text-white">{tracked.length}</p><p className="mt-1 text-[10px] font-semibold text-gray-500 dark:text-slate-400">Tracked</p></div></div>
        </div>
        <div className="kpi-card h-full cursor-default border-amber-200 p-3 hover:border-amber-300 dark:border-amber-900/50">
          <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-bold leading-none text-amber-600 dark:text-amber-400">{lowCount}</p><p className="mt-1 truncate text-[10px] font-semibold text-gray-500 dark:text-slate-400">Low stock ≤{activeLowStockThreshold}</p></div></div>
        </div>
        <div className="kpi-card h-full cursor-default border-red-200 p-3 hover:border-red-300 dark:border-red-900/50">
          <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"><ArrowDownCircle className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-bold leading-none text-red-600 dark:text-red-400">{outCount}</p><p className="mt-1 text-[10px] font-semibold text-gray-500 dark:text-slate-400">Out of stock</p></div></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {!editMode ? (
          <>
            <button onClick={() => setSortLowFirst(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                sortLowFirst
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                  : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-emerald-300'
              }`}>
              {sortLowFirst ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Low Stock First
            </button>
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input type="text" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search inventory..." className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-9 pr-8 text-xs text-gray-900 placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
              {searchQuery && <button onClick={() => setSearchQuery('')} aria-label="Clear inventory search" className="absolute right-2 top-1/2 -translate-y-1/2"><X className="h-3.5 w-3.5 text-gray-500 hover:text-gray-700" /></button>}
            </div>
            <button onClick={() => { setPurchaseForm({ productId: '', quantity: '', unit: items[0]?.stockUnit || 'kg', unitCost: '', totalCost: '', note: '' }); setPurchaseQuery(''); setShowPurchase(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
              <Plus className="w-3.5 h-3.5" /> Record Purchase
            </button>
            <button onClick={() => { setAdjustForm({ productId: items[0]?.productId || '', quantity: '', reason: 'damage', note: '' }); setShowAdjust(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-red-400 hover:text-red-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" /> Adjust Stock
            </button>
            <button onClick={() => { window.location.href = '/daily-sales'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
              <Plus className="w-3.5 h-3.5" /> Offline Sale
            </button>
            <button onClick={() => { setActiveTab('ledger'); void loadMovements(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-gray-400 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
              <History className="w-3.5 h-3.5" /> View Ledger
            </button>
            <button onClick={enterEditMode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
              <Pencil className="w-3.5 h-3.5" /> Update Stock
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
              <Eye className="w-3.5 h-3.5" />
              {pendingCount > 0 ? (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{pendingCount} item{pendingCount !== 1 ? 's' : ''} to update</span>
              ) : 'Enter +qty to add, -qty to reduce'}
            </div>
            <div className="flex-1" />
            <button onClick={cancelEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-gray-50 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={handleSaveAll} disabled={saving || pendingCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50 transition-colors shadow-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save All
            </button>
          </>
        )}
      </div>

      {/* Note field — edit mode only */}
      {editMode && (
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium flex-shrink-0">Note:</span>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Morning delivery, Supplier stock..."
            className="flex-1 bg-transparent text-xs text-gray-700 dark:text-slate-300 placeholder:text-gray-500 focus:outline-none"
          />
        </div>
      )}

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
              const row = editRows[item.productId];
              const newTotal = row?.qty && !isNaN(parseFloat(row.qty)) && parseFloat(row.qty) !== 0
                ? Math.max(0, (item.stockQuantity ?? 0) + parseFloat(row.qty))
                : null;
              const isReduction = row?.qty && parseFloat(row.qty) < 0;

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
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name}</p>
                    {item.localName && <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{item.localName}</p>}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 dark:text-slate-400">{item.sellingUnit}</span>
                      {item.categoryName && (
                        <span className="text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{item.categoryName}</span>
                      )}
                      {s === 'out' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Out</span>}
                      {s === 'low' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Low</span>}
                      {s === 'ok' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />OK</span>}
                    </div>
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

                  {/* Edit mode: qty input + unit inline, new total below */}
                  {editMode && row ? (
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <div className={`flex items-center bg-gray-50 dark:bg-slate-700 border rounded-xl overflow-hidden transition-all focus-within:ring-2 ${
                        row.qty && parseFloat(row.qty) < 0
                          ? 'border-red-300 dark:border-red-700 focus-within:border-red-400 focus-within:ring-red-500/20'
                          : 'border-gray-200 dark:border-slate-600 focus-within:border-emerald-500 focus-within:ring-emerald-500/20'
                      }`}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.qty}
                          onChange={e => {
                            const val = e.target.value.replace(/[^0-9.\-]/g, '').replace(/(?!^)-/g, '');
                            setEditRows(prev => ({ ...prev, [item.productId]: { ...prev[item.productId], qty: val } }));
                          }}
                          placeholder="±qty"
                          className="w-14 px-2 py-1.5 text-sm font-semibold text-center bg-transparent text-gray-900 dark:text-white focus:outline-none"
                        />
                        <select
                          value={row.stockUnit}
                          onChange={e => setEditRows(prev => ({ ...prev, [item.productId]: { ...prev[item.productId], stockUnit: e.target.value } }))}
                          className="text-xs font-semibold text-gray-600 dark:text-slate-300 bg-transparent border-l border-gray-200 dark:border-slate-600 px-1.5 py-1.5 focus:outline-none cursor-pointer">
                          {STOCK_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      {newTotal !== null && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isReduction
                            ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                            : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                        }`}>
                          → {formatStock(newTotal, row.stockUnit)}
                        </span>
                      )}
                    </div>
                  ) : (
                    /* View mode: history button */
                    <button onClick={() => openHistory(item)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex-shrink-0"
                      title="Stock history">
                      <History className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History drawer */}
      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setHistoryItem(null)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Stock History</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate max-w-[260px]">{historyItem.name}</p>
              </div>
              <button onClick={() => setHistoryItem(null)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No history yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map(entry => {
                    const isPos = entry.changeQty > 0;
                    const label = entry.reason === 'restock' ? 'Restock' : entry.reason === 'order_deducted' ? 'Order' : 'Manual correction';
                    const date = new Date(entry.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
                    return (
                      <div key={entry.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-700">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isPos ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                          {isPos ? <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{label}</span>
                            <span className={`text-sm font-bold ${isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                              {isPos ? '+' : ''}{entry.changeQty} {entry.stockUnit || ''}
                            </span>
                          </div>
                          {entry.orderNumber && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Order #{entry.orderNumber}</p>}
                          {entry.note && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{entry.note}</p>}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-gray-500 dark:text-slate-400">{entry.createdByName || entry.createdByUsername || 'System'}</span>
                            <span className="text-[10px] text-gray-500 dark:text-slate-400">{date}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
              <select value={purchaseForm.unit} onChange={e => setPurchaseForm(f => ({ ...f, unit: e.target.value }))} className={inp}>
                {STOCK_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
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
