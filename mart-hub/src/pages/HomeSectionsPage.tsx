import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, GripVertical, Eye, EyeOff, LayoutGrid, Search, ArrowUp, ArrowDown, Package, Sparkles } from 'lucide-react';
import { homeSectionsApi, categoriesApi, productsApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import PageSkeleton from '../components/PageSkeleton';
import SmartImage from '../components/SmartImage';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

// Mirrors HOME_SECTION_KEYS in mart-backend/src/services/homeSection.service.ts.
// Adding a type here without teaching the storefront to render it would create a
// section the customer never sees, so the two stay in lockstep.
const SECTION_TYPES = [
  {
    key: 'todays_combos',
    label: "Today's Combos",
    hint: 'Every combo (bundle) in your catalogue is detected automatically. Reorder them, or remove any you don’t want to feature.',
    icon: LayoutGrid,
    usesProducts: true,
    productPool: 'bundles',
  },
  {
    key: 'fresh_vegetables',
    label: 'Fresh Vegetables',
    hint: 'A grid of products from the chosen category.',
    icon: LayoutGrid,
    usesProducts: false,
    productPool: 'all',
  },
  {
    key: 'deals',
    label: "Today's Deals",
    hint: 'Every discounted product shows here automatically, biggest discount first — set discounts in the product form.',
    icon: Package,
    usesProducts: false,
    productPool: 'all',
  },
  {
    key: 'top_picks',
    label: 'Store Favourites',
    hint: 'Pick the exact products (and their order) to feature. Leave empty to auto-show your bestsellers.',
    icon: Sparkles,
    usesProducts: true,
    productPool: 'all',
  },
] as const;

type SectionTypeKey = typeof SECTION_TYPES[number]['key'];

const typeInfo = (key: string) => SECTION_TYPES.find(t => t.key === key);
const typeLabel = (key: string) => typeInfo(key)?.label || key;

interface FormState {
  sectionKey: SectionTypeKey;
  title: string;
  subtitle: string;
  categorySlug: string;
  productIds: string[];
  limit: string;
  layout: '' | 'row' | 'grid';
  isEnabled: boolean;
}

const emptyForm = (key: SectionTypeKey, label: string): FormState => ({
  sectionKey: key, title: label, subtitle: '', categorySlug: '',
  productIds: [], limit: '', layout: '', isEnabled: true,
});

export default function HomeSectionsPage() {
  const storeId = getActiveStoreId();
  const [sections, setSections] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(SECTION_TYPES[0].key, SECTION_TYPES[0].label));
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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

  const remainingTypes = SECTION_TYPES.filter(t => !sections.some(s => s.sectionKey === t.key));

  // Combo sections are auto-detected: every bundle product is seeded (in catalogue
  // order) so the store person only has to reorder or trim the list, never hunt
  // for combos to add. Any stored ids that are no longer bundles are dropped.
  const bundleIds = products.filter(p => p.isBundle).map(p => p.id);
  const seedProductIds = (key: string, existing: string[]): string[] => {
    if (key !== 'todays_combos') return existing;
    const bundleIdSet = new Set(bundleIds);
    const valid = existing.filter(id => bundleIdSet.has(id));
    return valid.length ? valid : [...bundleIds];
  };

  const openCreate = () => {
    const next = remainingTypes[0];
    if (!next) return;
    setEditing(null);
    setProductSearch('');
    setForm({ ...emptyForm(next.key, next.label), productIds: seedProductIds(next.key, []) });
    setShowModal(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setProductSearch('');
    const storedIds = Array.isArray(s.config?.productIds) ? s.config.productIds : [];
    setForm({
      sectionKey: s.sectionKey,
      title: s.title || '',
      subtitle: s.subtitle || '',
      categorySlug: s.config?.categorySlug || '',
      productIds: seedProductIds(s.sectionKey, storedIds),
      limit: s.config?.limit != null ? String(s.config.limit) : '',
      layout: s.config?.layout || '',
      isEnabled: s.isEnabled,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { alert('A section title is required'); return; }
    setSaving(true);
    try {
      const limitNum = form.limit.trim() ? Number(form.limit.trim()) : null;
      const data = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        isEnabled: form.isEnabled,
        config: {
          categorySlug: form.categorySlug.trim() || null,
          productIds: form.productIds,
          limit: limitNum != null && Number.isFinite(limitNum) ? limitNum : null,
          layout: form.layout || null,
        },
      };
      if (editing) await homeSectionsApi.update(storeId, editing.id, data);
      else await homeSectionsApi.create(storeId, { ...data, sectionKey: form.sectionKey });
      setShowModal(false);
      await load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleEnabled = async (s: any) => {
    await homeSectionsApi.update(storeId, s.id, { isEnabled: !s.isEnabled });
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
    await homeSectionsApi.reorder(storeId, reordered.map(s => s.id));
  };

  // ── Top Picks product picker helpers ──────────────────────────────────────
  const toggleProduct = (id: string) => {
    setForm(f => f.productIds.includes(id)
      ? { ...f, productIds: f.productIds.filter(p => p !== id) }
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

  if (loading) return <PageSkeleton />;

  const activeType = typeInfo(form.sectionKey);
  const selectedProducts = form.productIds
    .map(id => products.find(p => p.id === id))
    .filter(Boolean);
  const poolProducts = activeType?.productPool === 'bundles'
    ? products.filter(p => p.isBundle)
    : products;
  const filteredProducts = poolProducts
    .filter(p => (p.name || '').toLowerCase().includes(productSearch.trim().toLowerCase()))
    .slice(0, 60);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3">
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          These sections control the order and content of the customer app&apos;s home page. Drag to reorder; the first enabled section appears first. Product sections always use live catalogue data, so prices and stock are never duplicated here.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">{sections.length} section{sections.length !== 1 ? 's' : ''} · Drag to reorder</p>
        <button onClick={openCreate} disabled={remainingTypes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
          <Plus className="w-3.5 h-3.5" /> Add Section
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No homepage sections yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map((s, i) => {
            const Icon = typeInfo(s.sectionKey)?.icon || LayoutGrid;
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
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.title || 'Untitled section'}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-bold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">{typeLabel(s.sectionKey)}</span>
                      {s.config?.categorySlug && <span className="text-[10px] text-gray-500">· {s.config.categorySlug}</span>}
                      {(s.sectionKey === 'top_picks' || s.sectionKey === 'todays_combos') && (s.config?.productIds?.length || 0) > 0 && (
                        <span className="text-[10px] text-gray-500">· {s.config.productIds.length} picked</span>
                      )}
                      {s.config?.layout && <span className="text-[10px] text-gray-500">· {s.config.layout}</span>}
                      {s.subtitle && <span className="text-xs text-gray-500 truncate">{s.subtitle}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!s.isEnabled && (
                    <span className="text-[10px] font-bold bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">Hidden</span>
                  )}
                  <button onClick={() => toggleEnabled(s)} title={s.isEnabled ? 'Hide' : 'Show'}>
                    {s.isEnabled ? <Eye className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                  </button>
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Section' : 'Add Section'}</p>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">Section Type</label>
                  <div className="space-y-2">
                    {remainingTypes.map(t => (
                      <button key={t.key} type="button"
                        onClick={() => setForm(f => ({ ...f, sectionKey: t.key, title: t.label, productIds: seedProductIds(t.key, []) }))}
                        className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${form.sectionKey === t.key ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-slate-600'}`}>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{t.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {editing && activeType && (
                <div className="rounded-xl bg-gray-50 dark:bg-slate-700/40 px-3 py-2.5">
                  <p className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">{activeType.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{activeType.hint}</p>
                </div>
              )}

              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Title</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="e.g. Today's Combos" /></div>
              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Subtitle <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} className={inp} placeholder="e.g. Fresh combos, packed today" /></div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Category scope</label>
                <select value={form.categorySlug} onChange={e => setForm(f => ({ ...f, categorySlug: e.target.value }))} className={inp}>
                  <option value="">All categories</option>
                  {categories.map((c: any) => <option key={c.id} value={c.slug}>{c.name}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Restrict this section to one category. Leave as “All categories” to show everything.</p>
              </div>

              {activeType?.usesProducts && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">
                      {activeType.productPool === 'bundles' ? 'Combos (auto-detected)' : 'Picked products'}
                    </label>
                    {activeType.productPool === 'bundles' && (
                      <button type="button" onClick={() => setForm(f => ({ ...f, productIds: [...bundleIds] }))}
                        className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
                        Reset to all combos
                      </button>
                    )}
                  </div>
                  {selectedProducts.length === 0
                    ? <p className="text-[11px] text-gray-400 mb-2">
                        {activeType.productPool === 'bundles'
                          ? 'No combos found in your catalogue yet — create a bundle product to feature it here.'
                          : 'Nothing picked yet — add products below.'}
                      </p>
                    : <div className="space-y-1.5 mb-3">
                        {selectedProducts.map((p: any, idx: number) => (
                          <div key={p.id} className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-slate-600 px-2 py-1.5">
                            <span className="text-[11px] font-bold text-gray-400 w-4">{idx + 1}</span>
                            <SmartImage
                              src={p.photoUrl}
                              className="w-8 h-8 rounded-lg flex-shrink-0"
                              imgClassName="object-cover"
                              fallback={<div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex-shrink-0" />}
                            />
                            <span className="flex-1 min-w-0 text-xs text-gray-900 dark:text-white truncate">{p.name}</span>
                            <button type="button" onClick={() => moveProduct(p.id, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => moveProduct(p.id, 1)} disabled={idx === selectedProducts.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => toggleProduct(p.id)} className="p-1 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                      </div>}
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)} className={`${inp} pl-9`} placeholder={activeType.productPool === 'bundles' ? 'Search combos to add...' : 'Search products to add...'} />
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700">
                    {filteredProducts.length === 0 && <p className="text-[11px] text-gray-400 p-3">No products found.</p>}
                    {filteredProducts.map((p: any) => {
                      const picked = form.productIds.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => toggleProduct(p.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${picked ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/40'}`}>
                          <SmartImage
                            src={p.photoUrl}
                            className="w-8 h-8 rounded-lg flex-shrink-0"
                            imgClassName="object-cover"
                            fallback={<div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex-shrink-0" />}
                          />
                          <span className="flex-1 min-w-0 text-xs text-gray-900 dark:text-white truncate">{p.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${picked ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>{picked ? 'Added' : 'Add'}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {activeType.productPool === 'bundles'
                      ? 'Drag the arrows to set the order combos appear in. Remove any to hide from the row.'
                      : 'Leave empty to auto-show bestsellers — picked products override and follow your order.'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Layout</label>
                  <select value={form.layout} onChange={e => setForm(f => ({ ...f, layout: e.target.value as FormState['layout'] }))} className={inp}>
                    <option value="">Auto</option>
                    <option value="row">Row (swipe)</option>
                    <option value="grid">Grid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Max items <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="number" min={1} max={60} value={form.limit} onChange={e => setForm(f => ({ ...f, limit: e.target.value }))} className={inp} placeholder="No limit" />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.isEnabled} onChange={e => setForm(f => ({ ...f, isEnabled: e.target.checked }))} className="accent-emerald-500" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Enabled (visible in app)</span>
              </label>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving...' : editing ? 'Save' : 'Add Section'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
