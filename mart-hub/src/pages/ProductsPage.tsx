import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2,
  Loader2, X, Upload, Package,
  Percent, EyeOff, AlertCircle, CheckCircle,
  GripVertical, Check,
} from 'lucide-react';
import { productsApi, categoriesApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import ConfirmDialog from '../components/ConfirmDialog';

function CategoryIcon({ icon, name }: { icon: string; name: string }) {
  const isUrl = icon?.startsWith('/') || icon?.startsWith('http');
  if (isUrl) return <img src={icon} alt={name} className="w-5 h-5 object-contain inline-block" />;
  return <span>{icon}</span>;
}

interface Product {
  id: string; name: string; categoryId: string | null; categoryName: string;
  price: number; unit: string; discountPercent: number;
  isAvailable: boolean;
  availabilityStatus: 'available' | 'out_of_stock' | 'hidden';
  photoUrl: string | null; description: string | null;
  sortOrder: number;
}

interface Category {
  id: string; name: string; icon: string; sortOrder: number; productCount: number;
}

type SortMode = 'manual' | 'discount';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const UNCATEGORISED_ID = '__uncategorised__';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', categoryId: '', price: '', unit: '1 kg', discountPercent: '0', description: '', availabilityStatus: 'available' as 'available' | 'out_of_stock' | 'hidden' });

  // Active category tab — 'all' or category id
  const [activeTab, setActiveTab] = useState<string>('all');

  // Sort mode per tab — stored as { tabId: 'manual' | 'discount' }
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({});

  // Reorder mode
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderList, setReorderList] = useState<Product[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const load = async () => {
    const [p, c] = await Promise.all([productsApi.getAll(getActiveStoreId()), categoriesApi.getAll()]);
    setProducts(p.data.data || []);
    setCategories(c.data.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const tabs = useMemo(() => {
    const cats = categories.map(c => ({ id: c.id, label: c.name, icon: c.icon || '📦', sortOrder: c.sortOrder }));
    const hasUncategorised = products.some(p => !p.categoryId);
    return [
      { id: 'all', label: 'All', icon: '', sortOrder: -1 },
      ...cats,
      ...(hasUncategorised ? [{ id: UNCATEGORISED_ID, label: 'Others', icon: '📦', sortOrder: 9999 }] : []),
    ];
  }, [categories, products]);

  // ── Products for active tab ───────────────────────────────────────────────

  const tabProducts = useMemo(() => {
    let list: Product[];
    if (activeTab === 'all') {
      list = [...products];
    } else if (activeTab === UNCATEGORISED_ID) {
      list = products.filter(p => !p.categoryId);
    } else {
      list = products.filter(p => p.categoryId === activeTab);
    }

    const mode = sortModes[activeTab] || 'manual';
    if (mode === 'discount') {
      return [...list].sort((a, b) => b.discountPercent - a.discountPercent);
    }
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [products, activeTab, sortModes]);

  // ── Grouped products (for 'all' tab) ─────────────────────────────────────

  const groupedProducts = useMemo(() => {
    if (activeTab !== 'all') return null;
    const mode = sortModes['all'] || 'manual';

    const groups: Array<{ category: Category | null; label: string; icon: string; products: Product[] }> = [];

    // Categories in sort order
    const sortedCats = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const cat of sortedCats) {
      let prods = products.filter(p => p.categoryId === cat.id);
      if (mode === 'discount') prods = [...prods].sort((a, b) => b.discountPercent - a.discountPercent);
      else prods = [...prods].sort((a, b) => a.sortOrder - b.sortOrder);
      if (prods.length > 0) groups.push({ category: cat, label: cat.name, icon: cat.icon || '📦', products: prods });
    }

    // Uncategorised
    const uncat = products.filter(p => !p.categoryId);
    if (uncat.length > 0) {
      const sorted = mode === 'discount' ? [...uncat].sort((a, b) => b.discountPercent - a.discountPercent) : [...uncat].sort((a, b) => a.sortOrder - b.sortOrder);
      groups.push({ category: null, label: 'Others', icon: '📦', products: sorted });
    }

    return groups;
  }, [products, categories, activeTab, sortModes]);

  // ── Reorder mode ─────────────────────────────────────────────────────────

  const enterReorderMode = () => {
    // Build flat ordered list for current tab scope
    const list = activeTab === 'all'
      ? [...tabProducts].sort((a, b) => a.sortOrder - b.sortOrder)
      : [...tabProducts].sort((a, b) => a.sortOrder - b.sortOrder);
    setReorderList(list);
    setReorderMode(true);
  };

  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => { dragOver.current = index; };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOver.current === null) return;
    const updated = [...reorderList];
    const [moved] = updated.splice(dragItem.current, 1);
    updated.splice(dragOver.current, 0, moved);
    dragItem.current = null;
    dragOver.current = null;
    setReorderList(updated);
  };

  const saveReorder = async () => {
    setSavingOrder(true);
    try {
      await Promise.all(reorderList.map((p, i) => productsApi.update(p.id, { sortOrder: i })));
      await load();
      setReorderMode(false);
    } finally { setSavingOrder(false); }
  };

  const cancelReorder = () => { setReorderMode(false); setReorderList([]); };

  // ── Category sort (still arrow-based, less frequent) ─────────────────────

  const toggleSortMode = () => {
    setSortModes(prev => ({
      ...prev,
      [activeTab]: (prev[activeTab] || 'manual') === 'manual' ? 'discount' : 'manual',
    }));
  };

  const currentSortMode = sortModes[activeTab] || 'manual';

  // ── Product CRUD ──────────────────────────────────────────────────────────

  const UNITS = ['kg', 'g', 'pcs', 'dozen', 'litre', 'ml', 'bunch', 'packet'];

  const openCreate = () => {
    setEditing(null);
    const defaultCat = activeTab !== 'all' && activeTab !== UNCATEGORISED_ID ? activeTab : (categories[0]?.id || '');
    setForm({ name: '', categoryId: defaultCat, price: '', unit: '1 kg', discountPercent: '0', description: '', availabilityStatus: 'available' });
    setPhotoFile(null); setPhotoPreview(null);
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, categoryId: p.categoryId || '', price: String(p.price), unit: p.unit, discountPercent: String(p.discountPercent), description: p.description || '', availabilityStatus: p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock') });
    setPhotoFile(null); setPhotoPreview(p.photoUrl);
    setShowModal(true);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let photoUrl = editing?.photoUrl || null;
      if (photoFile) {
        try {
          const res = await productsApi.uploadPhoto(photoFile);
          photoUrl = res.data.data.url;
        } catch (uploadErr: any) {
          const msg = uploadErr?.response?.data?.error || uploadErr?.message || 'Upload failed';
          alert(`Photo upload failed: ${msg}\n\nSaving product without photo.`);
          photoUrl = editing?.photoUrl || null;
        }
      }
      const data = { ...form, price: parseFloat(form.price), discountPercent: parseFloat(form.discountPercent), photoUrl, isAvailable: form.availabilityStatus === 'available' };
      if (editing) await productsApi.update(editing.id, { ...data, storeId: getActiveStoreId() });
      else await productsApi.create({ ...data, storeId: getActiveStoreId() });
      setShowModal(false);
      await load();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      alert(`Failed to save product: ${msg}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await productsApi.delete(id);
    setConfirmDeleteId(null);
    await load();
  };

  const setAvailability = async (p: Product, status: 'available' | 'out_of_stock' | 'hidden') => {
    await productsApi.update(p.id, { availabilityStatus: status, storeId: getActiveStoreId() } as any);
    await load();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Product row ───────────────────────────────────────────────────────────

  const StatusBadge = ({ status }: { status: string }) => {
    if (status === 'out_of_stock') return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><AlertCircle className="w-2.5 h-2.5" />Out of Stock</span>;
    if (status === 'hidden') return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full"><EyeOff className="w-2.5 h-2.5" />Hidden</span>;
    return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full"><CheckCircle className="w-2.5 h-2.5" />Available</span>;
  };

  const ProductRow = ({ p, index }: { p: Product; index: number }) => (
    <div
      className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-colors ${
        reorderMode ? 'cursor-grab active:cursor-grabbing bg-white dark:bg-slate-800' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'
      }`}
      draggable={reorderMode}
      onDragStart={() => handleDragStart(index)}
      onDragEnter={() => handleDragEnter(index)}
      onDragEnd={handleDragEnd}
      onDragOver={e => e.preventDefault()}
    >
      {/* Drag handle — only in reorder mode */}
      {reorderMode && (
        <GripVertical className="w-5 h-5 text-gray-300 flex-shrink-0" />
      )}

      {/* Photo */}
      {p.photoUrl ? (
        <img src={p.photoUrl} alt={p.name} loading="lazy" decoding="async"
          className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border-2 border-emerald-200 bg-gray-100 dark:bg-slate-700" />
      ) : (
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
          <Package className="w-5 h-5 text-gray-300" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
          <StatusBadge status={p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock')} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
          <span className="text-xs text-gray-500 dark:text-slate-300">{p.unit} · ₹{p.price}</span>
          {p.discountPercent > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
              <Percent className="w-2.5 h-2.5" />{p.discountPercent}% off
            </span>
          )}
          {activeTab === 'all' && p.categoryName && (
            <span className="hidden sm:inline text-[10px] text-gray-500 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{p.categoryName}</span>
          )}
        </div>

      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => setConfirmDeleteId(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        {/* Availability select — single version for all sizes */}
        {(() => {
          const cur = p.availabilityStatus || (p.isAvailable ? 'available' : 'out_of_stock');
          const color = cur === 'available' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
            : cur === 'out_of_stock' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
            : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600';
          return (
            <select value={cur} onChange={e => setAvailability(p, e.target.value as any)} onClick={e => e.stopPropagation()}
              className={`text-xs border rounded-lg px-1.5 py-1 focus:outline-none cursor-pointer font-semibold max-w-[90px] sm:max-w-none ${color}`}>
              <option value="available">✅ On</option>
              <option value="out_of_stock">⚠️ Out</option>
              <option value="hidden">🙈 Hidden</option>
            </select>
          );
        })()}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {/* Reorder — disabled on All tab */}
          {!reorderMode ? (
            <button
              onClick={enterReorderMode}
              disabled={activeTab === 'all'}
              title={activeTab === 'all' ? 'Select a category tab to reorder' : ''}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              <GripVertical className="w-3.5 h-3.5" /> Reorder
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-slate-400 hidden sm:block">Drag to reorder</span>
              <button onClick={cancelReorder}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-500 bg-white dark:bg-slate-800 hover:bg-gray-50 transition-all">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button onClick={saveReorder} disabled={savingOrder}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-all">
                {savingOrder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save Order
              </button>
            </div>
          )}

          {/* Discount sort toggle */}
          {!reorderMode && (
            <button onClick={toggleSortMode}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                currentSortMode === 'discount'
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600'
                  : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-emerald-300'
              }`}>
              <Percent className="w-3.5 h-3.5" />
              {currentSortMode === 'discount' ? 'By Discount ✓' : 'By Discount'}
            </button>
          )}
        </div>

        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}
          >
            <CategoryIcon icon={tab.icon} name={tab.label} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Product list */}
      <div className="page-card">
        {products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No products yet. Add your first product.</p>
          </div>
        ) : reorderMode ? (
          // Reorder mode — flat draggable list
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {reorderList.map((p, i) => (
              <ProductRow key={p.id} p={p} index={i} />
            ))}
          </div>
        ) : activeTab === 'all' && groupedProducts ? (
          // Grouped view for ALL tab
          <div>
            {groupedProducts.map((group) => (
              <div key={group.category?.id || UNCATEGORISED_ID}>
                {/* Category header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 sticky top-0">
                  <CategoryIcon icon={group.icon} name={group.label} />
                  <span className="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">{group.label}</span>
                  <span className="text-[10px] text-gray-400 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-1.5 py-0.5 rounded-full ml-1">
                    {group.products.length}
                  </span>
                </div>
                {group.products.map((p, i) => (
                  <ProductRow key={p.id} p={p} index={i} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          // Flat list for specific category tab
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {tabProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No products in this category.</p>
              </div>
            ) : (
              tabProducts.map((p, i) => (
                <ProductRow key={p.id} p={p} index={i} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete Product"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Photo</label>
                <div className="flex items-center gap-3">
                  {photoPreview ? (
                    <img src={photoPreview} alt="" className="w-16 h-16 rounded-xl object-cover border-2 border-emerald-400 shadow-sm ring-2 ring-emerald-100" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center border-2 border-dashed border-emerald-200">
                      <Package className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">
                    <Upload className="w-3.5 h-3.5" /> Upload
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Fresh Tomatoes" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Category</label>
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inp}>
                  <option value="">Uncategorised</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Price (₹) *</label>
                  <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className={inp} placeholder="0" min="0" step="0.5" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Unit</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={form.unit.match(/^(\d*\.?\d*)/)?.[1] || ''}
                      onChange={e => {
                        const qty = e.target.value;
                        const type = form.unit.replace(/^\d*\.?\d*\s*/, '') || 'kg';
                        setForm(f => ({ ...f, unit: `${qty} ${type}`.trim() }));
                      }}
                      className={`${inp} w-16`} placeholder="1" min="0" step="0.5" />
                    <select
                      value={form.unit.replace(/^\d*\.?\d*\s*/, '') || 'kg'}
                      onChange={e => {
                        const qty = form.unit.match(/^(\d*\.?\d*)/)?.[1] || '1';
                        setForm(f => ({ ...f, unit: `${qty} ${e.target.value}`.trim() }));
                      }}
                      className={inp}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Discount %</label>
                <input type="number" value={form.discountPercent} onChange={e => setForm(f => ({ ...f, discountPercent: e.target.value }))} className={inp} placeholder="0" min="0" max="100" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={`${inp} resize-none`} rows={2} placeholder="Optional description" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Availability</label>
                <select value={form.availabilityStatus} onChange={e => setForm(f => ({ ...f, availabilityStatus: e.target.value as any }))} className={inp}>
                  <option value="available">✅ Available</option>
                  <option value="out_of_stock">⚠️ Out of Stock</option>
                  <option value="hidden">🙈 Hidden</option>
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
    </div>
  );
}
