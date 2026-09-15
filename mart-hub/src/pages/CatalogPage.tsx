import { useEffect, useState, useMemo } from 'react';
import { Package, Plus, Search, Loader2, X, Pencil, Trash2, Camera, Upload } from 'lucide-react';
import { categoriesApi, catalogApi, productsApi } from '../services/api';
import CategoryIcon from '../components/CategoryIcon';

interface CatalogProduct {
  id: string;
  name: string;
  localName: string | null;
  description: string | null;
  photoUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
}

interface Category { id: string; name: string; icon: string; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

export default function CatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState({ name: '', localName: '', description: '', categoryId: '' });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk image upload state
  interface BulkUploadItem { file: File; name: string; preview: string; categoryId: string; status: 'pending' | 'uploading' | 'done' | 'error'; }
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkItems, setBulkItems] = useState<BulkUploadItem[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const handleBulkFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const items: BulkUploadItem[] = files.map(file => ({
      file,
      name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      preview: URL.createObjectURL(file),
      categoryId: '',
      status: 'pending',
    }));
    setBulkItems(prev => [...prev, ...items]);
    e.target.value = '';
  };

  const handleBulkUpload = async () => {
    const pending = bulkItems.filter(i => i.status === 'pending');
    if (!pending.length) return;
    setBulkUploading(true);
    setBulkProgress(0);
    let done = 0;
    for (const item of pending) {
      setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'uploading' } : i));
      try {
        const uploadRes = await productsApi.uploadPhoto(item.file);
        const photoUrl = uploadRes.data.data.url;
        await catalogApi.create({ name: item.name, photoUrl, categoryId: item.categoryId || undefined });
        setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'done' } : i));
      } catch {
        setBulkItems(prev => prev.map(i => i.file === item.file ? { ...i, status: 'error' } : i));
      }
      done++;
      setBulkProgress(Math.round((done / pending.length) * 100));
    }
    setBulkUploading(false);
    await load();
  };

  const load = async () => {
    try {
      const [catRes, prodRes] = await Promise.all([categoriesApi.getAll(), catalogApi.getAll()]);
      setCategories(catRes.data.data || []);
      setProducts(prodRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => products.filter(p => {
    const matchCat = activeCat === 'all' || p.categoryId === activeCat;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.localName || '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  }), [products, activeCat, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', localName: '', description: '', categoryId: categories[0]?.id || '' });
    setPhotoFile(null); setPhotoPreview(null);
    setShowModal(true);
  };

  const openEdit = (p: CatalogProduct) => {
    setEditing(p);
    setForm({ name: p.name, localName: p.localName || '', description: p.description || '', categoryId: p.categoryId || '' });
    setPhotoFile(null); setPhotoPreview(p.photoUrl);
    setShowModal(true);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      let photoUrl = editing?.photoUrl ?? undefined;
      if (photoFile) {
        const res = await productsApi.uploadPhoto(photoFile);
        photoUrl = res.data.data.url;
      }
      const data = { name: form.name.trim(), localName: form.localName || undefined, description: form.description || undefined, photoUrl, categoryId: form.categoryId || undefined };
      if (editing) await catalogApi.update(editing.id, data);
      else await catalogApi.create(data);
      setShowModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await catalogApi.delete(id);
      setConfirmDeleteId(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to delete');
    } finally { setDeleting(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-slate-500">Master product list — name &amp; photo only. Stores browse this when adding products.</p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 text-gray-600 dark:text-slate-400 text-xs font-semibold rounded-xl transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Bulk Upload
            <input type="file" accept="image/*" multiple className="hidden" onChange={e => { handleBulkFileSelect(e); setShowBulkUpload(true); }} />
          </label>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Add Product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name..." className={`${inp} pl-9`} />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button onClick={() => setActiveCat('all')}
          className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${activeCat === 'all' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700'}`}>
          All
        </button>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${activeCat === cat.id ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700'}`}>
            <CategoryIcon icon={cat.icon} name={cat.name} className="w-4 h-4 object-contain" />{cat.name}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search || activeCat !== 'all' ? 'No products match.' : 'No products in catalog yet.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(p => (
            <div key={p.id} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 overflow-hidden shadow-sm flex flex-col">
              <div className="relative aspect-square bg-gray-50 dark:bg-slate-700">
                {p.photoUrl
                  ? <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl">🥦</div>
                }
                {p.categoryName && (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[9px] font-bold bg-black/50 text-white px-1.5 py-0.5 rounded-md">
                    <CategoryIcon icon={p.categoryIcon || ''} name={p.categoryName} className="w-3 h-3 object-contain" />
                    {p.categoryName}
                  </span>
                )}
              </div>
              <div className="p-2 flex flex-col flex-1">
                <p className="text-xs font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight">{p.name}</p>
                {p.localName && <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{p.localName}</p>}
                <div className="mt-auto pt-2 flex gap-1.5">
                  <button onClick={() => openEdit(p)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => setConfirmDeleteId(p.id)}
                    className="flex items-center justify-center px-2 py-1.5 text-[10px] text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Catalog Product' : 'Add to Catalog'}</p>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Photo */}
              <div className="flex justify-center">
                <div className="relative">
                  {photoPreview ? (
                    <>
                      <img src={photoPreview} alt="" className="w-24 h-24 rounded-2xl object-cover border-2 border-emerald-400 shadow-sm" />
                      <label className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center shadow-md cursor-pointer">
                        <Camera className="w-3.5 h-3.5 text-white" />
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                      </label>
                      <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </>
                  ) : (
                    <label className="w-24 h-24 rounded-2xl bg-gray-100 dark:bg-slate-700 border-2 border-dashed border-gray-300 dark:border-slate-500 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                      <Camera className="w-6 h-6 text-gray-400" />
                      <span className="text-[10px] text-gray-400">Add photo</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                    </label>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Product Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Fresh Tomatoes" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Local / Hindi Name</label>
                <input type="text" value={form.localName} onChange={e => setForm(f => ({ ...f, localName: e.target.value }))} className={inp} placeholder="e.g. Tamatar, Aloo" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Category</label>
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inp}>
                  <option value="">Uncategorised</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className={`${inp} resize-none`} rows={2} placeholder="Optional" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add to Catalog'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Remove from Catalog?</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Cannot delete if already used in a store.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)} disabled={deleting} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(confirmDeleteId)} disabled={deleting}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Upload Modal ── */}
      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !bulkUploading && setShowBulkUpload(false)} />
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Bulk Upload from Images</p>
                <p className="text-xs text-gray-400 mt-0.5">Filename becomes product name. Edit before saving.</p>
              </div>
              {!bulkUploading && (
                <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); setBulkProgress(0); }}
                  className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>

            {/* Add more images */}
            {!bulkUploading && (
              <div className="px-5 pt-3 flex-shrink-0">
                <label className="flex items-center justify-center gap-2 w-full py-2.5 border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl text-xs font-semibold text-gray-400 hover:border-emerald-400 hover:text-emerald-600 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" /> Add more images
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleBulkFileSelect} />
                </label>
              </div>
            )}

            {/* Progress bar */}
            {bulkUploading && (
              <div className="px-5 pt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Uploading...</p>
                  <p className="text-xs text-gray-400">{bulkProgress}%</p>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${bulkProgress}%` }} />
                </div>
              </div>
            )}

            {/* Items list */}
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {bulkItems.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Upload className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Select images to upload</p>
                </div>
              ) : bulkItems.map((item, idx) => (
                <div key={idx} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  item.status === 'done' ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/10'
                  : item.status === 'error' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                  : item.status === 'uploading' ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/10'
                  : 'border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50'
                }`}>
                  <img src={item.preview} alt={item.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      type="text"
                      value={item.name}
                      disabled={bulkUploading}
                      onChange={e => setBulkItems(prev => prev.map((bi, i) => i === idx ? { ...bi, name: e.target.value } : bi))}
                      className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                    />
                    <select
                      value={item.categoryId}
                      disabled={bulkUploading}
                      onChange={e => setBulkItems(prev => prev.map((bi, i) => i === idx ? { ...bi, categoryId: e.target.value } : bi))}
                      className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60">
                      <option value="">No category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="flex-shrink-0 w-6 text-center">
                    {item.status === 'done' && <span className="text-emerald-500 text-sm">✓</span>}
                    {item.status === 'error' && <span className="text-red-500 text-sm">✗</span>}
                    {item.status === 'uploading' && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
                    {item.status === 'pending' && !bulkUploading && (
                      <button onClick={() => setBulkItems(prev => prev.filter((_, i) => i !== idx))}>
                        <X className="w-4 h-4 text-gray-300 hover:text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0 flex gap-3">
              {bulkItems.some(i => i.status === 'done') && !bulkUploading ? (
                <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); setBulkProgress(0); }}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors">
                  Done
                </button>
              ) : (
                <>
                  <button onClick={() => { setShowBulkUpload(false); setBulkItems([]); }} disabled={bulkUploading}
                    className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={handleBulkUpload}
                    disabled={bulkUploading || bulkItems.filter(i => i.status === 'pending').length === 0}
                    className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                    {bulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {bulkUploading ? 'Uploading...' : `Upload ${bulkItems.filter(i => i.status === 'pending').length} product${bulkItems.filter(i => i.status === 'pending').length !== 1 ? 's' : ''}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
