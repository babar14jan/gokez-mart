import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Package, Loader2, X,
  AlertTriangle, CheckCircle,
  History, Plus, ArrowDownCircle, Search,
  Wallet, CalendarClock, Layers, TrendingUp, TrendingDown,
} from 'lucide-react';
import { inventoryApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import { useZoneSelectionStore } from '../store/zoneSelectionStore';
import { KpiCard } from '../components/referralUi';
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
  discountPercent?: number | null;
  availabilityStatus: string;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  categoryName: string | null;
  recentRestocks?: Array<{ changeQty: number; reason?: string | null; note: string | null; createdBy?: string | null; createdByUsername?: string | null; createdAt: string }>;
  storeId?: string;
  storeName?: string;
  isBundle?: boolean;
  comboComponents?: Array<{ productId: string; name: string; quantity: number; unit: string; price: number }> | null;
}

interface LogEntry {
  id: string; changeQty: number; reason: string;
  orderNumber: string | null; note: string | null;
  createdAt: string; createdByName: string | null; createdByUsername: string | null;
  stockUnit: string | null;
}

const roundMoney = (n: number) => Math.round(n * 100) / 100;

interface TodayReduction {
  reason: string;
  value: number;
  quantity: number;
  count: number;
}

interface ValuationSummary {
  storeId: string;
  snapshotDate: string;
  todayValue: number;
  yesterdayValue: number;
  changeValue: number;
  changePercent: number | null;
  trackedItems: number;
  costedItems: number;
  snapshotItems: number;
  yesterdayEstimated: boolean;
  todayAddedValue: number;
  todayAddedCount: number;
  todayReducedValue: number;
  todayReducedCount: number;
  todayReductions: TodayReduction[];
  generatedAt: string;
}

const EMPTY_VALUATION: ValuationSummary = {
  storeId: '', snapshotDate: '', todayValue: 0, yesterdayValue: 0,
  changeValue: 0, changePercent: null, trackedItems: 0, costedItems: 0,
  snapshotItems: 0, yesterdayEstimated: false,
  todayAddedValue: 0, todayAddedCount: 0, todayReducedValue: 0, todayReducedCount: 0,
  todayReductions: [], generatedAt: '',
};

function mergeValuation(summaries: ValuationSummary[]): ValuationSummary {
  if (summaries.length === 0) return EMPTY_VALUATION;
  const todayValue = summaries.reduce((sum, item) => sum + item.todayValue, 0);
  const yesterdayValue = summaries.reduce((sum, item) => sum + item.yesterdayValue, 0);
  const todayAddedValue = summaries.reduce((sum, item) => sum + (item.todayAddedValue || 0), 0);
  const todayReducedValue = summaries.reduce((sum, item) => sum + (item.todayReducedValue || 0), 0);
  const changeValue = roundMoney(todayValue - yesterdayValue);
  const reductions = new Map<string, TodayReduction>();
  for (const summary of summaries) {
    for (const row of summary.todayReductions || []) {
      const current = reductions.get(row.reason) || { reason: row.reason, value: 0, quantity: 0, count: 0 };
      current.value += row.value || 0;
      current.quantity += row.quantity || 0;
      current.count += row.count || 0;
      reductions.set(row.reason, current);
    }
  }
  return {
    ...EMPTY_VALUATION,
    todayValue: roundMoney(todayValue),
    yesterdayValue: roundMoney(yesterdayValue),
    changeValue,
    changePercent: summaries.some(item => item.changePercent === null || item.yesterdayValue <= 0)
      ? null
      : roundMoney((changeValue / yesterdayValue) * 100),
    trackedItems: summaries.reduce((sum, item) => sum + item.trackedItems, 0),
    costedItems: summaries.reduce((sum, item) => sum + item.costedItems, 0),
    snapshotItems: summaries.reduce((sum, item) => sum + item.snapshotItems, 0),
    yesterdayEstimated: summaries.some(item => item.yesterdayEstimated),
    todayAddedValue: roundMoney(todayAddedValue),
    todayAddedCount: summaries.reduce((sum, item) => sum + (item.todayAddedCount || 0), 0),
    todayReducedValue: roundMoney(todayReducedValue),
    todayReducedCount: summaries.reduce((sum, item) => sum + (item.todayReducedCount || 0), 0),
    todayReductions: [...reductions.values()]
      .map(row => ({ ...row, value: roundMoney(row.value), quantity: roundMoney(row.quantity) }))
      .sort((a, b) => b.value - a.value || a.reason.localeCompare(b.reason)),
    generatedAt: (() => {
      const times = summaries.map(item => item.generatedAt).sort();
      return times[times.length - 1] || '';
    })(),
  };
}

const formatMoney = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const REASON_LABELS: Record<string, string> = {
  damage: 'Damage', spoiled: 'Spoiled', expired: 'Expired', lost: 'Lost',
  missing: 'Missing', consumption: 'Offline Sold', quality_rejection: 'Quality check', other: 'Other',
  manual_correction: 'Adjustment', adjustment: 'Adjustment', restock: 'Restock', order_deducted: 'Order',
};
const formatReason = (reason?: string | null) => reason
  ? REASON_LABELS[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  : '';
const reductionLabel = formatReason;

const logAdjustment = (reason: string, note: string | null) => {
  if (reason !== 'manual_correction') return { label: formatReason(reason) || 'Adjustment', note: note || '' };
  const text = (note || '').trim();
  if (!text) return { label: 'Adjustment', note: '' };
  const separator = text.indexOf(':');
  const prefix = separator >= 0 ? text.slice(0, separator).trim() : text;
  if (REASON_LABELS[prefix] && prefix !== 'manual_correction') {
    return {
      label: `Adjustment · ${formatReason(prefix)}`,
      note: separator >= 0 ? text.slice(separator + 1).trim() : '',
    };
  }
  return { label: 'Adjustment', note: text };
};

const movementLabel = (type?: string | null) => {
  if (!type) return '';
  if (type === 'adjustment' || type === 'damage' || type === 'reconciliation') return 'Adjustment';
  return formatReason(type);
};

function formatStock(qty: number, unit: string): string {
  if (unit === 'kg' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} g`;
  if (unit === 'litre' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} ml`;
  return `${parseFloat(qty.toFixed(3))} ${unit}`;
}

const DEFAULT_LOW_THRESHOLD = 5; // used when no threshold is explicitly set

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
  const [valuation, setValuation] = useState<ValuationSummary>(EMPTY_VALUATION);
  const [valuationLoading, setValuationLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [enablingTracking, setEnablingTracking] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'stock_asc' | 'stock_desc'>('name');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'untracked' | 'ok'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Inline quick-edit state: track per-product pending stock edits so the whole
  // list can be saved in one batch instead of one product at a time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('inventory_selected_ids') || '[]')); } catch { return new Set(); }
  });
  const [inlineEdits, setInlineEdits] = useState<Record<string, { qty: string; action: '' | 'add' | 'remove' | 'set'; unit: string; reason: string; note: string; cost: string; totalCost: string }>>(() => {
    try { return JSON.parse(sessionStorage.getItem('inventory_inline_edits') || '{}'); } catch { return {}; }
  });
  const [inlineSaving, setInlineSaving] = useState(false);

  // History drawer
  const [activeTab, setActiveTab] = useState<'stock' | 'ledger'>('stock');
  const [movementSearch, setMovementSearch] = useState('');
  const [ledgerDateFilter, setLedgerDateFilter] = useState<'today' | 'yesterday' | 'all'>('all');
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem('inventory_selected_ids', JSON.stringify([...selectedIds])); } catch {}
  }, [selectedIds]);

  useEffect(() => {
    try { sessionStorage.setItem('inventory_inline_edits', JSON.stringify(inlineEdits)); } catch {}
  }, [inlineEdits]);

  const skipFilterResetRef = useRef(true);

  useEffect(() => {
    if (skipFilterResetRef.current) {
      skipFilterResetRef.current = false;
      return;
    }
    setSelectedIds(new Set());
    setInlineEdits({});
  }, [statusFilter, categoryFilter, searchQuery]);

  const { role } = useAuthStore();
  const canManageTracking = role === 'super_admin' || role === 'store_owner' || role === 'store_manager';
  // Zone selection lives in the shared store (header dropdown + this page),
  // never in the URL — store ids are internal and stay out of the address bar.
  const zoneInventoryStore = useZoneSelectionStore(s => s.inventoryStore);
  const setZoneInventoryStore = useZoneSelectionStore(s => s.setInventoryStore);
  const selectedStoreId = zoneInventoryStore;
  const [manageableStores, setManageableStores] = useState<Array<{ id: string; name: string; address?: string | null; isOwn?: boolean }>>([]);
  const loadSeq = useRef(0);
  const canSwitchStores = role !== 'super_admin' && manageableStores.length > 1;
  const selectedStore = manageableStores.find(s => s.id === selectedStoreId);
  // A zone head may manage stock for member stores even when that store's own
  // tracking switch is off, so the list is not hidden in that case.
  const managingMemberStore = canSwitchStores && selectedStore != null && !selectedStore.isOwn;

  // One-time migration from the old URL scheme: /inventory?store=<uuid> exposed
  // internal store ids in the address bar. Adopt the value once, then strip
  // the param so the URL stays clean.
  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get('store');
    if (!legacy) return;
    if (legacy !== 'all' && legacy !== selectedStoreId) setZoneInventoryStore(legacy);
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (role === 'super_admin') return;
    inventoryApi.getStores().then(r => {
      const list = r.data.data || [];
      setManageableStores(list);
      // Read the live value: the legacy-URL migration above may have just
      // adopted a store id after this effect captured `selectedStoreId`.
      const current = useZoneSelectionStore.getState().inventoryStore;
      if (current !== 'all' && !list.some((s: any) => s.id === current)) {
        const own = list.find((s: any) => s.isOwn)?.id || list[0]?.id;
        if (own) setZoneInventoryStore(own);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const load = async (fresh = false) => {
    // Store switches and the arrival of the manageable-store list can issue
    // overlapping loads; only the newest one may write state.
    const seq = ++loadSeq.current;
    setValuationLoading(true);
    if (selectedStoreId === 'all') {
      const stores = manageableStores.length ? manageableStores : [];
      const targetStores = stores.length ? stores : [{ id: getActiveStoreId(), name: 'This store', isOwn: true }];
      const results = await Promise.all(targetStores.map(async store => {
        const inv = await inventoryApi.getAll(store.id, { fresh });
        return (inv.data.data || []).map((item: any) => ({ ...item, storeId: store.id, storeName: store.name && store.name !== 'This store' ? store.name : undefined }));
      }));
      if (seq !== loadSeq.current) return;
      setItems(results.flat());
      try {
        const meta = await inventoryApi.getSettings(targetStores.find(s => s.isOwn)?.id || targetStores[0].id);
        setTrackingEnabled(Boolean(meta.data.data?.inventoryTracking));
      } catch { setTrackingEnabled(false); }
      const summaryResults = await Promise.all(targetStores.map(async store => {
        try {
          return (await inventoryApi.getValuationSummary(store.id)).data.data as ValuationSummary | undefined;
        } catch {
          return undefined;
        }
      }));
      const summaries = summaryResults.filter((summary): summary is ValuationSummary => Boolean(summary));
      if (seq === loadSeq.current) setValuation(summaries.length ? mergeValuation(summaries) : EMPTY_VALUATION);
      if (seq === loadSeq.current) setValuationLoading(false);
      setLoading(false);
      return;
    }

    const [inv, meta] = await Promise.all([
      inventoryApi.getAll(selectedStoreId, { fresh }),
      inventoryApi.getSettings(selectedStoreId),
    ]);
    if (seq !== loadSeq.current) return;
    setItems([...(inv.data.data || []).map((item: any) => ({ ...item, storeId: selectedStoreId, storeName: manageableStores.find(s => s.id === selectedStoreId)?.name || selectedStore }))]);
    setTrackingEnabled(Boolean(meta.data.data?.inventoryTracking));
    try {
      const summary = (await inventoryApi.getValuationSummary(selectedStoreId)).data.data as ValuationSummary;
      if (seq !== loadSeq.current) return;
      setValuation(summary);
    } catch {
      if (seq !== loadSeq.current) return;
      setValuation(EMPTY_VALUATION);
    }
    setValuationLoading(false);
    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedStoreId, manageableStores.length]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedStoreId, manageableStores.length]);

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
    let list = items.filter(item => !item.isBundle).filter(item => {
      const matchesQuery = !query
        || item.name.toLowerCase().includes(query)
        || (item.localName || '').toLowerCase().includes(query)
        || (item.searchAliases ?? []).some((alias: string) => alias.toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === 'all'
        || (statusFilter === 'untracked'
          ? stockStatus(item) === 'untracked'
          : stockStatus(item) === statusFilter);
      const matchesCategory = categoryFilter === 'all' || item.categoryName === categoryFilter;
      return matchesQuery && matchesStatus && matchesCategory;
    });
    const sortedList = [...list];
    if (sortBy === 'name') return sortedList.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'stock_asc') return sortedList.sort((a, b) => (a.stockQuantity ?? Number.MAX_SAFE_INTEGER) - (b.stockQuantity ?? Number.MAX_SAFE_INTEGER));
    if (sortBy === 'stock_desc') return sortedList.sort((a, b) => (b.stockQuantity ?? -1) - (a.stockQuantity ?? -1));
    return sortedList;  }, [items, sortBy, searchQuery, statusFilter, categoryFilter]);

  const visibleIds = sorted.map(item => item.productId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  const outCount = items.filter(i => stockStatus(i) === 'out').length;
  const lowCount = items.filter(i => stockStatus(i) === 'low').length;
  const untrackedCount = items.filter(i => !i.isBundle && stockStatus(i) === 'untracked').length;


  const loadMovements = async () => {
    setMovementsLoading(true);
    try {
      if (selectedStoreId === 'all') {
        const stores = manageableStores.length ? manageableStores : [{ id: getActiveStoreId() }];
        const results = await Promise.all(stores.map(s => inventoryApi.getMovements(s.id).catch(() => ({ data: { data: [] } }))));
        const merged = results.flatMap(r => r.data.data || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setMovements(merged);
      } else {
        const res = await inventoryApi.getMovements(selectedStoreId);
        setMovements(res.data.data || []);
      }
    } finally { setMovementsLoading(false); }
  };

  const openLedgerWithReason = (reason: string) => {
    setActiveTab('ledger');
    setLedgerDateFilter('today');
    setMovementSearch(reason);
    loadMovements();
  };

  const openHistory = async (item: InventoryItem) => {
    setHistoryItem(item);
    setHistoryLoading(true);
    try {
      const res = await inventoryApi.getHistory(item.productId, item.storeId || selectedStoreId);
      setHistory(res.data.data || []);
    } finally { setHistoryLoading(false); }
  };

  if (activeTab === 'ledger') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Inventory Movement Ledger</h2>
          <button onClick={() => setActiveTab('stock')} className="text-xs font-semibold text-emerald-600 hover:underline">Back to Stock</button>
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={movementSearch} onChange={e => setMovementSearch(e.target.value)}
            placeholder="Search product, reason or source"
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
          <div className="flex shrink-0 items-center gap-1">
            {(['today', 'yesterday', 'all'] as const).map(f => (
              <button key={f} onClick={() => setLedgerDateFilter(f)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${ledgerDateFilter === f ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {f === 'today' ? 'Today' : f === 'yesterday' ? (<><span className="sm:hidden">Y'day</span><span className="hidden sm:inline">Yesterday</span></>) : 'All'}
              </button>
            ))}
          </div>
        </div>
        {movementsLoading ? <p className="text-sm text-gray-500">Loading...</p> : (
          <div className="space-y-2">
            {movements.filter(m => {
              if (ledgerDateFilter !== 'all' && m.createdAt) {
                const d = new Date(m.createdAt);
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
                if (ledgerDateFilter === 'today' && d < startOfToday) return false;
                if (ledgerDateFilter === 'yesterday' && (d < startOfYesterday || d >= startOfToday)) return false;
              }
              const q = movementSearch.trim().toLowerCase();
              if (!q) return true;
              return [m.productName, m.productLocalName, m.movementType, movementLabel(m.movementType), m.reason, formatReason(m.reason), m.remarks, m.sourceType]
                .some(value => String(value || '').toLowerCase().includes(q));
            }).map(m => (
              <div key={m.id} className="rounded-xl border border-gray-100 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{m.productName || m.productId}{m.productLocalName ? ` (${m.productLocalName})` : ''}</span>
                  <span className="text-gray-500">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-gray-600 dark:text-slate-300">
                  <span className="font-semibold">{movementLabel(m.movementType) || m.movementType}</span>
                  <span>In: {m.quantityIn}</span>
                  <span>Out: {m.quantityOut}</span>
                  <span>Balance: {m.newBalance}</span>
                  {m.totalCost != null && <span>Cost: {m.totalCost}</span>}
                </div>
                <div className="mt-1 text-gray-500 dark:text-slate-400">
                  {[formatReason(m.reason), m.remarks, m.sourceType].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }


  const dirtyInlineCount = Object.keys(inlineEdits).filter(id => {
    if (!selectedIds.has(id)) return false;
    const e = inlineEdits[id];
    if (!e) return false;
    if (!e.action) return false;
    if (e.action === 'set') return true;
    return Boolean(e.qty) && Number(e.qty) !== 0;
  }).length;

  const saveInlineEdits = async () => {
    const entries = Object.entries(inlineEdits).filter(([id, e]) => selectedIds.has(id) && (e.action === 'add' || e.action === 'remove' || e.action === 'set') && (e.action === 'set' || (e.qty && Number(e.qty) !== 0)));
    if (entries.length === 0) return;
    setInlineSaving(true);
    try {
      for (const [productId, e] of entries) {
        const item = items.find(i => i.productId === productId);
        const storeId = (selectedStoreId && selectedStoreId !== 'all') ? selectedStoreId : (item?.storeId || selectedStoreId);
        const key = crypto.randomUUID();
        if (e.action === 'add') {
          await inventoryApi.restock(productId, Number(e.qty), e.note, storeId, e.unit || 'kg', key, e.cost ? Number(e.cost) : undefined);
        } else if (e.action === 'remove') {
          await inventoryApi.adjustStock(productId, -Math.abs(Number(e.qty)), e.reason, e.note, storeId, key);
        } else {
          await inventoryApi.setStock(productId, Number(e.qty), storeId, key, e.unit || 'kg');
        }
      }
      setInlineEdits({});
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Inline update failed');
    } finally {
      setInlineSaving(false);
    }
  };

  const discardInlineEdits = () => {
    setInlineEdits({});
    setSelectedIds(new Set());
  };

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
    <div className={`space-y-4 ${dirtyInlineCount > 0 ? 'pb-24' : ''}`}>

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

      <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Stock value now" value={valuationLoading ? '—' : formatMoney(valuation.todayValue)}
          sub={`${valuation.trackedItems} tracked items in scope`} icon={<Wallet className="w-4 h-4 text-white" />} gradient="from-emerald-400 to-green-600" wrap />
        <KpiCard label="Added today" value={valuationLoading ? '—' : formatMoney(valuation.todayAddedValue)}
          sub={`${valuation.todayAddedCount} inward movements today`} icon={<Plus className="w-4 h-4 text-white" />} gradient="from-emerald-400 to-teal-600" wrap />
        <KpiCard label="Reduced today"
          value={valuationLoading ? '—' : formatMoney(valuation.todayReducedValue)}
          sub={valuationLoading ? 'Loading...'
            : (valuation.todayReductions || [])[0]
              ? `${reductionLabel(valuation.todayReductions[0].reason)} ${formatMoney(valuation.todayReductions[0].value)}`
              : 'No wastage or adjustments today'}
          icon={<ArrowDownCircle className="w-4 h-4 text-white" />} gradient="from-rose-400 to-red-600" wrap />
        <KpiCard label="Costed stock lines" value={valuationLoading ? '—' : `${valuation.costedItems}/${valuation.trackedItems}`}
          sub={`${valuation.trackedItems - valuation.costedItems} uncosted items`} icon={<Layers className="w-4 h-4 text-white" />} gradient="from-amber-400 to-orange-600" wrap />
        <KpiCard label="Change vs yesterday"
          value={valuationLoading || valuation.changePercent === null ? '—'
            : `${valuation.changeValue >= 0 ? '+' : '-'}${Math.abs(valuation.changePercent).toFixed(1)}%`}
          sub={valuation.changePercent === null ? 'Needs yesterday snapshot'
            : `${valuation.changeValue >= 0 ? '+' : '-'}${formatMoney(Math.abs(valuation.changeValue))}`}
          icon={valuation.changeValue >= 0 ? <TrendingUp className="w-4 h-4 text-white" /> : <TrendingDown className="w-4 h-4 text-white" />}
          gradient={valuation.changeValue >= 0 ? 'from-emerald-400 to-green-600' : 'from-rose-400 to-red-600'} wrap />
        <KpiCard label="Yesterday closing value" value={valuationLoading ? '—' : formatMoney(valuation.yesterdayValue)}
          sub={valuation.snapshotItems === 0 ? 'No snapshot yet'
            : valuation.yesterdayEstimated ? 'Estimated from movement ledger' : `${valuation.snapshotItems} snapshotted items`}
          icon={<CalendarClock className="w-4 h-4 text-white" />} gradient="from-sky-400 to-blue-600" wrap />
      </div>

      {!valuationLoading && (valuation.todayReductions?.length || 0) > 0 && (
        <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
            <p className="text-xs font-bold text-rose-900 dark:text-rose-200">Today&apos;s reductions by reason</p>
            <span className="text-[11px] text-rose-700/80 dark:text-rose-300/80">Tap a reason to open the ledger</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {valuation.todayReductions.map(row => {
              const share = valuation.todayReducedValue > 0 ? (row.value / valuation.todayReducedValue) * 100 : 0;
              return (
                <button key={row.reason} type="button" onClick={() => openLedgerWithReason(row.reason)}
                  className="min-w-0 rounded-lg border border-rose-100 bg-white p-2 text-left transition-colors hover:border-rose-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-rose-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-gray-900 dark:text-white">{reductionLabel(row.reason)}</span>
                    <span className="whitespace-nowrap text-xs font-bold text-rose-700 dark:text-rose-300">{formatMoney(row.value)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                    {parseFloat(row.quantity.toFixed(2))} units · {row.count} {row.count === 1 ? 'entry' : 'entries'}
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-rose-500" style={{ width: `${share}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact filter pills + KPIs */}
      <div className="inline-flex shrink-0 flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900/40">
        {[
          { key: 'all', label: `All ${items.length}` },
          { key: 'out', label: `Out ${outCount}` },
          { key: 'low', label: `Low ${lowCount}` },
          ...(untrackedCount > 0 ? [{ key: 'untracked', label: `Untracked ${untrackedCount}` }] : []),
        ].map(pill => (
          <button key={pill.key} onClick={() => setStatusFilter(pill.key as any)}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-bold transition-colors sm:px-2.5 ${
              statusFilter === pill.key
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'
            }`}>
            {pill.label}
          </button>
        ))}
      </div>

      {/* Sort + category filter + quick actions */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <div className="flex shrink-0 items-center gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} title="Sort inventory"
            className="h-8 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white">
            <option value="name">Name (A-Z)</option>
            <option value="stock_asc">Stock low to high</option>
            <option value="stock_desc">Stock high to low</option>
          </select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="h-8 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white">
            <option value="all">All categories</option>
            {categories.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setActiveTab('ledger'); void loadMovements(); }}
            className="flex h-8 shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-gray-400 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <History className="w-3.5 h-3.5" /> View Ledger
          </button>
          <button onClick={() => { window.location.href = '/daily-sales'; }}
            className="flex h-8 shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-blue-400 hover:text-blue-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors">
            <Plus className="w-3.5 h-3.5" /> Offline Sale
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <input id="inventory-select-all" type="checkbox" checked={allVisibleSelected} onChange={event => { if (event.target.checked) setSelectedIds(new Set(visibleIds)); else setSelectedIds(new Set()); }} disabled={visibleIds.length === 0} className="h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
          <label htmlFor="inventory-select-all" className="shrink-0 text-xs font-semibold text-gray-600 dark:text-slate-300">Select all</label>
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input type="text" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search inventory..." className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-9 pr-8 text-xs text-gray-900 placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
          {searchQuery && <button onClick={() => setSearchQuery('')} aria-label="Clear inventory search" className="absolute right-2 top-1/2 -translate-y-1/2"><X className="h-3.5 w-3.5 text-gray-500 hover:text-gray-700" /></button>}
        </div>
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
              const inlineEdit = inlineEdits[item.productId];
              const isDirty = Boolean(inlineEdit && inlineEdit.qty && Number(inlineEdit.qty) !== 0);
              return (
                <div key={item.productId} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 shadow-sm transition-colors hover:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500">
                  {/* Bulk select */}
                  <input type="checkbox" checked={selectedIds.has(item.productId)}
                    onChange={e => {
                      setSelectedIds(prev => { const next = new Set(prev); if (e.target.checked) next.add(item.productId); else next.delete(item.productId); return next; });
                      if (!e.target.checked) setInlineEdits(prev => { const next = { ...prev }; delete next[item.productId]; return next; });
                    }}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
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
                      <button onClick={() => openHistory(item)}
                        className="shrink-0 p-1 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                        title="Stock history">
                        <History className="w-4 h-4" />
                      </button>
                      {item.isBundle && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />Combo</span>}
                      {s === 'out' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Out</span>}
                      {s === 'low' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full"><AlertTriangle className="w-2.5 h-2.5" />Low</span>}
                      {s === 'ok' && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />OK</span>}
                      {!item.isBundle && item.stockQuantity !== null && <span className={`text-xs font-bold tabular-nums ${s === 'out' ? 'text-red-600 dark:text-red-400' : s === 'low' ? 'text-amber-600 dark:text-amber-400' : s === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}>{formatStock(item.stockQuantity!, item.stockUnit || 'units')}</span>}
                      {!item.isBundle && item.stockQuantity === null && <span className="text-xs text-gray-500 dark:text-slate-400">—</span>}
                    </div>
                    {item.localName && <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{item.localName}</p>}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.price != null && item.price > 0 ? (
                        (item.discountPercent && item.discountPercent > 0) ? (
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            <span className="line-through opacity-60">₹{item.price}</span>
                            {' '}₹{Math.round(item.price * (1 - (item.discountPercent || 0) / 100))}/{item.sellingUnit}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-slate-400">₹{item.price}/{item.sellingUnit}</span>
                        )
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-slate-400">{item.sellingUnit}</span>
                      )}
                      {selectedStoreId === 'all' && item.storeName && item.storeName !== 'This store' && <span className="text-xs text-gray-500 dark:text-slate-400">· {item.storeName}</span>}
                    </div>
                    {item.recentRestocks?.length ? (
                      <div className="mt-1 space-y-0.5">
                        {item.recentRestocks.slice(0, 2).map((r, i) => {
                          const { label, note } = logAdjustment(r.reason || '', r.note || null);
                          return (
                            <p key={i} className="text-[10px] text-gray-500 dark:text-slate-400">
                              {label}: {r.changeQty > 0 ? '+' : ''}{r.changeQty} · {new Date(r.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })} · {r.createdBy || r.createdByUsername || 'System'}{note ? ` · ${note}` : ''}
                            </p>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Current stock / combo breakdown */}
                  {!item.isBundle && (
                    /* Inline quick edit */
                    <div className={`w-full grid grid-cols-2 gap-1.5 rounded-xl border-2 border-slate-300 bg-slate-100 p-2 dark:border-slate-500 dark:bg-slate-700/60 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5 ${selectedIds.has(item.productId) ? "" : "opacity-50 pointer-events-none"}`}>
                          <select value={inlineEdit?.action || ''}
                            onChange={e => setInlineEdits(prev => ({ ...prev, [item.productId]: { ...(prev[item.productId] || { qty: '', unit: item.stockUnit || 'kg', reason: 'damage', note: '', cost: '' }), action: e.target.value as any, qty: e.target.value === 'set' ? '0' : (prev[item.productId]?.qty || '') } }))}
                            className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                            <option value="">Select action</option>
                            <option value="add">Add</option>
                            <option value="remove">Remove</option>
                            <option value="set">Set (to 0)</option>
                          </select>
                          {(inlineEdit?.action === 'add' || inlineEdit?.action === 'remove') && (
                            <input type="number" value={inlineEdit?.qty || ''}
                              onChange={e => {
                                const value = e.target.value;
                                setInlineEdits(prev => {
                                  const cur = prev[item.productId] || { action: 'add', unit: item.stockUnit || 'kg', reason: 'damage', note: '', cost: '', totalCost: '' };
                                  const next = { ...cur, qty: value };
                                  const q = Number(value); const u = Number(next.cost); const t = Number(next.totalCost);
                                  if (value && next.cost && Number.isFinite(q) && q > 0) next.totalCost = String(roundMoney(q * u));
                                  else if (value && next.totalCost && Number.isFinite(q) && q > 0 && !next.cost) next.cost = String(roundMoney(t / q));
                                  return { ...prev, [item.productId]: next };
                                });
                              }}
                              placeholder="Qty" className="w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:w-16" />
                          )}
                          {inlineEdit?.action === 'add' && (
                            <>
                              <input type="text" value={inlineEdit?.unit || item.stockUnit || 'kg'}
                                onChange={e => setInlineEdits(prev => ({ ...prev, [item.productId]: { ...(prev[item.productId] || { action: 'add', qty: '', reason: 'damage', note: '', cost: '', totalCost: '' }), unit: e.target.value } }))}
                                placeholder="Unit" className="w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:w-14" />
                              <input type="number" value={inlineEdit?.cost || ''}
                                onChange={e => {
                                  const value = e.target.value;
                                  setInlineEdits(prev => {
                                    const cur = prev[item.productId] || { action: 'add', qty: '', unit: item.stockUnit || 'kg', reason: 'damage', note: '', totalCost: '' };
                                    const next = { ...cur, cost: value };
                                    const q = Number(next.qty); const u = Number(value); const t = Number(next.totalCost);
                                    if (value && next.qty && Number.isFinite(u) && u >= 0) next.totalCost = String(roundMoney(q * u));
                                    else if (value && next.totalCost && Number.isFinite(u) && u > 0 && !next.qty) next.qty = String(roundMoney(t / u));
                                    return { ...prev, [item.productId]: next };
                                  });
                                }}
                                placeholder="Cost/unit" className="w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:w-20" />
                              <input type="number" value={inlineEdit?.totalCost || ''}
                                onChange={e => {
                                  const value = e.target.value;
                                  setInlineEdits(prev => {
                                    const cur = prev[item.productId] || { action: 'add', qty: '', unit: item.stockUnit || 'kg', reason: 'damage', note: '', cost: '' };
                                    const next = { ...cur, totalCost: value };
                                    const q = Number(next.qty); const t = Number(value);
                                    if (value && next.qty && Number.isFinite(t) && t >= 0) next.cost = q > 0 ? String(roundMoney(t / q)) : next.cost;
                                    else if (value && next.cost && Number.isFinite(t) && t >= 0 && !next.qty) { const u = Number(next.cost); if (u > 0) next.qty = String(roundMoney(t / u)); }
                                    return { ...prev, [item.productId]: next };
                                  });
                                }}
                                placeholder="Total cost" className="w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:w-20" />
                            </>
                          )}
                          {inlineEdit?.action === 'remove' && (
                            <select value={inlineEdit?.reason || 'damage'}
                              onChange={e => setInlineEdits(prev => ({ ...prev, [item.productId]: { ...(prev[item.productId] || { action: 'remove', qty: '', unit: item.stockUnit || 'kg', note: '', cost: '' }), reason: e.target.value } }))}
                              className="col-span-2 w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:col-span-1 sm:w-auto">
                              <option value="damage">Damage</option>
                              <option value="spoiled">Spoiled</option>
                              <option value="expired">Expired</option>
                              <option value="lost">Lost</option>
                              <option value="missing">Missing</option>
                              <option value="consumption">Offline sold</option>
                              <option value="quality_rejection">Quality rejection</option>
                              <option value="other">Other (free text)</option>
                            </select>
                          )}
                          {(inlineEdit?.action === 'add' || inlineEdit?.action === 'remove' || inlineEdit?.action === 'set') && (inlineEdit?.action !== 'remove' || inlineEdit?.reason === 'other') && (
                            <input type="text" value={inlineEdit?.note || ''}
                              onChange={e => setInlineEdits(prev => ({ ...prev, [item.productId]: { ...(prev[item.productId] || { action: 'add', qty: '', unit: item.stockUnit || 'kg', reason: 'damage', cost: '' }), note: e.target.value } }))}
                              placeholder={inlineEdit?.action === 'remove' && inlineEdit?.reason === 'other' ? 'Describe reason...' : 'Note (optional)'}
                              className="col-span-2 w-full rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:col-span-1 sm:w-28" />
                          )}
                          {isDirty && <span className="text-[10px] font-bold text-amber-600">●</span>}
                        </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                    const { label, note } = logAdjustment(entry.reason, entry.note);
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
                          {note && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{note}</p>}
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

      {/* Floating save bar for inline edits */}
      {dirtyInlineCount > 0 && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px)+0.5rem)] left-11 right-11 z-50 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-lg dark:border-amber-700 dark:bg-amber-900/30 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:justify-start sm:bottom-24">
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">{dirtyInlineCount} unsaved change{dirtyInlineCount === 1 ? '' : 's'}</span>
          <button onClick={discardInlineEdits} className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700">Discard all</button>
          <button disabled={inlineSaving} onClick={saveInlineEdits}
            className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50">
            {inlineSaving ? 'Saving...' : 'Save all'}
          </button>
        </div>
      )}

    </div>
  );
}
