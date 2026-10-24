import { useEffect, useState } from 'react';
import { Plus, GripVertical, Pencil, Trash2, Eye, EyeOff, LayoutGrid, Copy, Search, X, ArrowUp, ArrowDown, Image, Sparkles, Package } from 'lucide-react';
import { homeSectionsApi, productsApi, categoriesApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import PageSkeleton from '../components/PageSkeleton';
import SmartImage from '../components/SmartImage';

const KINDS = [
  { key: 'manual', label: 'Hand-picked', hint: 'Curate exact products in a specific order.', icon: Sparkles, usesProducts: true, multiCategory: true },
  { key: 'category', label: 'Category shelf', hint: 'Show products from one or more categories, auto-sorted.', icon: LayoutGrid, usesProducts: false, multiCategory: true },
  { key: 'combo', label: 'Combos / Basket', hint: 'Mix products from different categories into one basket.', icon: Package, usesProducts: true, multiCategory: true },
  { key: 'deals', label: 'Deals', hint: 'Auto-show discounted products, biggest discount first.', icon: Package, usesProducts: false, multiCategory: true },
  { key: 'bestsellers', label: 'Bestsellers', hint: 'Top-selling products for this store in the last 30 days.', icon: Sparkles, usesProducts: false, multiCategory: true },
  { key: 'new_arrivals', label: 'New arrivals', hint: 'Recently added products.', icon: Sparkles, usesProducts: false, multiCategory: true },
  { key: 'banner', label: 'Banner', hint: 'Image with an optional link.', icon: Image, usesProducts: false, multiCategory: false },
  { key: 'category_tiles', label: 'Category tiles', hint: 'Tap to jump to categories.', icon: LayoutGrid, usesProducts: false, multiCategory: true },
] as const;

type KindKey = typeof KINDS[number]['key'];

interface FormState {
  kind: KindKey;
  title: string;
  subtitle: string;
  categorySlugs: string[];
  productIds: string[];
  excludeProductIds: string[];
  limit: string;
  layout: '' | 'row' | 'grid' | 'hero' | 'tiles';
  isEnabled: boolean;
  badge: string;
  fallback: 'none' | 'bestsellers' | 'new_arrivals';
  sort: 'catalogue' | 'discount' | 'price_asc' | 'price_desc' | 'newest' | 'bestselling';
  imageUrl: string;
  buttonText: string;
  href: string;
  alt: string;
}

const emptyForm = (k: KindKey): FormState => ({
  kind: k, title: KINDS.find(x => x.key === k)?.label || k, subtitle: '',
  categorySlugs: [], productIds: [], excludeProductIds: [],
  limit: '', layout: '', isEnabled: true, badge: '',
  fallback: 'none', sort: 'catalogue',
  imageUrl: '', buttonText: '', href: '', alt: '',
});

const inp = "w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

export default function HomeSectionsPage() {
  const storeId = getActiveStoreId();
  const [sections, setSections] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm('manual'));
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  const load = async () => {
    try {
      const [sr, cr, pr] = await Promise.all([
        homeSectionsApi.getAll(storeId),
        categoriesApi.getAll().catch(() => ({ data: { data: [] } })),
        productsApi.getAll(storeId).catch(() => ({ data: { data: [] } })),
      ]);
      setSections(sr.data.data || []);
      setCategories(cr.data.data || []);
      setProducts(pr.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = (kind?: KindKey) => {
    const k = kind || 'manual';
    setEditing(null);
    setProductSearch('');
    setForm(emptyForm(k));
    setShowGallery(false);
    setShowModal(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setProductSearch('');
    const cfg = s.config || {};
    const slugs = Array.isArray(cfg.categorySlugs) && cfg.categorySlugs.length ? cfg.categorySlugs : (cfg.categorySlug ? [cfg.categorySlug] : []);
    setForm({
      kind: s.kind || s.sectionKey || 'manual',
      title: s.title || '',
      subtitle: s.subtitle || '',
      categorySlugs: slugs,
      productIds: Array.isArray(cfg.productIds) ? cfg.productIds : [],
      excludeProductIds: Array.isArray(cfg.excludeProductIds) ? cfg.excludeProductIds : [],
      limit: cfg.limit != null ? String(cfg.limit) : '',
      layout: s.layout || cfg.layout || '',
      isEnabled: s.isEnabled !== false,
      badge: s.badge || '',
      fallback: cfg.fallback || 'none',
      sort: cfg.sort || 'catalogue',
      imageUrl: cfg.imageUrl || '',
      buttonText: cfg.buttonText || (cfg as any).cta || '',
      href: cfg.href || '',
      alt: cfg.alt || '',
    });
    setShowGallery(false);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { alert('A section title is required'); return; }
    setSaving(true);
    try {
      const limitNum = form.limit.trim() ? Number(form.limit.trim()) : null;
      const data: any = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        isEnabled: form.isEnabled,
        layout: form.layout || 'row',
        badge: form.badge.trim() || null,
        config: {
          categorySlugs: form.categorySlugs,
          productIds: form.productIds,
          excludeProductIds: form.excludeProductIds,
          limit: limitNum != null && Number.isFinite(limitNum) ? limitNum : null,
          fallback: form.fallback,
          sort: form.sort,
      imageUrl: (form.imageUrl||'').trim() || null,
      href: (form.href||'').trim() || null,
      alt: (form.alt||'').trim() || null,
      buttonText: ((form as any).buttonText||'').trim() || null,
    },
      };
      if (editing) await homeSectionsApi.update(storeId, editing.id, data);
      else await homeSectionsApi.create(storeId, { ...data, kind: form.kind });
      setShowModal(false);
      await load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleEnabled = async (s: any) => {
    await homeSectionsApi.update(storeId, s.id, { isEnabled: !s.isEnabled });
    await load();
  };

  const duplicate = async (s: any) => {
    await homeSectionsApi.duplicate(storeId, s.id);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this section? The storefront will stop showing it.')) return;
    await homeSectionsApi.delete(storeId, id);
    await load();
  };

  const handleDragEnd = async () => {
    if (dragging === null || dragOver === null || dragging === dragOver) { setDragging(null); setDragOver(null); return; }
    const reordered = [...sections];
    const [moved] = reordered.splice(dragging, 1);
    reordered.splice(dragOver, 0, moved);
    setSections(reordered);
    setDragging(null); setDragOver(null);
    await homeSectionsApi.reorder(storeId, reordered.map((s: any) => s.id));
  };

  const toggleProduct = (id: string) => {
    setForm(f => f.productIds.includes(id)
      ? { ...f, productIds: f.productIds.filter((productId: string) => productId !== id) }
      : { ...f, productIds: [...f.productIds, id] });
  };
  const moveProduct = (id: string, dir: -1 | 1) => {
    setForm(f => {
      const ids = [...f.productIds];
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return f;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...f, productIds: ids };
    });
  };
  const toggleSlug = (slug: string) => {
    setForm(f => f.categorySlugs.includes(slug)
      ? { ...f, categorySlugs: f.categorySlugs.filter(s => s !== slug) }
      : { ...f, categorySlugs: [...f.categorySlugs, slug] });
  };

  if (loading) return <PageSkeleton />;

  const activeKind = KINDS.find(k => k.key === form.kind);
  const selectedProducts = form.productIds.map((id: string) => products.find((product: any) => product.id === id)).filter(Boolean);
  const filteredProducts = products
    .filter((product: any) => (product.name || '').toLowerCase().includes(productSearch.trim().toLowerCase()))
    .slice(0, 80);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3">
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          Home Builder — drag shelves to reorder. Add unlimited shelves, mix categories and products, and control what appears on the customer home page.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">{sections.length} shelf{sections.length !== 1 ? 's' : ''} · Drag to reorder</p>
        <button onClick={() => setShowGallery(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
          <Plus className="w-3.5 h-3.5" /> Add Shelf
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No home shelves yet.</p>
          <button onClick={() => setShowGallery(true)} className="mt-3 text-sm text-emerald-600 font-semibold">Add your first shelf</button>
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map((s, i) => {
            const Icon = KINDS.find(k => k.key === (s.kind || s.sectionKey))?.icon || LayoutGrid;
            const kindLabel = KINDS.find(k => k.key === (s.kind || s.sectionKey))?.label || s.kind || s.sectionKey;
            const thumbs = (s.config?.productIds || []).slice(0,4).map((pid: string) => products.find(p => p.id === pid)).filter(Boolean);
            return (
            <div key={s.id}
              draggable
              onDragStart={() => setDragging(i)}
              onDragEnter={() => setDragOver(i)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm transition-all cursor-grab active:cursor-grabbing ${dragOver === i ? 'border-emerald-400 scale-[1.01]' : 'border-gray-100 dark:border-slate-700'}`}>
              <div className="flex items-center gap-3 p-3">
                <div className={`flex items-center gap-3 flex-1 min-w-0 ${!s.isEnabled ? 'opacity-50' : ''}`}>
                  <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="w-10 h-10 rounded-xl flex-shrink-0 bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.title || 'Untitled'}</p>
                      {s.badge && <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{s.badge}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-bold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">{kindLabel}</span>
                      {!s.isEnabled && <span className="text-[10px] font-bold bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">Hidden</span>}
                      {(s.config?.categorySlugs?.length || s.config?.categorySlug) && <span className="text-[10px] text-gray-500">· {(s.config?.categorySlugs?.length||1)} categor{(s.config?.categorySlugs?.length||1)===1?'y':'ies'}</span>}
                    </div>
                    {thumbs.length > 0 && (
                      <div className="flex items-center gap-1 mt-2">
                        {thumbs.map((p: any) => (
                          <SmartImage key={p.id} src={p.photoUrl} className="w-8 h-8 rounded-lg" imgClassName="object-cover" fallback={<div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700" />} />
                        ))}
                        {(s.config?.productIds?.length||0) > 4 && <span className="text-[10px] text-gray-400">+{s.config.productIds.length - 4}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleEnabled(s)} title={s.isEnabled ? 'Hide' : 'Show'}>{s.isEnabled ? <Eye className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}</button>
                  <button onClick={() => duplicate(s)} title="Duplicate"><Copy className="w-4 h-4 text-gray-400 hover:text-indigo-600" /></button>
                  <button onClick={() => openEdit(s)} title="Edit"><Pencil className="w-4 h-4 text-gray-400 hover:text-indigo-600" /></button>
                  <button onClick={() => handleDelete(s.id)} title="Delete"><Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Gallery */}
      {showGallery && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <p className="text-sm font-bold text-gray-900 dark:text-white">Add a shelf</p>
              <button onClick={() => setShowGallery(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20"><X className="w-4 h-4 text-red-500" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-2">
              {KINDS.map(k => (
                <button key={k.key} onClick={() => openCreate(k.key)} className="text-left p-3 rounded-xl border border-gray-200 dark:border-slate-600 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10">
                  <k.icon className="w-4 h-4 text-emerald-500 mb-1" />
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{k.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{k.hint}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit shelf' : 'Add shelf'} — {activeKind?.label}</p>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20"><X className="w-4 h-4 text-red-500" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Title</label><input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} className={inp} /></div>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Badge <span className="text-gray-400">(optional)</span></label><input value={form.badge} onChange={e => setForm(f => ({...f, badge: e.target.value}))} className={inp} placeholder="e.g. Sale" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Subtitle <span className="text-gray-400">(optional)</span></label><input value={form.subtitle} onChange={e => setForm(f => ({...f, subtitle: e.target.value}))} className={inp} /></div>

              {(activeKind?.multiCategory) && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Categories</label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c: any) => (
                      <button key={c.id} type="button" onClick={() => toggleSlug(c.slug)}
                        className={`px-2.5 py-1 text-xs rounded-full border ${form.categorySlugs.includes(c.slug) ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300'}`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Leave empty to use all categories.</p>
                </div>
              )}

              {form.kind === 'banner' && (
                <div className="space-y-2">
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Image URL</label><input value={form.imageUrl || ''} onChange={e => setForm((f:any) => ({...f, imageUrl: e.target.value}))} className={inp} placeholder="https://..." /></div>
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Button text (optional)</label><input value={(form as any).buttonText || ''} onChange={e => setForm((f:any) => ({...f, buttonText: e.target.value} as any))} className={inp} placeholder="Shop now" /></div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Link (optional)</label>
                    <select value={(form.href && (form.href.startsWith('#') || form.href.startsWith('/category/'))) ? form.href : (form.href ? 'custom' : '')} onChange={e => {
                      const v = e.target.value;
                      if (v === 'custom') setForm((f:any) => ({...f, href: f.href?.startsWith('#') || f.href?.startsWith('/category/') ? '' : f.href}));
                      else setForm((f:any) => ({...f, href: v}));
                    }} className={inp}>
                      <option value="">None</option>
                      <option value="#categories">All Categories</option>
                      <option value="#catalog">Catalog</option>
                      <option value="#cart">Cart</option>
                      {categories?.map((c:any)=> (<option key={c.id} value={`/category/${c.slug}`}>Category: {c.name}</option>))}
                      <option value="custom">Custom URL</option>
                    </select>
                    {form.href && !String(form.href).startsWith('#') && !String(form.href).startsWith('/category/') && <input value={form.href} onChange={e => setForm((f:any) => ({...f, href: e.target.value}))} className={`${inp} mt-2`} placeholder="https://..." />}
                  </div>
                </div>
              )}

              {activeKind?.usesProducts && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Picked products (drag to reorder)</label>
                  {selectedProducts.length === 0 ? <p className="text-[11px] text-gray-400 mb-2">Nothing picked yet.</p> : (
                    <div className="space-y-1.5 mb-3">
                      {selectedProducts.map((p: any, idx: number) => (
                        <div key={p.id} className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-slate-600 px-2 py-1.5">
                          <span className="text-[11px] font-bold text-gray-400 w-4">{idx + 1}</span>
                          <SmartImage src={p.photoUrl} className="w-8 h-8 rounded-lg flex-shrink-0" imgClassName="object-cover" fallback={<div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700" />} />
                          <span className="flex-1 min-w-0 text-xs text-gray-900 dark:text-white truncate">{p.name}</span>
                          <button onClick={() => moveProduct(p.id, -1)} disabled={idx === 0}><ArrowUp className="w-3.5 h-3.5 text-gray-400" /></button>
                          <button onClick={() => moveProduct(p.id, 1)} disabled={idx === selectedProducts.length - 1}><ArrowDown className="w-3.5 h-3.5 text-gray-400" /></button>
                          <button onClick={() => toggleProduct(p.id)}><X className="w-3.5 h-3.5 text-red-400" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input value={productSearch} onChange={e => setProductSearch(e.target.value)} className={`${inp} pl-9`} placeholder="Search products to add..." />
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
                    {filteredProducts.map((p: any) => (
                      <button key={p.id} onClick={() => toggleProduct(p.id)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
                        <SmartImage src={p.photoUrl} className="w-7 h-7 rounded-lg flex-shrink-0" imgClassName="object-cover" fallback={<div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-700" />} />
                        <span className="flex-1 min-w-0 text-xs text-gray-900 dark:text-white truncate">{p.name}</span>
                        {form.productIds.includes(p.id) && <span className="text-[10px] text-emerald-600 font-semibold">Added</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Layout</label>
                  <select value={form.layout} onChange={e => setForm(f => ({...f, layout: e.target.value as any}))} className={inp}>
                    <option value="">Auto</option>
                    <option value="row">Row (scroll)</option>
                    <option value="grid">Grid</option>
                    <option value="hero">Hero</option>
                    <option value="tiles">Tiles</option>
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Limit</label><input value={form.limit} onChange={e => setForm(f => ({...f, limit: e.target.value}))} className={inp} placeholder="e.g. 10" /></div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl disabled:opacity-50">{saving ? 'Saving...' : editing ? 'Save' : 'Add shelf'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
