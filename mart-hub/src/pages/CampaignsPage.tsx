import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, Tag, ToggleLeft, ToggleRight, Copy, Check } from 'lucide-react';
import { campaignsApi, customersApi, productsApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const DISCOUNT_TYPES = [
  { value: 'flat',         label: '₹ Flat Amount' },
  { value: 'percent',      label: '% Percentage' },
  { value: 'free_delivery',label: '🚚 Free Delivery' },
  { value: 'none',         label: 'ℹ️ Info Only (no discount)' },
];

const GRADIENTS = [
  'from-violet-500 via-purple-600 to-indigo-600',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-rose-500 via-pink-500 to-fuchsia-500',
  'from-amber-400 via-orange-500 to-red-500',
  'from-blue-500 via-indigo-500 to-violet-600',
  'from-slate-700 via-slate-800 to-slate-900',
];

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  draft:     'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  expired:   'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  paused:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  archived:  'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
};

const EMPTY_FORM = {
  title: '', subtitle: '', description: '', badgeText: '',
  discountType: 'flat', discountValue: '', maxDiscount: '', minOrderAmount: '0',
  couponCode: '', eligibilityType: 'all', inactiveDays: '30', targetCustomerIds: [] as string[], perCustomerLimit: '1', usageLimit: '', priority: '0',
  showInCarousel: false, carouselGradient: GRADIENTS[0],
  status: 'active', validFrom: '', validUntil: '',
};

export default function CampaignsPage() {
  const { role } = useAuthStore();
  const isSuperAdmin = role === 'super_admin';

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [carouselImageFile, setCarouselImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const res = await campaignsApi.getAll();
      setCampaigns(res.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    if (isSuperAdmin) customersApi.getAll().then(res => setCustomers(res.data.data || [])).catch(() => {});
  }, [isSuperAdmin]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setCarouselImageFile(null);
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      title: c.title || '', subtitle: c.subtitle || '', description: c.description || '',
      badgeText: c.badge_text || '', discountType: c.discount_type || 'flat',
      discountValue: String(c.discount_value || ''), maxDiscount: String(c.max_discount || ''),
      minOrderAmount: String(c.min_order_amount || '0'),
      couponCode: c.coupon_code || '', eligibilityType: c.eligibility_type || (c.new_customers_only ? 'first_order' : 'all'),
      inactiveDays: String(c.inactive_days || '30'),
      targetCustomerIds: c.targetCustomerIds || [],
      priority: String(c.priority || '0'),
      perCustomerLimit: String(c.per_customer_limit || '1'), usageLimit: String(c.usage_limit || ''),
      showInCarousel: c.show_in_carousel || false,
      carouselGradient: c.carousel_gradient || GRADIENTS[0],
      status: c.status || 'active',
      validFrom: c.valid_from ? c.valid_from.slice(0, 16) : '',
      validUntil: c.valid_until ? c.valid_until.slice(0, 16) : '',
    });
    setCarouselImageFile(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (form.eligibilityType === 'targeted_customers' && form.targetCustomerIds.length === 0) {
      alert('Select at least one target customer'); return;
    }
    setSaving(true);
    try {
      let carouselImageUrl = editing?.carousel_image_url || undefined;
      if (carouselImageFile) {
        setUploading(true);
        const res = await productsApi.uploadPhoto(carouselImageFile);
        carouselImageUrl = res.data.data.url;
        setUploading(false);
      }
      const data = {
        title: form.title.trim(), subtitle: form.subtitle || undefined,
        description: form.description || undefined, badgeText: form.badgeText || undefined,
        discountType: form.discountType, discountValue: parseFloat(form.discountValue) || 0,
        maxDiscount: form.maxDiscount ? parseFloat(form.maxDiscount) : undefined,
        minOrderAmount: parseFloat(form.minOrderAmount) || 0,
        couponCode: form.couponCode.trim().toUpperCase() || undefined,
        eligibilityType: form.eligibilityType,
        inactiveDays: form.eligibilityType === 'inactive_customers' ? parseInt(form.inactiveDays) || 30 : undefined,
        targetCustomerIds: form.eligibilityType === 'targeted_customers' ? form.targetCustomerIds : undefined,
        perCustomerLimit: parseInt(form.perCustomerLimit) || 1,
        usageLimit: form.usageLimit ? parseInt(form.usageLimit) : undefined,
        priority: parseInt(form.priority) || 0,
        showInCarousel: form.showInCarousel, carouselGradient: form.carouselGradient,
        carouselImageUrl,
        status: form.status,
        validFrom: form.validFrom || undefined, validUntil: form.validUntil || undefined,
      };
      if (editing) await campaignsApi.update(editing.id, data);
      else await campaignsApi.create(data);
      setShowModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); setUploading(false); }
  };

  const toggleStatus = async (c: any) => {
    const newStatus = c.status === 'active' ? 'draft' : 'active';
    await campaignsApi.update(c.id, { status: newStatus });
    await load();
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await campaignsApi.delete(id);
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to delete');
    } finally { setDeleting(false); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const discountLabel = (c: any) => {
    if (c.discount_type === 'flat') return `₹${c.discount_value} off`;
    if (c.discount_type === 'percent') return `${c.discount_value}% off${c.max_discount ? ` (max ₹${c.max_discount})` : ''}`;
    if (c.discount_type === 'free_delivery') return 'Free delivery';
    return 'Info only';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        {isSuperAdmin && <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm">
          <Plus className="w-3.5 h-3.5" /> New Campaign
        </button>}
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No campaigns yet.</p>
          <p className="text-xs mt-1">Create your first campaign to offer discounts to customers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm ${c.status === 'active' ? 'border-emerald-200 dark:border-emerald-800' : 'border-gray-100 dark:border-slate-700'}`}>
              {/* Gradient preview strip */}
              {c.show_in_carousel && (
                <div className={`h-1.5 bg-gradient-to-r ${c.carousel_gradient || GRADIENTS[0]}`} />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {c.badge_text && <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full">{c.badge_text}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] || STATUS_COLORS.draft}`}>{c.status}</span>
                      {c.show_in_carousel && <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">📱 Carousel</span>}
                      {c.eligibility_type === 'first_order' && <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">First order</span>}
                      {c.eligibility_type === 'inactive_customers' && <span className="text-[10px] font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded-full">Inactive {c.inactive_days} days</span>}
                      {c.eligibility_type === 'targeted_customers' && <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">Targeted customers</span>}
                    </div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{c.title}</p>
                    {c.subtitle && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{c.subtitle}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{discountLabel(c)}</span>
                      {c.min_order_amount > 0 && <span className="text-xs text-gray-500">Min ₹{c.min_order_amount}</span>}
                      {c.coupon_code && (
                        <button onClick={() => copyCode(c.coupon_code)}
                          className="flex items-center gap-1 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-lg hover:bg-indigo-100 transition-colors">
                          {c.coupon_code}
                          {copied === c.coupon_code ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      )}
                      {!c.coupon_code && <span className="text-xs text-gray-400">Auto-applied</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-400">Used: {c.useCount || 0} times</span>
                      {(c.totalDiscount || 0) > 0 && <span className="text-[10px] text-gray-400">₹{c.totalDiscount} given</span>}
                      {c.usage_limit && <span className="text-[10px] text-gray-400">Limit: {c.usage_count}/{c.usage_limit}</span>}
                      {c.valid_until && <span className="text-[10px] text-gray-400">Expires: {new Date(c.valid_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                    </div>
                  </div>
                  {isSuperAdmin && <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => toggleStatus(c)} title={c.status === 'active' ? 'Deactivate' : 'Activate'}>
                      {c.status === 'active'
                        ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                        : <ToggleLeft className="w-6 h-6 text-gray-400" />
                      }
                    </button>
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDelete(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Campaign' : 'New Campaign'}</p>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Basic info */}
              <div className="space-y-3">
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Campaign Title *</label>
                  <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="e.g. Welcome Offer" autoFocus /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Subtitle</label>
                    <input type="text" value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} className={inp} placeholder="e.g. For new users" /></div>
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Badge Text</label>
                    <input type="text" value={form.badgeText} onChange={e => setForm(f => ({ ...f, badgeText: e.target.value }))} className={inp} placeholder="e.g. 🎉 New User" /></div>
                </div>
              </div>

              {/* Discount */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Discount</p>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Type</label>
                  <select value={form.discountType} onChange={e => setForm(f => ({ ...f, discountType: e.target.value }))} className={inp}>
                    {DISCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></div>
                {form.discountType !== 'none' && form.discountType !== 'free_delivery' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                      {form.discountType === 'percent' ? 'Percentage %' : 'Amount ₹'} *</label>
                      <input type="number" value={form.discountValue} onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} className={inp} placeholder="50" min="0" /></div>
                    {form.discountType === 'percent' && (
                      <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Max Discount ₹</label>
                        <input type="number" value={form.maxDiscount} onChange={e => setForm(f => ({ ...f, maxDiscount: e.target.value }))} className={inp} placeholder="100" min="0" /></div>
                    )}
                  </div>
                )}
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Min Order Amount ₹</label>
                  <input type="number" value={form.minOrderAmount} onChange={e => setForm(f => ({ ...f, minOrderAmount: e.target.value }))} className={inp} placeholder="0" min="0" /></div>
              </div>

              {/* Coupon code */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Redemption</p>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Coupon Code <span className="text-gray-400 font-normal">(leave blank = auto-applied)</span></label>
                  <input type="text" value={form.couponCode} onChange={e => setForm(f => ({ ...f, couponCode: e.target.value.toUpperCase() }))} className={inp} placeholder="e.g. POOJA50" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Per Customer Limit</label>
                    <input type="number" value={form.perCustomerLimit} onChange={e => setForm(f => ({ ...f, perCustomerLimit: e.target.value }))} className={inp} placeholder="1" min="1" /></div>
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Total Usage Limit</label>
                    <input type="number" value={form.usageLimit} onChange={e => setForm(f => ({ ...f, usageLimit: e.target.value }))} className={inp} placeholder="Unlimited" min="1" /></div>
                </div>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Eligible Customers</label>
                  <select value={form.eligibilityType} onChange={e => setForm(f => ({ ...f, eligibilityType: e.target.value }))} className={inp}>
                    <option value="all">All customers</option>
                    <option value="first_order">First successful order only</option>
                    <option value="inactive_customers">Customers inactive for a period</option>
                    <option value="targeted_customers">Selected customers only</option>
                  </select>
                </div>
                {form.eligibilityType === 'inactive_customers' && <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Inactive for at least days</label>
                  <input type="number" value={form.inactiveDays} onChange={e => setForm(f => ({ ...f, inactiveDays: e.target.value }))} className={inp} min="1" placeholder="30" />
                </div>}
                {form.eligibilityType === 'targeted_customers' && <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Target customers</label>
                  <select multiple value={form.targetCustomerIds} onChange={e => setForm(f => ({ ...f, targetCustomerIds: Array.from(e.target.selectedOptions, option => option.value) }))} className={`${inp} h-32`}>
                    {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name || 'Customer'} · {customer.phone}</option>)}
                  </select>
                  <p className="mt-1 text-[10px] text-gray-500">Use Command or Control to select multiple customers.</p>
                </div>}
              </div>

              {/* Validity */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Validity</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Valid From</label>
                    <input type="datetime-local" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} className={inp} /></div>
                  <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Valid Until</label>
                    <input type="datetime-local" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} className={inp} /></div>
                </div>
                <div><label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="paused">Paused</option>
                  </select></div>
              </div>

              {/* Carousel */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Carousel</p>
                <label className="flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all border-gray-100 dark:border-slate-700 hover:border-blue-300">
                  <input type="checkbox" checked={form.showInCarousel} onChange={e => setForm(f => ({ ...f, showInCarousel: e.target.checked }))} className="accent-emerald-500" />
                  <div><p className="text-sm font-semibold text-gray-900 dark:text-white">Show in home carousel</p>
                    <p className="text-xs text-gray-500">Display as a card in the home page carousel</p></div>
                </label>
                {form.showInCarousel && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Carousel Image <span className="text-gray-400 font-normal">(optional)</span></label>
                      <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 dark:border-slate-600 rounded-xl cursor-pointer hover:border-emerald-400 transition-colors">
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> : <Plus className="w-4 h-4 text-gray-400" />}
                        <span className="text-xs text-gray-500">{carouselImageFile ? carouselImageFile.name : 'Upload image (stored as WebP)'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => setCarouselImageFile(e.target.files?.[0] || null)} />
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Gradient (fallback)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {GRADIENTS.map(g => (
                          <button key={g} type="button" onClick={() => setForm(f => ({ ...f, carouselGradient: g }))}
                            className={`h-10 rounded-xl bg-gradient-to-r ${g} border-2 transition-all ${form.carouselGradient === g ? 'border-white shadow-lg scale-105' : 'border-transparent'}`} />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.title.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Delete Campaign?</p>
            <p className="text-xs text-gray-500 mb-4">"{confirmDelete.title}" — cannot be undone if it has been used.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete.id)} disabled={deleting}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
