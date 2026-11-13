import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Loader2, X, Package,
  Percent, GripVertical, Check,
  Camera, ChevronDown, SlidersHorizontal, ArrowUpDown, BookOpen, Search,
} from 'lucide-react';
import { productsApi, categoriesApi, inventoryApi, catalogApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import { useZoneSelectionStore } from '../store/zoneSelectionStore';
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
  id: string; productCode: string; name: string; categoryId: string | null; categoryName: string;
  localName: string | null;
  searchAliases: string[];
  price: number; unit: string; discountPercent: number;
  approxWeight: string | null;
  weightOptions?: Array<{ label: string; price: number; discountPercent?: number; approxWeight?: string | null }> | null;
  isAvailable: boolean;
  isBundle: boolean;
  isCatalog: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  photoUrl: string | null; description: string | null;
  photoVariants?: Array<{ assetId?: string; thumbnailUrl: string; largeUrl: string }>;
  sortOrder: number;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  stockUnit: string | null;
}

interface Category {
  id: string; name: string; icon: string; sortOrder: number; productCount: number;
}

type SortMode = 'manual' | 'discount' | 'stock' | 'az';
type FilterStatus = 'all' | 'available' | 'out_of_stock' | 'low_stock' | 'hidden';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';
const UNITS = ['kg', 'g', 'pcs', 'dozen', 'litre', 'ml', 'bunch', 'packet'];
const STOCK_UNITS = ['kg', 'litre', 'pcs', 'bunch', 'packet'];
const parseSearchAliases = (value: string) => value.split(',').map(alias => alias.trim()).filter(Boolean);

interface OptionRow {
  qty: string;
  unit: string;
  price: string;
  discountPercent: string;
  approxWeight: string;
  isDefault: boolean;
}

const splitUnitLabel = (label: string): { qty: string; unit: string } => {
  const match = (label || '').trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(.*)$/);
  const qty = match?.[1]?.trim() || '1';
  const unit = match?.[2]?.trim() || 'kg';
  return { qty, unit };
};

const optionLabel = (option: OptionRow) => {
  const qty = option.qty.trim();
  const numericQty = Number(qty);
  const normalizedQty = qty === '' ? '1' : Number.isFinite(numericQty) ? String(numericQty) : qty;
  return `${normalizedQty} ${option.unit.trim() || 'kg'}`.trim();
};

const optionDiscount = (option: OptionRow) => {
  const discount = parseFloat(option.discountPercent || '0');
  return Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0;
};

const optionSellingPrice = (option: OptionRow) => {
  const price = parseFloat(option.price);
  if (!Number.isFinite(price)) return 0;
  const discount = optionDiscount(option);
  return discount > 0 ? Math.round(price * (1 - discount / 100)) : price;
};

const unitFamily = (unit: string) => {
  const u = unit.trim().toLowerCase();
  if (u.includes('kg') || u.includes('g')) return 'weight';
  if (u.includes('litre') || u.includes('liter') || u.includes('ltr') || u.includes('ml')) return 'volume';
  if (u.includes('dozen') || u.includes('pcs') || u.includes('pc')) return 'count';
  if (u.includes('bunch')) return 'bunch';
  if (u.includes('packet')) return 'packet';
  return 'count';
};

const isOptionPriceValid = (option: OptionRow) => {
  const price = parseFloat(option.price);
  return option.price.trim() !== '' && Number.isFinite(price) && price >= 0;
};

const isOptionQtyValid = (option: OptionRow) => {
  const qty = option.qty.trim();
  const parsed = parseFloat(qty);
  return qty === '' || (Number.isFinite(parsed) && parsed > 0);
};

const productOptionRows = (product: Product): OptionRow[] => {
  const options = product.weightOptions?.length
    ? product.weightOptions
    : [{
        label: product.unit,
        price: product.price,
        discountPercent: product.discountPercent,
        approxWeight: product.approxWeight,
      }];
  const defaultIndex = options.findIndex(option => option.label === product.unit);
  return options.map((option, index) => {
    const { qty, unit } = splitUnitLabel(option.label || product.unit);
    return {
      qty,
      unit,
      price: String(option.price ?? ''),
      discountPercent: String(option.discountPercent ?? 0),
      approxWeight: option.approxWeight || '',
      isDefault: index === (defaultIndex >= 0 ? defaultIndex : 0),
    };
  });
};

function stockStatus(p: Product): 'untracked' | 'out' | 'low' | 'ok' {
  if (p.stockQuantity === null) return 'untracked';
  if (p.stockQuantity <= 0) return 'out';
  if (p.lowStockThreshold !== null && p.stockQuantity <= p.lowStockThreshold) return 'low';
  return 'ok';
}

export default function ProductsPage() {
  const { role } = useAuthStore();
  // Zone selection is shared with the header dropdown (Layout) through
  // zoneSelectionStore — it is deliberately not kept in the URL, so raw store
  // ids stay out of the address bar. Falls back to the active store until the
  // manageable-store list resolves the default (head store first).
  const zoneProductsStore = useZoneSelectionStore(s => s.productsStore);
  const setZoneProductsStore = useZoneSelectionStore(s => s.setProductsStore);
  const selectedStoreId = zoneProductsStore || getActiveStoreId();
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
    name: '', localName: '', searchAliases: '', categoryId: '',
    weightOptions: [] as OptionRow[],
    description: '',
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

  // History

  // Last restock for edit modal

  const storeId = selectedStoreId;
  const { clearHeaderAction } = useHeaderAction();
  const { toasts, show: showToast } = useToast();

  // Catalog browser state
  interface CatalogItem { id: string; productCode: string; name: string; localName: string | null; searchAliases: string[]; description: string | null; photoUrl: string | null; categoryId: string | null; categoryName: string | null; categoryIcon: string | null; }
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
    const matchSearch = !query || p.productCode.toLowerCase().includes(query) || p.name.toLowerCase().includes(query) || (p.localName || '').toLowerCase().includes(query)
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
      // Keep the persisted pick (or the active store) when the user can still
      // manage it; only fall back to the head/first store when it is gone.
      const stored = useZoneSelectionStore.getState().productsStore;
      const current = stored || getActiveStoreId();
      if (list.some((s: any) => s.id === current)) {
        if (!stored) setZoneProductsStore(current);
        return;
      }
      const own = list.find((s: any) => s.isOwn)?.id || list[0]?.id;
      if (own) setZoneProductsStore(own);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The store can now be switched from the header zone dropdown, so keep the
  // page in a clean state whenever the selection changes.
  useEffect(() => {
    setShowModal(false);
    setShowComboModal(false);
    setReorderMode(false);
    setEditing(null);
    setSearchQuery('');
    setLoading(true);
  }, [selectedStoreId]);

  // ── Filtered + sorted product list ───────────────────────────────────────
  const displayProducts = useMemo(() => {
    let list = [...products];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(p => p.productCode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || (p.localName || '').toLowerCase().includes(q)
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
    setForm({
      name: p.name, localName: p.localName || '', searchAliases: p.searchAliases.join(', '), categoryId: p.categoryId || '',
      weightOptions: productOptionRows(p),
      description: p.description || '',
      availabilityStatus: p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock'),
    });
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
    const validOptions = form.weightOptions.filter(option =>
      isOptionPriceValid(option) && isOptionQtyValid(option) && option.unit.trim()
    );
    if (validOptions.length === 0) {
      alert('Add at least one option with a valid price.');
      return;
    }
    const labels = validOptions.map(optionLabel);
    const duplicateLabel = labels.find((label, index) => labels.indexOf(label) !== index);
    if (duplicateLabel) {
      alert(`“${duplicateLabel}” is added more than once. Give each option a different quantity or unit.`);
      return;
    }
    if (new Set(validOptions.map(option => unitFamily(option.unit))).size > 1) {
      alert('All options must use the same type of unit, for example only weight (g/kg) or only pieces.');
      return;
    }
    setSaving(true);
    try {
      const defaultOption = validOptions.find(option => option.isDefault) || validOptions[0];
      const orderedOptions = [defaultOption, ...validOptions.filter(option => option !== defaultOption)];
      const allOptions = orderedOptions.map(option => ({
        label: optionLabel(option),
        price: parseFloat(option.price),
        discountPercent: optionDiscount(option),
        approxWeight: option.approxWeight.trim() || null,
      }));
      // The default option becomes the store listing's primary price/unit so
      // product cards and normal ordering keep working without the options list.
      const primary = allOptions[0];
      const data = {
        price: primary.price,
        unit: primary.label,
        approxWeight: primary.approxWeight,
        discountPercent: primary.discountPercent,
        weightOptions: allOptions.length > 1 ? allOptions : null,
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
    try {
      await productsApi.delete(id, storeId);
      setConfirmDeleteId(null);
      setConfirmDeleteProduct(null);
      setShowModal(false);
      setShowComboModal(false);
      setEditingCombo(null);
      showToast('Product removed from this store');
      await load();
    } catch (err: any) {
      alert(`Failed to remove: ${err?.response?.data?.error || err?.message || 'Unknown error'}`);
    }
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
      let photoVariants = editingCombo?.photoVariants;
      let imageAssetIds: string[] | undefined;
      if (comboPhotoFile) {
        const upload = await productsApi.uploadPhoto(comboPhotoFile, undefined, 'product');
        photoUrl = upload.data.data.url;
        photoVariants = [upload.data.data.photoVariants];
        imageAssetIds = [upload.data.data.photoVariants.assetId];
      }
      const data = {
        storeId, name: comboName.trim(), localName: comboLocalName.trim() || null, searchAliases: parseSearchAliases(comboSearchAliases), categoryId: comboCategoryId, price: parseFloat(comboPrice), unit: comboUnit.trim(), photoUrl, photoVariants, imageAssetIds, availabilityStatus: 'available',
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
          <p className="text-[10px] font-medium tabular-nums text-indigo-600 dark:text-indigo-300">{p.productCode}</p>
          {p.localName && <p className="text-xs text-gray-500 dark:text-slate-400 break-words">{p.localName}</p>}
          {p.description && <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-slate-400 line-clamp-1">{p.description}</p>}
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

      {/* The zone-head store picker lives in the app header now, next to the
           page title — same place as the Inventory picker. */}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search products or code..."
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
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Status</p>
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
                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Category</p>
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

      {/* Mobile sticky reorder bar — floats above the bottom nav (80px + the
          iPhone home-indicator safe area) instead of under it. */}
      {reorderMode && (
        <div className="sm:hidden fixed left-0 right-0 z-50 px-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px)+0.5rem)]">
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
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
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-300">
                Catalog details are view-only here. Ask a super admin to change them in Catalog.
              </div>

              {/* Catalog image + inventory actions */}
              <div className="flex items-center gap-3">
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{editing?.name || form.name || 'Product'}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500 dark:text-slate-400">{editing?.productCode || '—'}</p>
                  {editing && (
                    <a href="/inventory" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                      Manage stock in Inventory
                    </a>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <div className="mb-2">
                  <p className="text-xs font-bold text-gray-800 dark:text-slate-200">Pricing &amp; sizes</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-gray-500 dark:text-slate-400">
                    The default option is shown on product cards. Add more sizes to let customers choose.
                  </p>
                </div>
                <div className="space-y-2">
                  {form.weightOptions.map((option, index) => {
                    const price = parseFloat(option.price);
                    const discount = optionDiscount(option);
                    const after = optionSellingPrice(option);
                    const label = optionLabel(option);
                    const units = UNITS.includes(option.unit) ? UNITS : [option.unit, ...UNITS];
                    const update = (patch: Partial<OptionRow>) => setForm(f => ({
                      ...f,
                      weightOptions: f.weightOptions.map((row, i) => i === index ? { ...row, ...patch } : row),
                    }));
                    return (
                      <div
                        key={index}
                        className={`rounded-xl border p-3 transition-colors ${
                          option.isDefault
                            ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20'
                            : 'border-gray-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-700 dark:text-slate-200">Option {index + 1}</span>
                            {option.isDefault ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                <Check className="h-2.5 w-2.5" /> Default
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setForm(f => ({
                                  ...f,
                                  weightOptions: f.weightOptions.map((row, i) => ({ ...row, isDefault: i === index })),
                                }))}
                                className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                              >
                                Set as default
                              </button>
                            )}
                          </div>
                          {form.weightOptions.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove option ${index + 1}`}
                              onClick={() => setForm(f => {
                                const next = f.weightOptions.filter((_, i) => i !== index);
                                if (next.length && !next.some(row => row.isDefault)) next[0] = { ...next[0], isDefault: true };
                                return { ...f, weightOptions: next };
                              })}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500 dark:text-slate-400 mb-1">Quantity</label>
                            <input type="number" min="0" step="0.5" value={option.qty} onChange={e => update({ qty: e.target.value })} className={inp} placeholder="1" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500 dark:text-slate-400 mb-1">Unit</label>
                            <select value={option.unit} onChange={e => update({ unit: e.target.value })} className={inp}>
                              {units.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500 dark:text-slate-400 mb-1">Price (₹)</label>
                            <input type="number" min="0" step="0.5" value={option.price} onChange={e => update({ price: e.target.value })} className={inp} placeholder="0" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500 dark:text-slate-400 mb-1">Discount %</label>
                            <input type="number" min="0" max="100" step="1" value={option.discountPercent} onChange={e => update({ discountPercent: e.target.value })} className={inp} placeholder="0" />
                          </div>
                        </div>

                        <div className="mt-2">
                          <label className="block text-[10px] font-medium text-gray-500 dark:text-slate-400 mb-1">Approx. weight <span className="font-normal">(optional)</span></label>
                          <input value={option.approxWeight} onChange={e => update({ approxWeight: e.target.value })} className={inp} placeholder="e.g. 200-300 g" />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] dark:bg-slate-800/60">
                          <span className="truncate text-gray-500 dark:text-slate-400">
                            Shown as <span className="font-semibold text-gray-800 dark:text-slate-200">{label}</span>
                          </span>
                          <span className="flex shrink-0 items-baseline gap-1.5">
                            {discount > 0 && Number.isFinite(price) && (
                              <span className="text-gray-400 line-through dark:text-slate-500">₹{price}</span>
                            )}
                            <span className="font-bold text-gray-900 dark:text-white">₹{after}</span>
                            {discount > 0 && (
                              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{discount}% off</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      weightOptions: [...f.weightOptions, { qty: '1', unit: f.weightOptions[0]?.unit || 'kg', price: '', discountPercent: '0', approxWeight: '', isDefault: false }],
                    }))}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/20"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add another size / option
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Availability</label>
                <select value={form.availabilityStatus} onChange={e => setForm(f => ({ ...f, availabilityStatus: e.target.value as any }))} className={inp}>
                  <option value="available">✅ Available</option>
                  <option value="out_of_stock">⚠️ Out of Stock</option>
                  <option value="hidden">👁 Hide</option>
                </select>
              </div>

              <details className="group rounded-xl border border-gray-200 dark:border-slate-700">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">
                    Catalog details <span className="font-normal text-gray-400 dark:text-slate-500">(read-only)</span>
                  </span>
                  <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-2 border-t border-gray-100 px-3 py-3 dark:border-slate-700">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Product Code</label>
                    <input type="text" value={editing?.productCode || ''} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60 font-mono`} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-700 dark:text-slate-300">Name *</label>
                      <span className={`text-[10px] font-semibold ${form.name.length >= 26 ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>{form.name.length}/26</span>
                    </div>
                    <input type="text" value={form.name} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-700 dark:text-slate-300">
                        Hindi Name <span className="text-gray-500 font-normal">(in English)</span>
                      </label>
                      <span className={`text-[10px] font-semibold ${form.localName.length >= 30 ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>{form.localName.length}/30</span>
                    </div>
                    <input type="text" value={form.localName} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Search aliases <span className="text-gray-500 font-normal">(hidden from customers)</span></label>
                    <input type="text" value={form.searchAliases} readOnly className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Category</label>
                    <select value={form.categoryId} disabled className={`${inp} cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`}>
                      <option value="">Uncategorised</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Description</label>
                    <textarea value={form.description} readOnly className={`${inp} resize-none cursor-not-allowed bg-gray-100 dark:bg-slate-700/60`} rows={2} />
                  </div>
                </div>
              </details>
            </div>
            <div className="shrink-0 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3 bg-white dark:bg-slate-800">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.weightOptions.some(option => isOptionPriceValid(option) && isOptionQtyValid(option) && option.unit.trim())}
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
              <div className="flex items-center gap-2">
                {editingCombo && (
                  <button onClick={() => { setConfirmDeleteProduct(editingCombo); setShowComboModal(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors">
                    <Trash2 className="w-3 h-3" /> Remove from Store
                  </button>
                )}
                <button onClick={() => setShowComboModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2">
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
              <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
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
                  placeholder="Search by name or code..." autoFocus
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
                          <p className="mt-0.5 text-[10px] font-medium tabular-nums text-indigo-600 dark:text-indigo-300">{item.productCode}</p>
                          {item.localName && <p className="text-[10px] text-gray-500 truncate">{item.localName}</p>}
                          {item.description && <p className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-slate-400 line-clamp-2">{item.description}</p>}
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
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Add quantity *</label>
                  <input type="number" value={restockQty} min="0.001" step="0.001"
                    onChange={e => setRestockQty(e.target.value)} className={inp} placeholder="e.g. 5" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Unit</label>
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
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Note (optional)</label>
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
