import { useEffect, useState } from 'react';
import { Plus, Pencil, X, Loader2, Store, Clock, Phone, Upload, TrendingUp, CheckCircle, Search, User, UserPlus, KeyRound, Copy } from 'lucide-react';
import { storesApi, productsApi, usersApi } from '../services/api';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

interface MartStore {
  id: string; name: string; address: string | null; isActive: boolean; isLive: boolean;
  logoUrl: string | null; supportPhone: string | null; openingHours: any;
  ownerName: string | null; revenueModel: string; commissionPercent: number;
  monthlyFee: number; estimatedDelivery?: string;
}

type Tab = 'details' | 'hours' | 'revenue' | 'manager';

export default function StoresPage() {
  const [stores, setStores] = useState<MartStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MartStore | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  const [form, setForm] = useState({
    name: '', address: '', ownerName: '', supportPhone: '',
    estimatedDelivery: '10-15 mins', logoUrl: '',
    revenueModel: 'commission', commissionPercent: '10', monthlyFee: '0',
    openingHours: DEFAULT_HOURS as any,
  });

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [credModal, setCredModal] = useState<{ store: MartStore; manager: any } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => Promise.all([storesApi.getAll(), usersApi.getAll()]).then(([sr, ur]) => {
    setStores(sr.data.data || []);
    setAllUsers(ur.data.data || []);
    setLoading(false);
  });
  useEffect(() => { load(); }, []);

  const getStoreManager = (storeId: string) =>
    allUsers.find((u: any) => u.storeId === storeId && u.role === 'store_owner');

  const handleResetPassword = async (userId: string) => {
    if (!newPassword || newPassword.length < 6) { alert('Min 6 characters'); return; }
    setResettingPwd(true);
    try {
      await usersApi.update(userId, { password: newPassword });
      alert('Password updated successfully');
      setNewPassword('');
    } catch { alert('Failed to reset password'); }
    finally { setResettingPwd(false); }
  };

  const copyCredentials = (manager: any, password?: string) => {
    const text = `Gokez Hub Login\nURL: https://hub.gokez.com\nUsername: ${manager.username}${password ? `\nPassword: ${password}` : ''}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Manager state
  const [managerSearch, setManagerSearch] = useState('');
  const [managerResults, setManagerResults] = useState<any[]>([]);
  const [selectedManager, setSelectedManager] = useState<any | null>(null);
  const [newManager, setNewManager] = useState({ username: '', password: '', name: '', phone: '' });
  const [managerMode, setManagerMode] = useState<'search' | 'create'>('search');
  const [searchingManager, setSearchingManager] = useState(false);
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);

  const searchManagers = async (q: string) => {
    if (!q.trim()) { setManagerResults([]); return; }
    setSearchingManager(true);
    try {
      const r = await usersApi.getAll();
      const all = r.data.data || [];
      setManagerResults(all.filter((u: any) =>
        u.username.toLowerCase().includes(q.toLowerCase()) ||
        (u.name || '').toLowerCase().includes(q.toLowerCase())
      ));
    } catch {} finally { setSearchingManager(false); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', address: '', ownerName: '', supportPhone: '', estimatedDelivery: '10-15 mins', logoUrl: '', revenueModel: 'commission', commissionPercent: '10', monthlyFee: '0', openingHours: DEFAULT_HOURS });
    setManagerSearch(''); setManagerResults([]); setSelectedManager(null);
    setNewManager({ username: '', password: '', name: '', phone: '' });
    setManagerMode('search'); setCreatedStoreId(null);
    setTab('details'); setShowModal(true);
  };

  const openEdit = (s: MartStore) => {
    setEditing(s);
    setForm({
      name: s.name, address: s.address || '', ownerName: s.ownerName || '',
      supportPhone: s.supportPhone || '', estimatedDelivery: s.estimatedDelivery || '10-15 mins',
      logoUrl: s.logoUrl || '', revenueModel: s.revenueModel || 'commission',
      commissionPercent: String(s.commissionPercent || 10), monthlyFee: String(s.monthlyFee || 0),
      openingHours: s.openingHours || DEFAULT_HOURS,
    });
    setTab('details'); setShowModal(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const res = await productsApi.uploadPhoto(file);
      setForm(f => ({ ...f, logoUrl: res.data.data.url }));
    } catch { alert('Upload failed'); } finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(), address: form.address.trim() || undefined,
        ownerName: form.ownerName.trim() || undefined,
        supportPhone: form.supportPhone.trim() || undefined,
        logoUrl: form.logoUrl || undefined,
        revenueModel: form.revenueModel,
        commissionPercent: parseFloat(form.commissionPercent) || 10,
        monthlyFee: parseFloat(form.monthlyFee) || 0,
        openingHours: form.openingHours,
        estimatedDelivery: form.estimatedDelivery.trim(),
      };
      if (editing) await storesApi.update(editing.id, data);
      else {
        const res = await storesApi.create(data);
        setCreatedStoreId(res.data.data.id);
        setTab('manager');
        setSaving(false);
        return;
      }
      setShowModal(false); await load();
    } catch { alert('Failed to save store'); } finally { setSaving(false); }
  };

  const toggleLive = async (s: MartStore) => {
    await storesApi.update(s.id, { isLive: !s.isLive } as any);
    await load();
  };

  const updateHours = (day: string, field: string, value: any) => {
    setForm(f => ({ ...f, openingHours: { ...f.openingHours, [day]: { ...f.openingHours[day], [field]: value } } }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Store</button>
      </div>

      <div className="space-y-3">
        {stores.length === 0 ? (
          <div className="page-card text-center py-12 text-gray-400 dark:text-slate-500">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No stores yet.</p>
          </div>
        ) : stores.map(s => (
          <div key={s.id} className="page-card">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Logo */}
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                {s.logoUrl
                  ? <img src={s.logoUrl} alt={s.name} className="w-full h-full object-cover" />
                  : <Store className="w-5 h-5 text-emerald-600" />
                }
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{s.name}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.isLive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {s.isLive ? '🟢 Live' : '🟡 Setup'}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {s.ownerName && <p className="text-xs text-gray-400">👤 {s.ownerName}</p>}
                  {s.supportPhone && <p className="text-xs text-gray-400">📞 {s.supportPhone}</p>}
                  {s.address && <p className="text-xs text-gray-400">📍 {s.address}</p>}
                  {(() => {
                    const mgr = getStoreManager(s.id);
                    return mgr ? (
                      <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">👤 @{mgr.username}</p>
                    ) : (
                      <p className="text-xs text-amber-500">⚠️ No manager assigned</p>
                    );
                  })()}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {s.revenueModel === 'commission' ? `${s.commissionPercent}% commission` :
                   s.revenueModel === 'flat' ? `₹${s.monthlyFee}/month` :
                   `${s.commissionPercent}% + ₹${s.monthlyFee}/month`}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Live toggle */}
                <button onClick={() => toggleLive(s)} title={s.isLive ? 'Take offline' : 'Go live'}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${s.isLive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${s.isLive ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
                {getStoreManager(s.id) && (
                  <button onClick={() => { setCredModal({ store: s, manager: getStoreManager(s.id) }); setNewPassword(''); }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors" title="Manage credentials">
                    <KeyRound className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {/* Credentials Modal */}
      {credModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Store Owner Credentials</h2>
                <p className="text-xs text-gray-400 mt-0.5">{credModal.store.name}</p>
              </div>
              <button onClick={() => setCredModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Current credentials */}
              <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-4 space-y-2">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Login Details</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">URL</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">hub.gokez.com</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Username</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{credModal.manager.username}</p>
                  </div>
                  <button onClick={() => copyCredentials(credModal.manager)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 transition-colors">
                    <Copy className="w-3.5 h-3.5" />{copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Reset password */}
              <div>
                <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-2">Set New Password</p>
                <div className="flex gap-2">
                  <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    placeholder="New password (min 6 chars)" />
                  <button onClick={() => handleResetPassword(credModal.manager.id)} disabled={resettingPwd || !newPassword}
                    className="px-3 py-2 text-xs font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1">
                    {resettingPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    Set
                  </button>
                </div>
                {newPassword.length >= 6 && (
                  <button onClick={() => copyCredentials(credModal.manager, newPassword)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl hover:bg-emerald-100 transition-colors">
                    <Copy className="w-3.5 h-3.5" />{copied ? 'Copied!' : 'Copy credentials with new password'}
                  </button>
                )}
              </div>

              <p className="text-[10px] text-gray-400 text-center">
                Share these credentials securely with the store owner. They should change their password after first login.
              </p>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Store' : 'Add Store'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 dark:border-slate-700">
              {([['details', 'Details', Store], ['hours', 'Hours', Clock], ['revenue', 'Revenue', TrendingUp], ['manager', 'Manager', User]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${tab === id ? 'text-emerald-600 border-b-2 border-emerald-500' : 'text-gray-400 hover:text-gray-600'}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-4">

              {/* Details tab */}
              {tab === 'details' && (
                <>
                  {/* Logo */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Store Logo</label>
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {form.logoUrl ? <img src={form.logoUrl} alt="" className="w-full h-full object-cover" /> : <Store className="w-6 h-6 text-gray-300" />}
                      </div>
                      <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {uploading ? 'Uploading...' : 'Upload Logo'}
                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                      </label>
                    </div>
                  </div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Store Name *</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Gobra Fresh" autoFocus /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Owner Name</label><input type="text" value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} className={inp} placeholder="e.g. Arman Ali" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Area / Address</label><input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inp} placeholder="e.g. Gobra, Kolkata" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5"><Phone className="w-3 h-3 inline mr-1" />Support Phone</label><input type="tel" value={form.supportPhone} onChange={e => setForm(f => ({ ...f, supportPhone: e.target.value }))} className={inp} placeholder="+91 XXXXX XXXXX" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Estimated Delivery Time</label><input type="text" value={form.estimatedDelivery} onChange={e => setForm(f => ({ ...f, estimatedDelivery: e.target.value }))} className={inp} placeholder="e.g. 10-15 mins" /></div>
                </>
              )}

              {/* Hours tab */}
              {tab === 'hours' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">Set opening hours for each day. Toggle off for closed days.</p>
                  {DAYS.map(day => (
                    <div key={day} className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-600 dark:text-slate-300 w-8">{DAY_LABELS[day]}</span>
                      <button type="button" onClick={() => updateHours(day, 'closed', !form.openingHours[day]?.closed)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${!form.openingHours[day]?.closed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${!form.openingHours[day]?.closed ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      {!form.openingHours[day]?.closed ? (
                        <>
                          <input type="time" value={form.openingHours[day]?.open || '09:00'} onChange={e => updateHours(day, 'open', e.target.value)}
                            className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                          <span className="text-xs text-gray-400">to</span>
                          <input type="time" value={form.openingHours[day]?.close || '21:00'} onChange={e => updateHours(day, 'close', e.target.value)}
                            className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                        </>
                      ) : (
                        <span className="text-xs text-red-400 font-medium">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Revenue tab */}
              {tab === 'revenue' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Revenue Model</label>
                    <div className="space-y-2">
                      {[
                        { id: 'commission', label: 'Commission per order', sub: 'Take % of each order' },
                        { id: 'flat', label: 'Flat monthly fee', sub: 'Fixed monthly subscription' },
                        { id: 'both', label: 'Commission + Monthly fee', sub: 'Both models combined' },
                      ].map(opt => (
                        <label key={opt.id} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${form.revenueModel === opt.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                          <input type="radio" name="revenueModel" value={opt.id} checked={form.revenueModel === opt.id} onChange={() => setForm(f => ({ ...f, revenueModel: opt.id }))} className="accent-emerald-500 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p>
                            <p className="text-xs text-gray-400">{opt.sub}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  {(form.revenueModel === 'commission' || form.revenueModel === 'both') && (
                    <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Commission %</label>
                      <input type="number" value={form.commissionPercent} onChange={e => setForm(f => ({ ...f, commissionPercent: e.target.value }))} className={inp} placeholder="10" min="0" max="100" step="0.5" /></div>
                  )}
                  {(form.revenueModel === 'flat' || form.revenueModel === 'both') && (
                    <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Monthly Fee (₹)</label>
                      <input type="number" value={form.monthlyFee} onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))} className={inp} placeholder="0" min="0" /></div>
                  )}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                    <p className="text-xs text-blue-700 dark:text-blue-400 font-medium flex items-start gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      Store manager sees their earnings after platform fee deduction in their dashboard.
                    </p>
                  </div>
                </div>
              )}
              {/* Manager tab */}
              {tab === 'manager' && (
                <div className="space-y-4">
                  {createdStoreId && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3">
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                        ✅ Store created! Now assign a store owner.
                      </p>
                    </div>
                  )}

                  {/* Mode toggle */}
                  <div className="flex gap-2">
                    <button onClick={() => setManagerMode('search')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl border-2 transition-all ${
                        managerMode === 'search' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-100 dark:border-slate-700 text-gray-500'
                      }`}>
                      <Search className="w-3.5 h-3.5" /> Find Existing
                    </button>
                    <button onClick={() => setManagerMode('create')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl border-2 transition-all ${
                        managerMode === 'create' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-100 dark:border-slate-700 text-gray-500'
                      }`}>
                      <UserPlus className="w-3.5 h-3.5" /> Create New
                    </button>
                  </div>

                  {/* Search existing */}
                  {managerMode === 'search' && (
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="text" value={managerSearch}
                          onChange={e => { setManagerSearch(e.target.value); searchManagers(e.target.value); }}
                          className={`${inp} pl-9`} placeholder="Search by username or name..." autoFocus />
                      </div>
                      {searchingManager && <p className="text-xs text-gray-400 text-center">Searching...</p>}
                      {managerResults.length > 0 && (
                        <div className="border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">
                          {managerResults.map((u: any) => (
                            <button key={u.id} onClick={() => setSelectedManager(u)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors ${
                                selectedManager?.id === u.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''
                              }`}>
                              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-emerald-600">{(u.name || u.username)[0].toUpperCase()}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-900 dark:text-white">{u.name || u.username}</p>
                                <p className="text-[10px] text-gray-400">@{u.username} · {u.role?.replace('_', ' ')}</p>
                              </div>
                              {selectedManager?.id === u.id && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedManager && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          <p className="text-xs text-emerald-700 dark:text-emerald-400">
                            <strong>{selectedManager.name || selectedManager.username}</strong> will be assigned as store owner
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Create new manager */}
                  {managerMode === 'create' && (
                    <div className="space-y-3">
                      <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Full Name</label>
                        <input type="text" value={newManager.name} onChange={e => setNewManager(m => ({ ...m, name: e.target.value }))} className={inp} placeholder="Manager's full name" /></div>
                      <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Username *</label>
                        <input type="text" value={newManager.username} onChange={e => setNewManager(m => ({ ...m, username: e.target.value }))} className={inp} placeholder="e.g. gobra_manager" /></div>
                      <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Phone</label>
                        <input type="tel" value={newManager.phone} onChange={e => setNewManager(m => ({ ...m, phone: e.target.value }))} className={inp} placeholder="+91 XXXXX XXXXX" /></div>
                      <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Password *</label>
                        <input type="password" value={newManager.password} onChange={e => setNewManager(m => ({ ...m, password: e.target.value }))} className={inp} placeholder="Min 6 characters" /></div>
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
              {tab === 'manager' ? (
                <button
                  disabled={saving || (managerMode === 'search' && !selectedManager) || (managerMode === 'create' && (!newManager.username || !newManager.password))}
                  onClick={async () => {
                    const storeId = createdStoreId || editing?.id;
                    if (!storeId) return;
                    setSaving(true);
                    try {
                      if (managerMode === 'search' && selectedManager) {
                        await usersApi.update(selectedManager.id, { role: 'store_owner', storeId });
                      } else if (managerMode === 'create' && newManager.username && newManager.password) {
                        await usersApi.create({ username: newManager.username, password: newManager.password, name: newManager.name, phone: newManager.phone, role: 'store_owner', storeId });
                      }
                      setShowModal(false); await load();
                    } catch (e: any) {
                      alert(e?.response?.data?.error || 'Failed to assign manager');
                    } finally { setSaving(false); }
                  }}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : '✅ Assign & Finish'}
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : tab === 'details' ? 'Save & Continue →' : 'Save Store'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
