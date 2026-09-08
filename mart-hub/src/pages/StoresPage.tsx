import { useEffect, useState } from 'react';
import { Plus, Pencil, X, Loader2, Store } from 'lucide-react';
import { storesApi } from '../services/api';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

interface MartStore { id: string; name: string; address: string | null; isActive: boolean; createdAt: string; estimatedDelivery?: string; }
const EMPTY = { name: '', address: '', estimatedDelivery: '30-45 mins' };

export default function StoresPage() {
  const [stores, setStores] = useState<MartStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MartStore | null>(null);
  const [form, setForm] = useState(EMPTY);

  const load = () => storesApi.getAll().then(r => { setStores(r.data.data || []); setLoading(false); });
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (s: MartStore) => { setEditing(s); setForm({ name: s.name, address: s.address || '', estimatedDelivery: s.estimatedDelivery || '30-45 mins' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await storesApi.update(editing.id, { name: form.name.trim(), address: form.address.trim() || undefined, estimatedDelivery: form.estimatedDelivery.trim() });
      else await storesApi.create({ name: form.name.trim(), address: form.address.trim() || undefined, estimatedDelivery: form.estimatedDelivery.trim() });
      setShowModal(false); await load();
    } catch { alert('Failed to save store'); } finally { setSaving(false); }
  };

  const toggleActive = async (s: MartStore) => {
    await storesApi.update(s.id, { isActive: !s.isActive });
    await load();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Store</button>
      </div>

      <div className="page-card">
        {stores.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-slate-500">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No stores yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {stores.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                  <Store className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.name}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {s.address && <p className="text-xs text-gray-400 dark:text-slate-500">{s.address}</p>}
                  {s.estimatedDelivery && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">⏱ {s.estimatedDelivery} delivery</p>}
                </div>
                <button onClick={() => toggleActive(s)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${s.isActive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${s.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Store' : 'Add Store'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Store Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Shapoorji" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Address</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inp} placeholder="e.g. Shapoorji, Kolkata" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Estimated Delivery Time</label>
                <input type="text" value={form.estimatedDelivery} onChange={e => setForm(f => ({ ...f, estimatedDelivery: e.target.value }))} className={inp} placeholder="e.g. 10-15 mins" />
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">Shown to customers on order confirmation</p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
