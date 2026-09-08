import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, Tag, Upload } from 'lucide-react';
import { categoriesApi, productsApi } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface Category { id: string; name: string; slug: string; icon: string; sortOrder: number; isActive: boolean; productCount: number; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

function CategoryIcon({ icon }: { icon: string }) {
  const isUrl = icon?.startsWith('/') || icon?.startsWith('http');
  if (isUrl) return <img src={icon} alt="" className="w-8 h-8 object-contain rounded-lg" />;
  return <span className="text-2xl">{icon || '📦'}</span>;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', icon: '', sortOrder: '0' });
  const [iconPreview, setIconPreview] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = async () => { const r = await categoriesApi.getAll(); setCategories(r.data.data || []); setLoading(false); };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', slug: '', icon: '', sortOrder: '0' });
    setIconPreview(null);
    setShowModal(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, slug: c.slug, icon: c.icon || '', sortOrder: String(c.sortOrder) });
    const isUrl = c.icon?.startsWith('/') || c.icon?.startsWith('http');
    setIconPreview(isUrl ? c.icon : null);
    setShowModal(true);
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await productsApi.uploadPhoto(file);
      const url = res.data.data.url;
      setForm(f => ({ ...f, icon: url }));
      setIconPreview(url);
    } catch { alert('Upload failed'); } finally { setUploading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, sortOrder: parseInt(form.sortOrder) };
      if (editing) await categoriesApi.update(editing.id, data);
      else await categoriesApi.create(data);
      setShowModal(false); await load();
    } catch { alert('Failed to save'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await categoriesApi.delete(id);
    setConfirmDeleteId(null);
    await load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Categories</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 transition-colors">
          <Plus className="w-4 h-4" /> Add Category
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {categories.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-slate-500"><Tag className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="text-sm">No categories yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {categories.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <CategoryIcon icon={c.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{c.productCount} products · /{c.slug}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setConfirmDeleteId(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete Category"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Category' : 'Add Category'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500 dark:text-slate-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Icon upload */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Icon</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 flex items-center justify-center flex-shrink-0">
                    {iconPreview
                      ? <img src={iconPreview} alt="" className="w-10 h-10 object-contain" />
                      : <span className="text-2xl">{form.icon || '📦'}</span>
                    }
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors w-fit">
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {uploading ? 'Uploading...' : 'Upload Image'}
                      <input type="file" accept="image/*" className="hidden" onChange={handleIconUpload} disabled={uploading} />
                    </label>
                    <input type="text" value={form.icon} onChange={e => { setForm(f => ({ ...f, icon: e.target.value })); setIconPreview(null); }} className={inp} placeholder="or type emoji e.g. 🥦" />
                  </div>
                </div>
              </div>
              <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Name *</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Vegetables" /></div>
              <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Slug *</label><input type="text" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className={inp} placeholder="e.g. vegetables" /></div>
              <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Sort Order</label><input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} className={inp} /></div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.slug} className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
