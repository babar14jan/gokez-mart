import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Loader2, X, Package,
  Percent, GripVertical, Check, History, ArrowDownCircle,
  Camera, ChevronDown, SlidersHorizontal, ArrowUpDown, BookOpen, Search,
} from 'lucide-react';
import { productsApi, categoriesApi, inventoryApi, catalogApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import ConfirmDialog from '../components/ConfirmDialog';
import SmartImage from '../components/SmartImage';
import { useToast, ToastContainer } from '../hooks/useToast';
import { useHeaderAction } from '../store/headerActionStore';
import PageSkeleton from '../components/PageSkeleton';

function formatStock(qty: number, unit: string): string {
  if (unit === 'kg' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} g`;
  if (unit === 'litre' && qty < 1 && qty > 0) return `${Math.round(qty * 1000)} ml`;
  return `${parseFloat(qty.toFixed(3))} ${unit}`;
}

interface Product {
  id: string; name: string; categoryId: string | null; categoryName: string;
  localName: string | null;
  searchAliases: string[];
  price: number; unit: string; discountPercent: number;
  approxWeight: string | null;
  isAvailable: boolean;
  isBundle: boolean;
  isCatalog: boolean;
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
const parseSearchAliases = (value: string) => value.split(',').map(alias => alias.trim()).filter(Boolean);

function stockStatus(p: Product): 'untracked' | 'out' | 'low' | 'ok' {
  if (p.stockQuantity === null) return 'untracked';
  if (p.stockQuantity <= 0) return 'out';
  if (p.lowStockThreshold !== null && p.stockQuantity <= p.lowStockThreshold) return 'low';
  return 'ok';
}

export default function ProductsPage() {
  const { role } = useAuthStore();
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => getActiveStoreId());
  const [manageableStores, setManageableStores] = useState<Array<{ id: string; name: string; address?: string | null; isOwn?: boolean }>>([]);
  const canSwitchStores = role !== 'super_admin' && manageableStores.length > 1;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [comboSaving, setComboSaving] = useState(false);
  const [comboName, setComboName] = useState('');
  const [comboLocalName, setComboLocalName] = useState('');
  const [comboSearchAliases, setComboSearchAliases] = useState('');
  const [editingCombo, setEditingCombo] = useState<Product | null>(null);
  const [comboCategoryId, setComboCategoryId] = useState('');
  const [comboPrice, setComboPrice] = useState('');
  const [comboUnit, setComboUnit] = useState('1 combo');
  const [comboPhotoFile, setComboPhotoFile] = useState<File | null>(null);
  const [comboPhotoPreview, setComboPhotoPreview] = useState<string | null>(null);
  const [comboComponents, setComboComponents] = useState<Array<{ productId: string; quantity: string; unit: string }>>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [inventoryEnabled, setInventoryEnabled] = useState(false);
  const [form, setForm] = useState({
    name: '', localName: '', searchAliases: '', categoryId: '', price: '', unit: '1 kg',
    approxWeight: '',
    discountPercent: '0', finalPrice: '', description: '',
    availabilityStatus: 'available' as 'available' | 'out_of_stock' | 'hidden',
  });

  // Filter + Sort (replaces tabs + sortModes)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem('hub_products_sort') as SortMode) || 'manual'
  );
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
  // Inline stock update in edit modal
  const [inlineStockQty, setInlineStockQty] = useState('');
  const [inlineStockNote, setInlineStockNote] = useState('');
  const [inlineStockSaving, setInlineStockSaving] = useState(false);

  // History
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Last restock for edit modal
  const [lastRestock, setLastRestock] = useState<LogEntry | null>(null);

  const storeId = selectedStoreId;
  const { clearHeaderAction } = useHeaderAction();
  const { toasts, show: showToast } = useToast();

  // Catalog browser state
  interface CatalogItem { id: string; name: string; localName: string | null; searchAliases: string[]; photoUrl: string | null; categoryId: string | null; categoryName: string | null; categoryIcon: string | null; }
  const [showCatalogBrowser, setShowCatalogBrowser] = useState(false);
  const [catalogBrowserMode, setCatalogBrowserMode] = useState<'single' | 'bulk'>('single');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCat, setCatalogCat] = useState('all');
  const [catalogSelected, setCatalogSelected] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
  const [catalogConflicts, setCatalogConflicts] = useState<Array<{ productId: string; storeId: string; storeName: string }>>([]);

  const openCatalogBrowser = async (mode: 'single' | 'bulk') => {
    setCatalogBrowserMode(mode);
    setCatalogSearch(''); setCatalogCat('all'); setCatalogSelected(new Set());
    setShowCatalogBrowser(true);
    if (catalogItems.length === 0) {
      setCatalogLoading(true);
      try { const res = await catalogApi.getAll(); setCatalogItems(res.data.data || []); }
      catch {} finally { setCatalogLoading(false); }
    }
  };

  const catalogFiltered = useMemo(() => catalogItems.filter(p => {
    const matchCat = catalogCat === 'all' || p.categoryId === catalogCat;
    const query = catalogSearch.trim().toLowerCase();
    const matchSearch = !query || p.name.toLowerCase().includes(query) || (p.localName || '').toLowerCase().includes(query)
      || (p.searchAliases ?? []).some(alias => alias.toLowerCase().includes(query));
    return matchCat && matchSearch;
  }), [catalogItems, catalogCat, catalogSearch]);

  const pickFromCatalog = (item: CatalogItem) => {
    setForm(f => ({ ...f, name: item.name, localName: item.localName || '' }));
    setShowCatalogBrowser(false);
  };

  const handleBulkAddFromCatalog = async () => {
    if (catalogSelected.size === 0) return;
    setBulkAdding(true);
    try {
      const res = await catalogApi.bulkAddToStore([...catalogSelected], storeId);
      const payload = res.data?.data as { added?: number; conflicts?: Array<{ productId: string; storeId: string; storeName: string }> } | undefined;
      if (payload?.conflicts?.length) {
        setCatalogConflicts(payload.conflicts);
        return;
      }
      setShowCatalogBrowser(false);
      showToast(`${catalogSelected.size} product(s) added — set price & availability to make them live`);
      await load();
    } catch (e: any) {
      const payload = e?.response?.data?.data as { conflicts?: Array<{ productId: string; storeId: string; storeName: string }> } | undefined;
      if (e?.response?.status === 409 && payload?.conflicts?.length) {
        setCatalogConflicts(payload.conflicts);
        return;
      }
      alert(e?.response?.data?.error || 'Failed to add products');
    } finally { setBulkAdding(false); }
  };

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
    const [p, c, s] = await Promise.all([
      productsApi.getAll(storeId, { fresh }),
      categoriesApi.getAll({ fresh }),
      inventoryApi.getSettings(storeId),
    ]);
    setProducts([...(p.data.data || [])]);
    setCategories([...(c.data.data || [])]);
    setInventoryEnabled(Boolean(s.data.data?.inventoryTracking));
    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedStoreId]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedStoreId]);

  const handleStoreChange = (id: string) => {
    if (id === selectedStoreId) return;
    setShowModal(false);
    setShowComboModal(false);
    setReorderMode(false);
    setEditing(null);
    setSearchQuery('');
    setLoading(true);
    setSelectedStoreId(id);
  };

  // ── Filtered + sorted product list ───────────────────────────────────────
  const displayProducts = useMemo(() => {
    let list = [...products];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.localName || '').toLowerCase().includes(q)
        || (p.searchAliases ?? []).some(alias => alias.toLowerCase().includes(q)));
    }

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
  }, [products, searchQuery, filterStatus, filterCategory, sortMode]);

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
      await Promise.all(reorderList.map((p, i) => productsApi.update(p.id, { sortOrder: i, storeId })));
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
  useEffect(() => {
    clearHeaderAction();
    return () => clearHeaderAction();
  }, []);

  const openEdit = (p: Product) => {
    if (p.isBundle) {
      void openComboEdit(p);
      return;
    }
    setEditing(p);
    const dp = p.discountPercent || 0;
    const fp = dp > 0 ? Math.round(p.price * (1 - dp / 100)) : p.price;
    setForm({
      name: p.name, localName: p.localName || '', searchAliases: p.searchAliases.join(', '), categoryId: p.categoryId || '', price: String(p.price),
      unit: p.unit, approxWeight: p.approxWeight || '',
      discountPercent: String(p.discountPercent),
      finalPrice: String(fp),
      description: p.description || '',
      availabilityStatus: p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock'),
    });
    setLastRestock(null);
    setInlineStockQty(''); setInlineStockNote('');
    if (inventoryEnabled) {
      inventoryApi.getHistory(p.id, storeId).then(res => {
        const logs: LogEntry[] = res.data.data || [];
        setLastRestock(logs.find(l => l.reason === 'restock') || null);
      }).catch(() => {});
    }
    setShowModal(true);
  };

  const handleComboPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Use a JPEG, PNG, or WebP image for the combo photo.');
      event.target.value = '';
      return;
    }
    setComboPhotoFile(file);
    setComboPhotoPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        price: parseFloat(form.price),
        unit: form.unit,
        approxWeight: form.approxWeight || null,
        discountPercent: parseFloat(form.discountPercent),
        availabilityStatus: form.availabilityStatus,
        isAvailable: form.availabilityStatus === 'available',
      };
      if (editing) await productsApi.update(editing.id, { ...data, storeId });
      setShowModal(false); await load();
    } catch (err: any) {
      alert(`Failed to save: ${err?.response?.data?.error || err?.message}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await productsApi.delete(id, storeId);
    setConfirmDeleteId(null);
    setConfirmDeleteProduct(null);
    setShowModal(false);
    showToast('Product removed from this store');
    await load();
  };

  const comboCandidates = products.filter(product =>
    product.isCatalog && !product.isBundle && product.availabilityStatus === 'available'
  );
  const openCombo = () => {
    setEditingCombo(null);
    setComboName('');
    setComboLocalName('');
    setComboSearchAliases('');
    setComboCategoryId(categories[0]?.id || '');
    setComboPrice('');
    setComboUnit('1 combo');
    setComboPhotoFile(null);
    setComboPhotoPreview(null);
    setComboComponents([]);
    setShowComboModal(true);
  };
  const openComboEdit = async (combo: Product) => {
    try {
      const response = await productsApi.getBundleComponents(combo.id, storeId);
      const components = response.data.data || [];
      setEditingCombo(combo);
      setComboName(combo.name);
      setComboLocalName(combo.localName || '');
      setComboSearchAliases((combo.searchAliases || []).join(', '));
      setComboCategoryId(combo.categoryId || '');
      setComboPrice(String(combo.price));
      setComboUnit(combo.unit);
      setComboPhotoFile(null);
      setComboPhotoPreview(combo.photoUrl);
      setComboComponents(components.map((component: { productId: string; quantity: number; unit: string }) => ({
        productId: component.productId,
        quantity: String(component.quantity),
        unit: component.unit,
      })));
      setShowComboModal(true);
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Could not load this combo');
    }
  };
  const saveCombo = async () => {
    if (!comboName.trim() || !comboCategoryId || !(parseFloat(comboPrice) >= 0) || !comboUnit.trim() || comboComponents.length < 2 || comboComponents.some(component => !component.productId || !(parseFloat(component.quantity) > 0) || !component.unit)) return;
    setComboSaving(true);
    try {
      let photoUrl: string | null = editingCombo?.photoUrl || null;
      if (comboPhotoFile) {
        const upload = await productsApi.uploadPhoto(comboPhotoFile);
        photoUrl = upload.data.data.url;
      }
      const data = {
        storeId, name: comboName.trim(), localName: comboLocalName.trim() || null, searchAliases: parseSearchAliases(comboSearchAliases), categoryId: comboCategoryId, price: parseFloat(comboPrice), unit: comboUnit.trim(), photoUrl, availabilityStatus: 'available',
        bundleComponents: comboComponents.map(component => ({ productId: component.productId, quantity: parseFloat(component.quantity), unit: component.unit })),
      };
      if (editingCombo) await productsApi.update(editingCombo.id, data);
      else await productsApi.create(data);
      setShowComboModal(false);
      setEditingCombo(null);
      showToast(editingCombo ? 'Combo updated' : 'Combo created');
      await load();
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Could not save this combo');
    } finally { setComboSaving(false); }
  };

  const setAvailability = async (p: Product, status: 'available' | 'out_of_stock' | 'hidden') => {
    await productsApi.update(p.id, { availabilityStatus: status, storeId } as any); await load();
  };

  // ── Restock (standalone sheet — kept for bulk restock from inventory page) ──
  const handleRestock = async () => {
    if (!restocking || !restockQty) return;
    setRestockSaving(true);
    try {
      await inventoryApi.restock(restocking.id, parseFloat(restockQty), restockNote, storeId, restockUnit, crypto.randomUUID());
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

  if (loading) return <PageSkeleton />;

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
        onClick={() => { if (!reorderMode) openEdit(p); }}
        className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-colors ${reorderMode ? 'cursor-grab active:cursor-grabbing' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer'}`}
        draggable={reorderMode}
        onDragStart={() => handleDragStart(index)}
        onDragEnter={() => handleDragEnter(index)}
        onDragEnd={handleDragEnd}
        onDragOver={e => e.preventDefault()}
      >
        {reorderMode && <GripVertical className="w-5 h-5 text-gray-300 flex-shrink-0" />}

        <SmartImage
          src={p.photoUrl}
          alt={p.name}
          className="w-10 h-10 rounded-xl flex-shrink-0 border-2 border-emerald-200 bg-gray-100 dark:bg-slate-700"
          imgClassName="object-cover"
          fallback={
            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-gray-300" />
            </div>
          }
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">{p.name}</p>
          {p.localName && <p className="text-xs text-gray-500 dark:text-slate-400 break-words">{p.localName}</p>}
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-xs text-gray-500 dark:text-slate-400">{p.unit} · ₹{p.price}</span>
            {p.discountPercent > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                <Percent className="w-2.5 h-2.5" />{p.discountPercent}% off
              </span>
            )}
            {p.categoryName && (
              <span className="text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{p.categoryName}</span>
            )}
            {p.isBundle && (
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full">Combo</span>
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
              <p className="text-sm text-gray-500 dark:text-slate-400">—</p>
            )}
          </div>
        )}

        {!reorderMode && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select value={cur} onChange={e => { e.stopPropagation(); setAvailability(p, e.target.value as any); }} onClick={e => e.stopPropagation()}
              className={`text-[11px] sm:text-xs border rounded-lg px-1 sm:px-1.5 py-1 focus:outline-none cursor-pointer font-semibold ${availColor}`}>
              <option value="available">✅ On</option>
              <option value="out_of_stock">⚠️ Out</option>
              <option value="hidden">👁 Hide</option>
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" onClick={() => { setShowFilterMenu(false); setShowSortMenu(false); }}>

      {/* Zone-head store picker — a head store manages the listings and
          prices of every store tagged into its active zone. */}
      {canSwitchStores && (
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 flex-shrink-0">Zone store</span>
          <select
            value={selectedStoreId}
            onChange={e => handleStoreChange(e.target.value)}
            aria-label="Select store to manage products for"
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-gray-900 dark:text-white focus:outline-none cursor-pointer"
          >
            {manageableStores.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.isOwn ? ' — Head store' : ''}</option>
            ))}
          </select>
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-gray-500 hover:text-gray-700" />
          </button>
        )}
      </div>

      {/* Header: Filter | Sort | Reorder | + Product (desktop) */}
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
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Status</p>
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
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Category</p>
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
                <button key={m} onClick={() => { setSortMode(m); localStorage.setItem('hub_products_sort', m); setShowSortMenu(false); }}
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
          /* Desktop reorder buttons — hidden on mobile, shown via sticky bar below */
          <div className="hidden sm:flex items-center gap-2">
            <button onClick={cancelReorder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-gray-50 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={saveReorder} disabled={savingOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-all">
              {savingOrder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save Order
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Bulk Add from Catalog — desktop only */}
        <button onClick={() => openCatalogBrowser('bulk')}
          className="hidden lg:flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 text-xs font-semibold rounded-xl transition-colors">
          <BookOpen className="w-3.5 h-3.5" /> Bulk from Catalog
        </button>

        <button onClick={openCombo}
          className="hidden lg:flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 text-xs font-semibold rounded-xl transition-colors">
          <Plus className="w-3.5 h-3.5" /> Combo
        </button>


      </div>

      <div className="lg:hidden grid grid-cols-3 gap-2">
        <button onClick={() => openCatalogBrowser('bulk')}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 shadow-sm">
          <BookOpen className="w-4 h-4" /> Bulk Upload
        </button>
        <button onClick={openCombo}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-sm font-bold text-emerald-700 dark:text-emerald-400 shadow-sm">
          <Plus className="w-4 h-4" /> Combo
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
      <div className={`page-card ${reorderMode ? 'pb-24 sm:pb-0' : ''}`}>
        {products.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No products yet. Add your first product.</p>
          </div>
        ) : reorderMode ? (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {reorderList.map((p, i) => <ProductRow key={p.id} p={p} index={i} />)}
          </div>
        ) : displayProducts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No products match this filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {displayProducts.map((p, i) => <ProductRow key={p.id} p={p} index={i} />)}
          </div>
        )}
      </div>

      {/* Confirm delete (row) */}
      {confirmDeleteId && (
        <ConfirmDialog title="Remove from Store" message="Remove this product from this store only? The master catalog product remains unchanged." confirmLabel="Remove"
          onConfirm={async () => { await handleDelete(confirmDeleteId); }} onCancel={() => setConfirmDeleteId(null)} />
      )}

      <ToastContainer toasts={toasts} />

      {/* Mobile sticky reorder bar */}
      {reorderMode && (
        <div className="sm:hidden fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="flex gap-2 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700 p-2">
            <button onClick={cancelReorder}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 transition-all">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={saveReorder} disabled={savingOrder}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-all">
              {savingOrder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {savingOrder ? 'Saving...' : 'Save Order'}
            </button>
          </div>
        </div>
      )}

      {/* Double-confirm delete (modal) */}
      {confirmDeleteProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Remove from Store?</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{confirmDeleteProduct.name}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
              This removes the product only from this store&apos;s list. It does not delete the master catalog product.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteProduct(null)}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              <button onClick={async () => { await handleDelete(confirmDeleteProduct.id); setConfirmDeleteProduct(null); }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors">
                Remove
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
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Edit Product</h2>
                {editing && (
                  <button onClick={() => setConfirmDeleteProduct(editing)}
                    className="ml-6 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors">
                    <X className="w-3 h-3" /> Remove from Store
                  </button>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-300">
                Catalog details are view-only here. Ask a super admin to change them in Catalog.
              </div>

              {/* Catalog image + inventory actions */}
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  {editing?.photoUrl ? (
                    <img src={editing.photoUrl} alt={editing.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-indigo-200 dark:border-indigo-800 shadow-sm" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-slate-700 border-2 border-dashed border-gray-300 dark:border-slate-500 flex flex-col items-center justify-center gap-1">
                      <Camera className="w-6 h-6 text-gray-500" />
                      <span className="text-[10px] text-gray-500">No image</span>
                    </div>
                  )}
                </div>
                {editing && inventoryEnabled && (
                  <div className="flex flex-col gap-2 flex-1">
                    {/* Current stock display */}
                    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500 dark:text-slate-400">Current Stock</span>
                        <span className={`text-[11px] font-bold ${
                          editing.stockQuantity === null ? 'text-gray-400'
                          : editing.stockQuantity <= 0 ? 'text-red-600 dark:text-red-400'
                          : editing.stockQuantity <= (editing.lowStockThreshold ?? 5) ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {editing.stockQuantity !== null && editing.stockUnit ? formatStock(editing.stockQuantity, editing.stockUnit) : 'Not tracked'}
                        </span>
                      </div>
                      {lastRestock && (
                        <div className="flex items-center justify-between pt-0.5 border-t border-gray-200 dark:border-slate-600">
                          <span className="text-[11px] text-gray-500 dark:text-slate-400">Last update</span>
                          <span className="text-[11px] text-gray-600 dark:text-slate-300">
                            {lastRestock.changeQty > 0 ? '+' : ''}{lastRestock.changeQty} · {new Date(lastRestock.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Inline stock update — +qty to add, -qty to reduce */}
                    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl p-2.5 space-y-2">
                      <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Update Stock</p>
                      <div className="flex gap-1.5">
                        <input
                          type="text" inputMode="decimal"
                          value={inlineStockQty}
                          onChange={e => setInlineStockQty(e.target.value.replace(/[^0-9.\-]/g, '').replace(/(?!^)-/g, ''))}
                          placeholder="+5 or -2"
                          className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          onClick={async () => {
                            if (!inlineStockQty || isNaN(parseFloat(inlineStockQty)) || parseFloat(inlineStockQty) === 0) return;
                            setInlineStockSaving(true);
                            try {
                              await inventoryApi.restock(editing.id, parseFloat(inlineStockQty), inlineStockNote, storeId, editing.stockUnit || 'kg', crypto.randomUUID());
                              setInlineStockQty(''); setInlineStockNote('');
                              // Refresh last restock without closing modal
                              const logs = await inventoryApi.getHistory(editing.id, storeId);
                              const logData: LogEntry[] = logs.data.data || [];
                              setLastRestock(logData[0] || null);
                              await load();
                            } catch (e: any) { alert(e?.response?.data?.error || 'Failed'); }
                            finally { setInlineStockSaving(false); }
                          }}
                          disabled={inlineStockSaving || !inlineStockQty || isNaN(parseFloat(inlineStockQty)) || parseFloat(inlineStockQty) === 0}
                          className="px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50 flex items-center gap-1 transition-colors">
                          {inlineStockSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                      <input
                        type="text" value={inlineStockNote}
                        onChange={e => setInlineStockNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      {inlineStockQty && !isNaN(parseFloat(inlineStockQty)) && parseFloat(inlineStockQty) !== 0 && editing.stockQuantity !== null && (
                        <p className={`text-[10px] font-semibold ${parseFloat(inlineStockQty) < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          → New total: {formatStock(Math.max(0, editing.stockQuantity + parseFloat(inlineStockQty)), editing.stockUnit || 'kg')}
                        </p>
                      )}
                    </div>
                    {/* Stock log link */}
                    <button onClick={() => { setShowModal(false); openHistory(editing); }}
                      className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors">
                      <History className="w-3.5 h-3.5" /> View Stock Log
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700 dark:text-slate-300">Name *</label>
                  <span className={`text-[10px] font-semibold ${form.name.length >= 26 ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>{form.name.length}/26</span>
                  {!editing && (
                    <button type="button" onClick={() => openCatalogBrowser('single')}
                      className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                      <BookOpen className="w-3 h-3" /> Browse Catalog
                    </button>
                  )}
                </div>
                <input type="text" value={form.name} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">Managed in Catalog.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
                    Hindi Name <span className="text-gray-500 font-normal">(in English)</span>
                  </label>
                  <span className={`text-[10px] font-semibold ${form.localName.length >= 30 ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>{form.localName.length}/30</span>
                </div>
                <input type="text" value={form.localName} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Search aliases <span className="text-gray-500 font-normal">(hidden from customers)</span></label>
                <input type="text" value={form.searchAliases} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Category</label>
                <select value={form.categoryId} disabled className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`}>
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
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Approx. weight (per unit) <span className="text-gray-400 dark:text-slate-500">— optional, shown to customers</span></label>
                <div className="flex gap-1.5">
                  <input
                    value={form.approxWeight}
                    onChange={e => setForm(f => ({ ...f, approxWeight: e.target.value }))}
                    className={inp} placeholder="e.g. 200-300 g" />
                  {form.approxWeight && (
                    <span className="flex items-center px-2 text-[10px] text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      shown as "{form.unit.replace(/^\d*\.?\d*\s*/, '') === 'pcs' ? '1 pc' : form.unit}{form.approxWeight ? ` · ${form.approxWeight}` : ''}"
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Discount %</label>
                  <input type="number" value={form.discountPercent} onChange={e => {
                    const pct = e.target.value;
                    setForm(f => {
                      const price = parseFloat(f.price);
                      if (price > 0 && pct !== '') {
                        const disc = Math.min(100, Math.max(0, parseFloat(pct)));
                        const final = Math.round(price * (1 - disc / 100));
                        return { ...f, discountPercent: pct, finalPrice: String(final) };
                      }
                      return { ...f, discountPercent: pct };
                    });
                  }} className={inp} placeholder="0" min="0" max="100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Price after % (₹)</label>
                  <input type="number" value={(form as any).finalPrice || ''} onChange={e => {
                    const final = e.target.value;
                    setForm(f => {
                      const price = parseFloat(f.price);
                      if (price > 0 && final !== '') {
                        const fp = Math.max(0, parseFloat(final));
                        const pct = Math.round(((price - fp) / price) * 100);
                        return { ...f, finalPrice: final, discountPercent: String(Math.max(0, Math.min(100, pct))) };
                      }
                      return { ...f, finalPrice: final };
                    });
                  }} className={inp} placeholder="0" min="0" step="0.5" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Selling preview</label>
                  <div className="h-[34px] flex items-center px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    ₹{(() => {
                      const p = parseFloat(form.price);
                      const d = parseFloat(form.discountPercent || '0');
                      if (isNaN(p)) return 0;
                      return Math.round(p * (1 - (isNaN(d) ? 0 : d) / 100));
                    })()}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea value={form.description} readOnly className={`${inp} resize-none cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} rows={2} />
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
              <button onClick={handleSave} disabled={saving || !form.price}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showComboModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
              <div><h2 className="text-sm font-bold text-gray-900 dark:text-white">{editingCombo ? 'Edit Combo' : 'Create Combo'}</h2><p className="text-[11px] text-gray-500 mt-0.5">One customer product, with linked inventory deductions.</p></div>
              <button onClick={() => setShowComboModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <label className="w-12 h-12 shrink-0 rounded-lg overflow-hidden border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center cursor-pointer bg-gray-50 dark:bg-slate-700">
                  {comboPhotoPreview ? <img src={comboPhotoPreview} alt="" className="w-full h-full object-cover" /> : <Camera className="w-5 h-5 text-gray-400" />}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleComboPhoto} />
                </label>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">Add a separate combo image.</p>
              </div>
              <input value={comboName} onChange={event => setComboName(event.target.value)} className={inp} placeholder="Combo name" maxLength={40} />
              <input value={comboLocalName} onChange={event => setComboLocalName(event.target.value)} className={inp} placeholder="Hindi / local name (optional)" maxLength={30} />
              <input value={comboSearchAliases} onChange={event => setComboSearchAliases(event.target.value)} className={inp} placeholder="Search aliases, separated by commas (optional)" />
              <select value={comboCategoryId} onChange={event => setComboCategoryId(event.target.value)} className={inp}><option value="">Choose a category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.5" value={comboPrice} onChange={event => setComboPrice(event.target.value)} className={inp} placeholder="Selling price (₹)" /><input value={comboUnit} onChange={event => setComboUnit(event.target.value)} className={inp} placeholder="Quantity, e.g. 1 combo" /></div>
              <div className="space-y-2.5 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-xs font-bold text-gray-800 dark:text-slate-200">Combo items</p><p className="text-[10px] text-gray-500 dark:text-slate-400">Choose at least two available products. The quantity is deducted for every combo delivered.</p></div>
                  <button onClick={() => setComboComponents(items => [...items, { productId: '', quantity: '1', unit: '' }])} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"><Plus className="h-3.5 w-3.5" /> Add item</button>
                </div>
                <div className="flex items-center justify-between border-t border-emerald-100 pt-2 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900/50 dark:text-emerald-300">
                  <span>{comboComponents.length} item{comboComponents.length === 1 ? '' : 's'} added</span>
                  <span>{comboComponents.filter(component => component.productId).length} selected</span>
                </div>
                {comboComponents.length === 0 && (
                  <button onClick={() => setComboComponents([{ productId: '', quantity: '1', unit: '' }])} className="w-full rounded-lg border border-dashed border-emerald-300 bg-white px-3 py-4 text-left text-xs text-emerald-800 hover:border-emerald-500 dark:border-emerald-800 dark:bg-slate-800 dark:text-emerald-300">
                    <span className="block font-bold">Add the first combo item</span>
                    <span className="mt-0.5 block text-[10px] font-medium text-gray-500 dark:text-slate-400">Select a product, then set the quantity and deduction measure.</span>
                  </button>
                )}
                {comboComponents.map((component, index) => { const selected = products.find(product => product.id === component.productId); return <div key={index} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 p-2 space-y-1.5"><select value={component.productId} onChange={event => { const product = products.find(candidate => candidate.id === event.target.value); setComboComponents(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value, unit: product?.stockUnit || item.unit || 'pcs' } : item)); }} className={`${inp} py-2.5 font-medium`}><option value="">Select inventory product</option>{comboCandidates.filter(product => !comboComponents.some((item, itemIndex) => itemIndex !== index && item.productId === product.id)).map(product => <option key={product.id} value={product.id}>{product.name}{product.localName ? ` (${product.localName})` : ''}</option>)}</select>{selected && <div className="rounded-md bg-white dark:bg-slate-800 px-2.5 py-1.5"><p className="text-xs font-semibold text-gray-800 dark:text-slate-100">Selected: {selected.name}{selected.localName ? ` · ${selected.localName}` : ''}</p><p className="text-[10px] text-gray-500">Stock: {selected.stockQuantity === null || !selected.stockUnit ? 'Not tracked' : formatStock(selected.stockQuantity, selected.stockUnit)} · Unit: {selected.unit}</p></div>}<div className="flex items-center gap-2"><input value={component.quantity} onChange={event => setComboComponents(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} className={`${inp} flex-1 py-2`} inputMode="decimal" placeholder="Amount" /><select value={component.unit} onChange={event => setComboComponents(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value } : item))} className={`${inp} w-24 py-2`} aria-label="Deduction measure"><option value="">Unit</option>{UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select><button onClick={() => setComboComponents(items => items.filter((_, itemIndex) => itemIndex !== index))} className="p-2 text-gray-400 hover:text-red-500" aria-label="Remove inventory product"><X className="w-4 h-4" /></button></div>{selected && <p className="text-[10px] text-gray-500 px-1">Deduct {component.quantity || '0'} {component.unit || 'units'} on delivery.</p>}</div>})}
              </div>
            </div>
            <div className="shrink-0 px-4 py-3 border-t border-gray-100 dark:border-slate-700 flex gap-3"><button onClick={() => setShowComboModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button><button onClick={saveCombo} disabled={comboSaving || !comboName.trim() || !comboCategoryId || !(parseFloat(comboPrice) >= 0) || !comboUnit.trim() || comboComponents.length < 2 || comboComponents.some(component => !component.productId || !(parseFloat(component.quantity) > 0) || !component.unit)} className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl disabled:opacity-50">{comboSaving ? 'Saving...' : editingCombo ? 'Save Combo' : 'Create Combo'}</button></div>
          </div>
        </div>
      )}

      {/* ── Catalog Browser Modal ── */}
      {showCatalogBrowser && (
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !bulkAdding && setShowCatalogBrowser(false)} />
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  {catalogBrowserMode === 'bulk' ? 'Bulk Add from Catalog' : 'Browse Catalog'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {catalogBrowserMode === 'bulk' ? 'Select products to add — set price & availability later' : 'Pick a product to auto-fill name & photo'}
                </p>
              </div>
              <button onClick={() => setShowCatalogBrowser(false)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Search + category filter */}
            <div className="px-4 pt-3 pb-2 space-y-2 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="text" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="Search..." autoFocus
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                <button onClick={() => setCatalogCat('all')}
                  className={`flex-shrink-0 px-3 py-1 rounded-xl text-xs font-semibold transition-all ${catalogCat === 'all' ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'}`}>
                  All
                </button>
                {categories.map(cat => (
                  <button key={cat.id} onClick={() => setCatalogCat(cat.id)}
                    className={`flex-shrink-0 px-3 py-1 rounded-xl text-xs font-semibold transition-all ${catalogCat === cat.id ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'}`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Product list */}
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {catalogLoading ? (
                <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : catalogFiltered.length === 0 ? (
                <div className="text-center py-12 text-gray-500"><Package className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No products found.</p></div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {catalogFiltered.map(item => {
                    const isSelected = catalogSelected.has(item.id);
                    return (
                      <div key={item.id}
                        onClick={() => {
                          if (catalogBrowserMode === 'single') { pickFromCatalog(item); return; }
                          setCatalogSelected(s => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
                        }}
                        className={`relative rounded-xl border overflow-hidden cursor-pointer transition-all ${
                          isSelected ? 'border-indigo-400 ring-2 ring-indigo-300 dark:ring-indigo-700' : 'border-gray-100 dark:border-slate-700 hover:border-emerald-300'
                        } bg-white dark:bg-slate-700`}>
                        <div className="aspect-square bg-gray-50 dark:bg-slate-600">
                          <SmartImage
                            src={item.photoUrl}
                            alt={item.name}
                            className="h-full w-full"
                            imgClassName="object-cover"
                            fallback={<div className="w-full h-full flex items-center justify-center text-2xl">🥦</div>}
                          />
                          {catalogBrowserMode === 'bulk' && (
                            <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                              isSelected ? 'bg-indigo-500 border-indigo-500' : 'bg-white/80 border-gray-300'
                            }`}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          )}
                        </div>
                        <div className="p-1.5">
                          <p className="text-[11px] font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{item.name}</p>
                          {item.localName && <p className="text-[10px] text-gray-500 truncate">{item.localName}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bulk mode footer */}
            {catalogBrowserMode === 'bulk' && (
              <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0 flex gap-3">
                <button onClick={() => setShowCatalogBrowser(false)} disabled={bulkAdding}
                  className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleBulkAddFromCatalog} disabled={bulkAdding || catalogSelected.size === 0}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {bulkAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {bulkAdding ? 'Adding...' : `Add ${catalogSelected.size || ''} product${catalogSelected.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}
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
                <X className="w-4 h-4 text-gray-500" />
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
                              {isPos ? '+' : ''}{entry.changeQty}
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

      {/* Zone duplicate add popup */}
      {catalogConflicts.length > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-5">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Already selling in this zone</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">
              One or more products are already mapped to another store in the same zone, so they cannot be added again.
            </p>
            <div className="mt-3 max-h-40 overflow-y-auto space-y-1.5">
              {catalogConflicts.map(conflict => (
                <div key={conflict.productId} className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{conflict.storeName}</p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">Product already selling in this zone.</p>
                </div>
              ))}
            </div>
            <button onClick={() => setCatalogConflicts([])} className="mt-4 w-full py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
