import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, GripVertical, Eye, EyeOff, Image } from 'lucide-react';
import { carouselApi, campaignsApi } from '../services/api';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const GRADIENTS = [
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-violet-500 via-purple-600 to-indigo-600',
  'from-rose-500 via-pink-500 to-fuchsia-500',
  'from-amber-400 via-orange-500 to-red-500',
  'from-blue-500 via-indigo-500 to-violet-600',
  'from-slate-700 via-slate-800 to-slate-900',
];

export default function CarouselPage() {
  const [slides, setSlides] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ title: '', subtitle: '', gradient: GRADIENTS[0], campaignId: '', isActive: true });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const load = async () => {
    try {
      const [sr, cr] = await Promise.all([carouselApi.getAll(), campaignsApi.getAll()]);
      setSlides(sr.data.data || []);
      setCampaigns((cr.data.data || []).filter((c: any) => c.status === 'active'));
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', subtitle: '', gradient: GRADIENTS[0], campaignId: '', isActive: true });
    setImageFile(null); setImagePreview(null);
    setShowModal(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setForm({ title: s.title || '', subtitle: s.subtitle || '', gradient: s.gradient || GRADIENTS[0], campaignId: s.campaign_id || '', isActive: s.is_active });
    setImageFile(null); setImagePreview(s.image_url);
    setShowModal(true);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let imageUrl = editing?.image_url || undefined;
      if (imageFile) {
        setUploading(true);
        const res = await carouselApi.uploadImage(imageFile);
        imageUrl = res.data.data.url;
        setUploading(false);
      }
      const data = {
        title: form.title || undefined, subtitle: form.subtitle || undefined,
        imageUrl, gradient: form.gradient,
        campaignId: form.campaignId || undefined,
        isActive: form.isActive,
        sortOrder: editing?.sort_order || slides.length + 1,
      };
      if (editing) await carouselApi.update(editing.id, data);
      else await carouselApi.create(data);
      setShowModal(false);
      await load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); setUploading(false); }
  };

  const toggleActive = async (s: any) => {
    await carouselApi.update(s.id, { isActive: !s.is_active });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this slide?')) return;
    await carouselApi.delete(id);
    await load();
  };

  const handleDragEnd = async () => {
    if (dragging === null || dragOver === null || dragging === dragOver) { setDragging(null); setDragOver(null); return; }
    const reordered = [...slides];
    const [moved] = reordered.splice(dragging, 1);
    reordered.splice(dragOver, 0, moved);
    setSlides(reordered);
    setDragging(null); setDragOver(null);
    await carouselApi.reorder(reordered.map(s => s.id));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">{slides.length} slide{slides.length !== 1 ? 's' : ''} · Drag to reorder</p>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
          <Plus className="w-3.5 h-3.5" /> Add Slide
        </button>
      </div>

      {slides.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No carousel slides yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {slides.map((s, i) => (
            <div key={s.id}
              draggable
              onDragStart={() => setDragging(i)}
              onDragEnter={() => setDragOver(i)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm transition-all cursor-grab active:cursor-grabbing ${dragOver === i ? 'border-emerald-400 scale-[1.01]' : 'border-gray-100 dark:border-slate-700'} ${!s.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 p-3">
                <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                {/* Preview */}
                <div className={`w-16 h-10 rounded-xl flex-shrink-0 overflow-hidden ${!s.image_url ? 'bg-gradient-to-r ' + (s.gradient || GRADIENTS[0]) : ''}`}>
                  {s.image_url
                    ? <img src={s.image_url} alt={s.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.title || 'Untitled slide'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {s.subtitle && <p className="text-xs text-gray-500 truncate">{s.subtitle}</p>}
                    {s.campaign_id && <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded-full">Campaign linked</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => toggleActive(s)} title={s.is_active ? 'Hide' : 'Show'}>
                    {s.is_active ? <Eye className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
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
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Slide' : 'Add Slide'}</p>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Image upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">Slide Image</label>
                <label className="relative block w-full h-32 rounded-2xl overflow-hidden cursor-pointer border-2 border-dashed border-gray-200 dark:border-slate-600 hover:border-emerald-400 transition-colors">
                  {imagePreview
                    ? <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                    : <div className={`w-full h-full bg-gradient-to-r ${form.gradient} flex items-center justify-center`}>
                        <p className="text-white text-xs font-semibold">Click to upload image</p>
                      </div>
                  }
                  {uploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                </label>
                {imagePreview && (
                  <button onClick={() => { setImageFile(null); setImagePreview(null); }} className="mt-1 text-xs text-red-400 hover:text-red-500">Remove image (use gradient)</button>
                )}
              </div>

              {/* Gradient picker */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2">Gradient (shown if no image)</label>
                <div className="grid grid-cols-6 gap-2">
                  {GRADIENTS.map(g => (
                    <button key={g} type="button" onClick={() => setForm(f => ({ ...f, gradient: g }))}
                      className={`h-8 rounded-xl bg-gradient-to-r ${g} border-2 transition-all ${form.gradient === g ? 'border-white shadow-lg scale-110' : 'border-transparent'}`} />
                  ))}
                </div>
              </div>

              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Title</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="e.g. Shop local. Support local." /></div>
              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Subtitle</label>
                <input type="text" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} className={inp} placeholder="e.g. Fresh from your neighbourhood" /></div>

              {/* Link to campaign */}
              <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Link to Campaign <span className="text-gray-400 font-normal">(optional)</span></label>
                <select value={form.campaignId} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))} className={inp}>
                  <option value="">No campaign</option>
                  {campaigns.map((c: any) => <option key={c.id} value={c.id}>{c.title} — {c.badge_text || ''}</option>)}
                </select></div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="accent-emerald-500" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Active (visible in app)</span>
              </label>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving...' : editing ? 'Save' : 'Add Slide'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
