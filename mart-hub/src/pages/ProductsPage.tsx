import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Loader2, X, Package,
  Percent, GripVertical, Check, History, ArrowDownCircle,
  Camera, ChevronDown, SlidersHorizontal, ArrowUpDown,
} from 'lucide-react';
import { productsApi, categoriesApi, settingsApi, inventoryApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast, ToastContainer } from '../hooks/useToast';
import { useHeaderAction } from '../store/headerActionStore';

function formatStock(qty: number, unit: string): string {
  if (unit === 'kg' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} g`;
  if (unit === 'litre' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} ml`;
  return `${parseFloat(qty.toFixed(3))} ${unit}`;
}

interface Product {
  id: string; name: string; categoryId: string | null; categoryName: string;
  price: number; unit: string; discountPercent: number;
  isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  photoUrl: string | null; description: string | null;
  sortOrder: number;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  stockUnit: string | null;
}

interface Category {
  id: string; name: string; icon: string; sortOrder: number; productCount: number;
}

interface LogEntry {
  id: string; changeQty: number; reason: string;
  orderNumber: string | null; note: string | null;
  createdAt: string; createdByName: string | null; createdByUsername: string | null;
}

type SortMode = 'manual' | 'discount' | 'stock' | 'az';
type FilterStatus = 'all' | 'available' | 'out_of_stock' | 'low_stock' | 'hidden';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';
const UNITS = ['kg', 'g', 'pcs', 'dozen', 'litre', 'ml', 'bunch', 'packet'];
const STOCK_UNITS = ['kg', 'litre', 'pcs', 'bunch', 'packet'];

function stockStatus(p: Product): 'untracked' | 'out' | 'low' | 'ok' {
  if (p.stockQuantity === null) return 'untracked';
  if (p.stockQuantity <= 0) return 'out';
  if (p.lowStockThreshold !== null && p.stockQuantity <= p.lowStockThreshold) return 'low';
  return 'ok';
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [inventoryEnabled, setInventoryEnabled] = useState(false);
  const [form, setForm] = useState({
    name: '', categoryId: '', price: '', unit: '1 kg',
    discountPercent: '0', description: '',
    availabilityStatus: 'available' as 'available' | 'out_of_stock' | 'hidden',
  });

  // Filter + Sort (replaces tabs + sortModes)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Reorder
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderList, setReorderList] = useState<Product[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  // Restock
  const [restocking, setRestocking] = useState<Product | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [restockUnit, setRestockUnit] = useState('kg');
  const [restockNote, setRestockNote] = useState('');
  const [restockSaving, setRestockSaving] = useState(false);

  // History
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Last restock for edit modal
  const [lastRestock, setLastRestock] = useState<LogEntry | null>(null);

  const storeId = getActiveStoreId();
  const { setHeaderAction, clearHeaderAction } = useHeaderAction();
  const { toasts, show: showToast } = useToast();

  const load = async () => {
    const [p, c, s] = await Promise.all([
      productsApi.getAll(storeId),
      categoriesApi.getAll(),
      settingsApi.getAll(storeId),
    ]);
    setProducts([...(p.data.data || [])]);
    setCategories([...(c.data.data || [])]);
    const settingsArr: { key: string; value: string }[] = s.data.data || [];
    setInventoryEnabled(settingsArr.find(x => x.key === 'inventory_tracking')?.value === 'true');
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Filtered + sorted product list ───────────────────────────────────────
  const displayProducts = useMemo(() => {
    let list = [...products];

    // Category filter
    if (filterCategory !== 'all') {
      if (filterCategory === '__uncat__') list = list.filter(p => !p.categoryId);
      else list = list.filter(p => p.categoryId === filterCategory);
    }

    // Status filter
    if (filterStatus === 'available')   list = list.filter(p => p.availabilityStatus === 'available');
    if (filterStatus === 'out_of_stock') list = list.filter(p => p.availabilityStatus === 'out_of_stock');
    if (filterStatus === 'hidden')      list = list.filter(p => p.availabilityStatus === 'hidden');
    if (filterStatus === 'low_stock')   list = list.filter(p => stockStatus(p) === 'low');

    // Sort
    if (sortMode === 'discount') return list.sort((a, b) => b.discountPercent - a.discountPercent);
    if (sortMode === 'az')       return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === 'stock') {
      const order = { out: 0, low: 1, ok: 2, untracked: 3 };
      return list.sort((a, b) => order[stockStatus(a)] - order[stockStatus(b)]);
    }
    return list.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [products, filterStatus, filterCategory, sortMode]);

  // ── Reorder ───────────────────────────────────────────────────────────────
  const canReorder = filterStatus === 'all' && filterCategory === 'all' && sortMode === 'manual';

  const enterReorderMode = () => {
    setReorderList([...displayProducts].sort((a, b) => a.sortOrder - b.sortOrder));
    setReorderMode(true);
  };
  const handleDragStart = (i: number) => { dragItem.current = i; };
  const handleDragEnter = (i: number) => { dragOver.current = i; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOver.current === null) return;
    const updated = [...reorderList];
    const [moved] = updated.splice(dragItem.current, 1);
    updated.splice(dragOver.current, 0, moved);
    dragItem.current = null; dragOver.current = null;
    setReorderList(updated);
  };
  const saveReorder = async () => {
    setSavingOrder(true);
    try {
      await Promise.all(reorderList.map((p, i) => productsApi.update(p.id, { sortOrder: i })));
      await load(); setReorderMode(false);
    } finally { setSavingOrder(false); }
  };
  const cancelReorder = () => { setReorderMode(false); setReorderList([]); };

  // ── Filter/sort labels ────────────────────────────────────────────────────
  const filterStatusLabels: Record<FilterStatus, string> = {
    all: 'All Products', available: 'Available', out_of_stock: 'Out of Stock',
    low_stock: 'Low Stock', hidden: 'Hidden',
  };
  const sortLabels: Record<SortMode, string> = {
    manual: 'Manual Order', discount: 'By Discount',
    stock: 'Low Stock First', az: 'A → Z',
  };
  const activeCategoryLabel = filterCategory === 'all' ? 'All Categories'
    : filterCategory === '__uncat__' ? 'Uncategorised'
    : categories.find(c => c.id === filterCategory)?.name || 'All Categories';

  const filterActive = filterStatus !== 'all' || filterCategory !== 'all';
  const sortActive = sortMode !== 'manual';

  // ── Product CRUD ──────────────────────────────────────────────────────────
  const openCreate = useCallback(() => {
    setEditing(null);
    setForm({ name: '', categoryId: categories[0]?.id || '', price: '', unit: '1 kg', discountPercent: '0', description: '', availabilityStatus: 'available' });
    setPhotoFile(null); setPhotoPreview(null);
    setShowModal(true);
  }, [categories]);

  useEffect(() => {
    setHeaderAction('Add Product', openCreate);
    return () => clearHeaderAction();
  }, [openCreate]);

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, categoryId: p.categoryId || '', price: String(p.price),
      unit: p.unit, discountPercent: String(p.discountPercent),
      description: p.description || '',
      availabilityStatus: p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock'),
    });
    setPhotoFile(null); setPhotoPreview(p.photoUrl);
    setLastRestock(null);
    if (inventoryEnabled) {
      inventoryApi.getHistory(p.id, storeId).then(res => {
        const logs: LogEntry[] = res.data.data || [];
        setLastRestock(logs.find(l => l.reason === 'restock') || null);
      }).catch(() => {});
    }
    setShowModal(true);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let photoUrl = editing?.photoUrl || null;
      if (photoFile) {
        try { const res = await productsApi.uploadPhoto(photoFile); photoUrl = res.data.data.url; }
        catch (uploadErr: any) {
          alert(`Photo upload failed: ${uploadErr?.response?.data?.error || uploadErr?.message}\n\nSaving without photo.`);
          photoUrl = editing?.photoUrl || null;
        }
      }
      const data = { ...form, price: parseFloat(form.price), discountPercent: parseFloat(form.discountPercent), photoUrl, isAvailable: form.availabilityStatus === 'available' };
      if (editing) await productsApi.update(editing.id, { ...data, storeId });
      else await productsApi.create({ ...data, storeId });
      setShowModal(false); await load();
    } catch (err: any) {
      alert(`Failed to save: ${err?.response?.data?.error || err?.message}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await productsApi.delete(id);
    setConfirmDeleteId(null);
    showToast('Product deleted');
    await load();
  };

  const setAvailability = async (p: Product, status: 'available' | 'out_of_stock' | 'hidden') => {
    await productsApi.update(p.id, { availabilityStatus: status, storeId } as any); await load();
  };

  // ── Restock ───────────────────────────────────────────────────────────────
  const openRestock = (p: Product) => {
    setRestocking(p); setRestockQty('');
    setRestockUnit(p.stockUnit || 'kg'); setRestockNote('');
  };
  const handleRestock = async () => {
    if (!restocking || !restockQty) return;
    setRestockSaving(true);
    try {
      await inventoryApi.restock(restocking.id, parseFloat(restockQty), restockNote, storeId, restockUnit);
      setRestocking(null); await load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to restock'); }
    finally { setRestockSaving(false); }
  };

  // ── History ───────────────────────────────────────────────────────────────
  const openHistory = async (p: Product) => {
    setHistoryProduct(p); setHistoryLoading(true);
    try {
      const res = await inventoryApi.getHistory(p.id, storeId);
      setHistory(res.data.data || []);
    } finally { setHistoryLoading(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Product Row ───────────────────────────────────────────────────────────
  const ProductRow = ({ p, index }: { p: Product; index: number }) => {
    const cur = p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock');
    const s = stockStatus(p);
    const stockColor = s === 'out' ? 'text-red-600 dark:text-red-400'
      : s === 'low' ? 'text-amber-600 dark:text-amber-400'
      : 'text-emerald-600 dark:text-emerald-400';
    const availColor = cur === 'available'
      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
      : cur === 'out_of_stock'
      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
      : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600';

    return (
      <div
        className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-colors ${reorderMode ? 'cursor-grab active:cursor-grabbing' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
        draggable={reorderMode}
        onDragStart={() => handleDragStart(index)}
        onDragEnter={() => handleDragEnter(index)}
        onDragEnd={handleDragEnd}
        onDragOver={e => e.preventDefault()}
      >
        {reorderMode && <GripVertical className="w-5 h-5 text-gray-300 flex-shrink-0" />}

        {p.photoUrl ? (
          <img src={p.photoUrl} alt={p.name} loading="lazy" decoding="async"
            className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border-2 border-emerald-200 bg-gray-100 dark:bg-slate-700" />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-gray-300" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">{p.name}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-xs text-gray-500 dark:text-slate-400">{p.unit} · ₹{p.price}</span>
            {p.discountPercent > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                <Percent className="w-2.5 h-2.5" />{p.discountPercent}% off
              </span>
            )}
            {p.categoryName && (
              <span className="text-[10px] text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{p.categoryName}</span>
            )}
          </div>
        </div>

        {inventoryEnabled && !reorderMode && (
          <div className="flex-shrink-0 text-center min-w-[36px]">
            {p.stockQuantity !== null && p.stockUnit ? (
              <>
                <p className={`text-sm font-bold tabular-nums ${stockColor}`}>
                  {formatStock(p.stockQuantity, p.stockUnit)}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-300 dark:text-slate-600">—</p>
            )}
          </div>
        )}

        {!reorderMode && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select value={cur} onChange={e => setAvailability(p, e.target.value as any)} onClick={e => e.stopPropagation()}
              className={`text-[11px] sm:text-xs border rounded-lg px-1 sm:px-1.5 py-1 focus:outline-none cursor-pointer font-semibold ${availColor}`}>
              <option value="available">✅ On</option>
              <option value="out_of_stock">⚠️ Out</option>
              <option value="hidden">👁 Hide</option>
            </select>
            <button onClick={() => openEdit(p)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" onClick={() => { setShowFilterMenu(false); setShowSortMenu(false); }}>

      {/* Header: Filter | Sort | Reorder | Add Product (desktop) */}
      <div className="flex items-center gap-2">

        {/* Filter dropdown */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setShowFilterMenu(v => !v); setShowSortMenu(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              filterActive
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400'
                : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-indigo-300'
            }`}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {filterActive
              ? (filterStatus !== 'all' ? filterStatusLabels[filterStatus] : activeCategoryLabel)
              : 'Filter'}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showFilterMenu && (
            <div className="absolute left-0 top-full mt-1.5 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 z-30 overflow-hidden">
              {/* Status section */}
              <div className="px-3 pt-3 pb-1">
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Status</p>
                {(['all', 'available', 'out_of_stock', 'low_stock', 'hidden'] as FilterStatus[]).map(s => (
                  <button key={s} onClick={() => { setFilterStatus(s); setShowFilterMenu(false); }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      filterStatus === s ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400' : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}>
                    {filterStatusLabels[s]}
                    {filterStatus === s && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>
              {/* Category section */}
              <div className="px-3 pt-2 pb-3 border-t border-gray-100 dark:border-slate-700 mt-1">
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Category</p>
                {[{ id: 'all', name: 'All Categories' }, ...categories, { id: '__uncat__', name: 'Uncategorised' }].map(c => (
                  <button key={c.id} onClick={() => { setFilterCategory(c.id); setShowFilterMenu(false); }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      filterCategory === c.id ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400' : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}>
                    {c.name}
                    {filterCategory === c.id && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { setShowSortMenu(v => !v); setShowFilterMenu(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              sortActive
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-emerald-300'
            }`}>
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortLabels[sortMode]}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showSortMenu && (
            <div className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 z-30 overflow-hidden p-2">
              {(['manual', 'discount', 'stock', 'az'] as SortMode[]).map(m => (
                (!inventoryEnabled && m === 'stock') ? null :
                <button key={m} onClick={() => { setSortMode(m); setShowSortMenu(false); }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    sortMode === m ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}>
                  {sortLabels[m]}
                  {sortMode === m && <Check className="w-3 h-3" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reorder */}
        {!reorderMode ? (
          <button onClick={enterReorderMode} disabled={!canReorder}
            title={!canReorder ? 'Clear filters and use Manual Order to reorder' : ''}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <GripVertical className="w-3.5 h-3.5" /> Reorder
          </button>
        ) : (
          <>
            <button onClick={cancelReorder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-gray-50 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={saveReorder} disabled={savingOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-all">
              {savingOrder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save Order
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* Add Product — desktop only */}
        <button onClick={openCreate}
          className="hidden lg:flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
          <Plus className="w-3.5 h-3.5" /> Add Product
        </button>
      </div>

      {/* Active filter summary */}
      {filterActive && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {displayProducts.length} product{displayProducts.length !== 1 ? 's' : ''} shown
          </span>
          <button onClick={() => { setFilterStatus('all'); setFilterCategory('all'); }}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {/* Product list */}
      <div className="page-card">
        {products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No products yet. Add your first product.</p>
          </div>
        ) : reorderMode ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {reorderList.map((p, i) => <ProductRow key={p.id} p={p} index={i} />)}
          </div>
        ) : displayProducts.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No products match this filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {displayProducts.map((p, i) => <ProductRow key={p.id} p={p} index={i} />)}
          </div>
        )}
      </div>

      {/* Confirm delete (row) */}
      {confirmDeleteId && (
        <ConfirmDialog title="Delete Product" message="Are you sure? This cannot be undone." confirmLabel="Delete"
          onConfirm={async () => { await handleDelete(confirmDeleteId); }} onCancel={() => setConfirmDeleteId(null)} />
      )}

      <ToastContainer toasts={toasts} />

      {/* Double-confirm delete (modal) */}
      {confirmDeleteProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Delete Product?</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{confirmDeleteProduct.name}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
              This will permanently delete the product and all its stock history. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteProduct(null)}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              <button onClick={async () => { await handleDelete(confirmDeleteProduct.id); setConfirmDeleteProduct(null); }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors">
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Product' : 'Add Product'}</h2>
                {editing && (
                  <button onClick={() => setConfirmDeleteProduct(editing)}
                    className="ml-6 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo + inventory actions */}
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  {photoPreview ? (
                    <>
                      <img src={photoPreview} alt="" className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-400 shadow-sm" />
                      <label className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center shadow-md cursor-pointer transition-colors">
                        <Camera className="w-3.5 h-3.5 text-white" />
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                      </label>
                      <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md transition-colors">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </>
                  ) : (
                    <label className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-slate-700 border-2 border-dashed border-gray-300 dark:border-slate-500 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                      <Camera className="w-6 h-6 text-gray-400" />
                      <span className="text-[10px] text-gray-400">Add photo</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                    </label>
                  )}
                </div>
                {editing && inventoryEnabled && (
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex gap-2">
                      <button onClick={() => { setShowModal(false); openRestock(editing); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Restock
                      </button>
                      <button onClick={() => { setShowModal(false); openHistory(editing); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 hover:bg-gray-200 transition-colors">
                        <History className="w-3.5 h-3.5" /> Stock Log
                      </button>
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500 dark:text-slate-400">Stock</span>
                        <span className={`text-[11px] font-bold ${
                          editing.stockQuantity === null ? 'text-gray-400'
                          : editing.stockQuantity <= 0 ? 'text-red-600 dark:text-red-400'
                          : editing.stockQuantity <= (editing.lowStockThreshold ?? 5) ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {editing.stockQuantity !== null && editing.stockUnit ? formatStock(editing.stockQuantity, editing.stockUnit) : 'Not tracked'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500 dark:text-slate-400">Status</span>
                        <span className={`text-[11px] font-semibold ${editing.availabilityStatus === 'available' ? 'text-emerald-600 dark:text-emerald-400' : editing.availabilityStatus === 'out_of_stock' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                          {editing.availabilityStatus === 'available' ? '✅ Available' : editing.availabilityStatus === 'out_of_stock' ? '⚠️ Out of Stock' : '👁 Hidden'}
                        </span>
                      </div>
                      {lastRestock && (
                        <div className="flex items-center justify-between pt-0.5 border-t border-gray-200 dark:border-slate-600">
                          <span className="text-[11px] text-gray-500 dark:text-slate-400">Last restock</span>
                          <span className="text-[11px] text-gray-600 dark:text-slate-300">
                            +{lastRestock.changeQty} · {new Date(lastRestock.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Fresh Tomatoes" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Category</label>
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inp}>
                  <option value="">Uncategorised</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Price (₹) *</label>
                  <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className={inp} placeholder="0" min="0" step="0.5" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Unit</label>
                  <div className="flex gap-1.5">
                    <input type="number"
                      value={form.unit.match(/^(\d*\.?\d*)/)?.[1] || ''}
                      onChange={e => { const qty = e.target.value; const type = form.unit.replace(/^\d*\.?\d*\s*/, '') || 'kg'; setForm(f => ({ ...f, unit: `${qty} ${type}`.trim() })); }}
                      className={`${inp} w-16`} placeholder="1" min="0" step="0.5" />
                    <select
                      value={form.unit.replace(/^\d*\.?\d*\s*/, '') || 'kg'}
                      onChange={e => { const qty = form.unit.match(/^(\d*\.?\d*)/)?.[1] || '1'; setForm(f => ({ ...f, unit: `${qty} ${e.target.value}`.trim() })); }}
                      className={inp}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Discount %</label>
                <input type="number" value={form.discountPercent} onChange={e => setForm(f => ({ ...f, discountPercent: e.target.value }))} className={inp} placeholder="0" min="0" max="100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={`${inp} resize-none`} rows={2} placeholder="Optional description" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Availability</label>
                <select value={form.availabilityStatus} onChange={e => setForm(f => ({ ...f, availabilityStatus: e.target.value as any }))} className={inp}>
                  <option value="available">✅ Available</option>
                  <option value="out_of_stock">⚠️ Out of Stock</option>
                  <option value="hidden">👁 Hide</option>
                </select>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.price}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restock sheet */}
      {restocking && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setRestocking(null)} />
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Restock</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{restocking.name} · {restocking.unit} · <span className="text-emerald-600 dark:text-emerald-400 font-semibold">₹{restocking.price}</span></p>
              </div>
              <button onClick={() => setRestocking(null)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-slate-400">Current stock</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {restocking.stockQuantity !== null && restocking.stockUnit ? formatStock(restocking.stockQuantity, restocking.stockUnit) : 'Not set'}
              </span>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Add quantity *</label>
                  <input type="number" value={restockQty} min="0.001" step="0.001"
                    onChange={e => setRestockQty(e.target.value)} className={inp} placeholder="e.g. 5" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Unit</label>
                  <select value={restockUnit} onChange={e => setRestockUnit(e.target.value)} className={inp}>
                    {STOCK_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              {restockQty && parseFloat(restockQty) > 0 && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">New total</span>
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    {formatStock((restocking.stockQuantity ?? 0) + parseFloat(restockQty), restockUnit)}
                  </span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Note (optional)</label>
                <input type="text" value={restockNote} onChange={e => setRestockNote(e.target.value)} className={inp} placeholder="e.g. New stock arrived" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRestocking(null)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={handleRestock} disabled={restockSaving || !restockQty || parseFloat(restockQty) <= 0}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {restockSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History drawer */}
      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setHistoryProduct(null)}>
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Stock History</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate max-w-[260px]">{historyProduct.name}</p>
              </div>
              <button onClick={() => setHistoryProduct(null)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
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
                              {isPos ? '+' : ''}{entry.changeQty}
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
