import { useEffect, useState, useMemo } from 'react';
import {
  Package, Pencil, Eye, Loader2, Save, X,
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  History, ArrowDownCircle, Plus,
} from 'lucide-react';
import { inventoryApi, settingsApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';

interface InventoryItem {
  productId: string;
  name: string;
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

function stockStatus(item: InventoryItem): 'untracked' | 'out' | 'low' | 'ok' {
  if (item.stockQuantity === null) return 'untracked';
  if (item.stockQuantity <= 0) return 'out';
  // Only show 'low' if a threshold has been explicitly set
  if (item.lowStockThreshold !== null && item.stockQuantity <= item.lowStockThreshold) return 'low';
  return 'ok';
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortLowFirst, setSortLowFirst] = useState(true);

  // History drawer
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const storeId = getActiveStoreId();

  const load = async () => {
    const [inv, sets] = await Promise.all([
      inventoryApi.getAll(storeId),
      settingsApi.getAll(storeId),
    ]);
    setItems([...(inv.data.data || [])]);
    const settingsArr: { key: string; value: string }[] = sets.data.data || [];
    setTrackingEnabled(settingsArr.find(s => s.key === 'inventory_tracking')?.value === 'true');
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => {
    if (!sortLowFirst) return items;
    const order = { out: 0, low: 1, ok: 2, untracked: 3 };
    return [...items].sort((a, b) => order[stockStatus(a)] - order[stockStatus(b)]);
  }, [items, sortLowFirst]);

  const tracked  = items.filter(i => i.stockQuantity !== null);
  const outCount = tracked.filter(i => (i.stockQuantity ?? 0) <= 0).length;
  const lowCount = tracked.filter(i => {
    if ((i.stockQuantity ?? 0) <= 0) return false;
    return i.lowStockThreshold !== null && (i.stockQuantity ?? 0) <= i.lowStockThreshold;
  }).length;

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

  const handleSaveAll = async () => {
    const toSave = Object.entries(editRows)
      .filter(([, row]) => row.qty !== '' && !isNaN(parseFloat(row.qty)) && parseFloat(row.qty) !== 0)
      .map(([productId, row]) => ({ productId, qty: parseFloat(row.qty), stockUnit: row.stockUnit }));

    if (toSave.length === 0) { cancelEdit(); return; }

    setSaving(true);
    try {
      await inventoryApi.bulkRestock(toSave, note, storeId);
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
      const res = await inventoryApi.getHistory(item.productId, storeId);
      setHistory(res.data.data || []);
    } finally { setHistoryLoading(false); }
  };

  const pendingCount = Object.values(editRows).filter(r => r.qty !== '' && !isNaN(parseFloat(r.qty)) && parseFloat(r.qty) !== 0).length;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!trackingEnabled) return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <Package className="w-12 h-12 text-gray-200 dark:text-slate-700" />
      <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">Inventory tracking is off</p>
      <p className="text-xs text-gray-400 dark:text-slate-500">Enable it in Settings → Inventory to start tracking stock.</p>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-2 text-center">
          <p className="text-base font-bold text-gray-900 dark:text-white">{tracked.length}</p>
          <p className="text-[10px] text-gray-400 dark:text-slate-500">Tracked</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-amber-100 dark:border-amber-900/30 px-3 py-2 text-center">
          <p className="text-base font-bold text-amber-600 dark:text-amber-400">{lowCount}</p>
          <p className="text-[10px] text-gray-400 dark:text-slate-500">Low Stock</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-red-100 dark:border-red-900/30 px-3 py-2 text-center">
          <p className="text-base font-bold text-red-600 dark:text-red-400">{outCount}</p>
          <p className="text-[10px] text-gray-400 dark:text-slate-500">Out of Stock</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
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
            <div className="flex-1" />
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
            className="flex-1 bg-transparent text-xs text-gray-700 dark:text-slate-300 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
      )}

      {/* Inventory table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No products found.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {sorted.map(item => {
              const s = stockStatus(item);
              const stockColor = s === 'out' ? 'text-red-600 dark:text-red-400'
                : s === 'low' ? 'text-amber-600 dark:text-amber-400'
                : s === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-gray-300 dark:text-slate-600';
              const row = editRows[item.productId];
              const newTotal = row?.qty && !isNaN(parseFloat(row.qty)) && parseFloat(row.qty) !== 0
                ? Math.max(0, (item.stockQuantity ?? 0) + parseFloat(row.qty))
                : null;
              const isReduction = row?.qty && parseFloat(row.qty) < 0;

              return (
                <div key={item.productId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  {/* Photo */}
                  {item.photoUrl ? (
                    <img src={item.photoUrl} alt={item.name} loading="lazy"
                      className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-gray-100 dark:border-slate-600" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <Package className="w-5 h-5 text-gray-300" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400 dark:text-slate-500">{item.sellingUnit}</span>
                      {item.categoryName && (
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{item.categoryName}</span>
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
                      <p className="text-sm text-gray-300 dark:text-slate-600">—</p>
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
                      className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex-shrink-0"
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
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
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
                          {entry.orderNumber && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">Order #{entry.orderNumber}</p>}
                          {entry.note && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{entry.note}</p>}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-gray-400 dark:text-slate-500">{entry.createdByName || entry.createdByUsername || 'System'}</span>
                            <span className="text-[10px] text-gray-400 dark:text-slate-500">{date}</span>
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
    </div>
  );
}
