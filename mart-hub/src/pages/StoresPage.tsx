import { useEffect, useState } from 'react';
import { Plus, Pencil, X, Loader2, Store, Upload, CheckCircle, Search, User, UserPlus, SlidersHorizontal } from 'lucide-react';
import { storesApi, productsApi, usersApi, teamApi, zonesApi, inventoryApi } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import SmartImage from '../components/SmartImage';
import PageSkeleton from '../components/PageSkeleton';
import { useAuthStore } from '../store/authStore';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

interface MartStore {
  id: string; name: string; address: string | null; isActive: boolean; isLive: boolean;
  logoUrl: string | null; supportPhone: string | null; openingHours: any;
  ownerName: string | null; revenueModel: string; commissionPercent: number;
  monthlyFee: number;
}

type Tab = 'details' | 'revenue' | 'manager' | 'inventory';

export default function StoresPage() {
  const { role } = useAuthStore();
  const canManageInventoryPolicy = ['super_admin', 'store_owner', 'store_manager'].includes(role || '');
  const [stores, setStores] = useState<MartStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MartStore | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  const [form, setForm] = useState({
    name: '', address: '', ownerName: '', supportPhone: '',
    logoUrl: '',
    monthlyFee: '0',
    openingHours: DEFAULT_HOURS as any,
  });

  const [teamByStore, setTeamByStore] = useState<Record<string, any[]>>({});
  const [zones, setZones] = useState<any[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [zoneTeam, setZoneTeam] = useState<any[]>([]);
  const [zoneTeamLoading, setZoneTeamLoading] = useState(false);
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [memberForm, setMemberForm] = useState({ name: '', email: '', phone: '', role: 'staff', isActive: true });
  const [savingMember, setSavingMember] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<MartStore | null>(null);
  const [inventoryPolicy, setInventoryPolicy] = useState({ inventoryTracking: false, autoOutOfStock: true, lowStockThreshold: '' });
  const [inventoryPolicyLoading, setInventoryPolicyLoading] = useState(false);
  const [savingInventoryPolicy, setSavingInventoryPolicy] = useState(false);

  const load = async () => {
    try {
      const sr = await storesApi.getAll();
      const storeList = sr.data.data || [];
      setStores(storeList);
      const teams: Record<string, any[]> = {};
      await Promise.all(storeList.map(async (s: MartStore) => {
        try {
          const tr = await teamApi.getStoreTeam(s.id);
          teams[s.id] = tr.data.data || [];
        } catch {
          teams[s.id] = [];
        }
      }));
      setTeamByStore(teams);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const managerStoreId = editing?.id || createdStoreId || '';
  useEffect(() => {
    if (showModal && managerStoreId) void loadZoneTeam(managerStoreId);
  }, [showModal, managerStoreId]);

  useEffect(() => {
    if (!showModal || tab !== 'inventory' || !editing || !canManageInventoryPolicy) return;
    setInventoryPolicyLoading(true);
    inventoryApi.getSettings(editing.id)
      .then(response => {
        const settings = response.data.data || {};
        setInventoryPolicy({
          inventoryTracking: Boolean(settings.inventoryTracking),
          autoOutOfStock: settings.autoOutOfStock !== false,
          lowStockThreshold: settings.lowStockThreshold == null ? '' : String(settings.lowStockThreshold),
        });
      })
      .catch(() => window.alert('Could not load inventory policy'))
      .finally(() => setInventoryPolicyLoading(false));
  }, [showModal, tab, editing?.id, canManageInventoryPolicy]);


  const loadZonesForStore = async (storeId: string) => {
    try {
      const r = await zonesApi.getAll(storeId);
      const zs = r.data.data || [];
      setZones(zs);
      setSelectedZoneId(zs[0]?.id || '');
    } catch {
      setZones([]);
    }
  };

  const loadZoneTeam = async (storeId: string) => {
    if (!storeId) { setZoneTeam([]); setZoneTeamLoading(false); return; }
    setZoneTeamLoading(true);
    try {
      const r = await teamApi.getStoreTeam(storeId);
      setZoneTeam(r.data.data || []);
    } catch {
      setZoneTeam([]);
    } finally {
      setZoneTeamLoading(false);
    }
  };

  const openEditMember = (member: any) => {
    setEditingMember(member);
    setMemberForm({
      name: member.name || '',
      email: member.email || '',
      phone: member.phone || '',
      role: member.role || 'staff',
      isActive: member.isActive !== false,
    });
  };

  const saveMember = async () => {
    if (!editingMember) return;
    if (!managerStoreId) {
      window.alert('Select a store before updating a staff member');
      return;
    }
    setSavingMember(true);
    try {
      const assignmentChanged = memberForm.role !== editingMember.role
        || memberForm.isActive !== (editingMember.assignmentActive !== false);
      if (assignmentChanged) {
        await teamApi.updateMember(managerStoreId, editingMember.adminId, {
          role: memberForm.role,
          isActive: memberForm.isActive,
        });
      }

      const payload: any = {
        name: memberForm.name.trim() || null,
        email: memberForm.email.trim() || null,
        phone: memberForm.phone.trim() || null,
      };
      const profileChanged = payload.name !== (editingMember.name || null)
        || payload.email !== (editingMember.email || null)
        || payload.phone !== (editingMember.phone || null);
      if (profileChanged) await usersApi.update(editingMember.adminId, payload);
      setEditingMember(null);
      await Promise.all([load(), loadZoneTeam(managerStoreId)]);
    } catch (e: any) {
      window.alert(e?.response?.data?.error || 'Failed to update staff member');
    } finally {
      setSavingMember(false);
    }
  };

  const getStoreManager = (storeId: string) => {
    const team = teamByStore[storeId] || [];
    return team.find((u: any) => u.role === 'store_owner') || team.find((u: any) => u.role === 'store_manager') || team[0] || null;
  };

  // Manager state
  const [managerSearch, setManagerSearch] = useState('');
  const [managerResults, setManagerResults] = useState<any[]>([]);
  const [selectedManager, setSelectedManager] = useState<any | null>(null);
  const [newManager, setNewManager] = useState({ username: '', password: '', name: '', phone: '' });
  const [managerMode, setManagerMode] = useState<'search' | 'create'>('search');
  const [searchingManager, setSearchingManager] = useState(false);

  const searchManagers = async (q: string) => {
    if (!q.trim()) { setManagerResults([]); return; }
    setSearchingManager(true);
    try {
      const r = await usersApi.getAll();
      const all = r.data.data || [];
      const query = q.trim().toLowerCase();
      const phoneQuery = query.replace(/\D/g, '');
      setManagerResults(all.filter((u: any) =>
        String(u.id || '').toLowerCase().includes(query)
        || String(u.username || '').toLowerCase().includes(query)
        || String(u.name || '').toLowerCase().includes(query)
        || (phoneQuery.length > 0 && String(u.phone || '').replace(/\D/g, '').includes(phoneQuery))
        || String(u.email || '').toLowerCase().includes(query)
      ));
    } catch {} finally { setSearchingManager(false); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', address: '', ownerName: '', supportPhone: '', logoUrl: '', monthlyFee: '0', openingHours: DEFAULT_HOURS });
    setManagerSearch(''); setManagerResults([]); setSelectedManager(null);
    setNewManager({ username: '', password: '', name: '', phone: '' });
    setManagerMode('search'); setCreatedStoreId(null);
    setTab('details'); setShowModal(true);
    setZones([]); setSelectedZoneId(''); setZoneTeam([]);
  };

  const openEdit = (s: MartStore) => {
    setEditing(s);
    setForm({
      name: s.name, address: s.address || '', ownerName: s.ownerName || '',
      supportPhone: s.supportPhone || '',
      logoUrl: s.logoUrl || '', monthlyFee: String(s.monthlyFee || 0),
      openingHours: s.openingHours || DEFAULT_HOURS,
    });
    setTab('details'); setShowModal(true);
    setZones([]); setSelectedZoneId(''); setZoneTeam([]);
    loadZonesForStore(s.id);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const res = await productsApi.uploadPhoto(file);
      setForm(f => ({ ...f, logoUrl: res.data.data.url }));
    } catch {       window.alert('Upload failed'); } finally { setUploading(false); }
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
        monthlyFee: parseFloat(form.monthlyFee) || 0,
      };
      if (editing) await storesApi.update(editing.id, data);
      else {
        const res = await storesApi.create(data);
        setCreatedStoreId(res.data.data.id);
        setTab('manager');
        setSaving(false);
        loadZonesForStore(res.data.data.id);
        return;
      }
      setShowModal(false); await load();
    } catch { window.alert('Failed to save store'); } finally { setSaving(false); }
  };

  const saveInventoryPolicy = async () => {
    if (!editing) return;
    const lowStockThreshold = Number(inventoryPolicy.lowStockThreshold || 0);
    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      window.alert('Low-stock threshold must be a non-negative number');
      return;
    }
    setSavingInventoryPolicy(true);
    try {
      await inventoryApi.updateSettings({
        inventoryTracking: inventoryPolicy.inventoryTracking,
        autoOutOfStock: inventoryPolicy.autoOutOfStock,
        lowStockThreshold,
      }, editing.id);
      await load();
      setShowModal(false);
    } catch (error: any) {
      window.alert(error?.response?.data?.error || 'Could not save inventory policy');
    } finally {
      setSavingInventoryPolicy(false);
    }
  };

  const toggleLive = async (s: MartStore) => {
    try {
      await storesApi.update(s.id, { isLive: !s.isLive } as any);
      await load();
    } catch (e: any) {
      window.alert(e?.response?.data?.error || 'Failed to update store status');
    }
  };

  const handleDeactivate = async (storeId: string) => {
    await teamApi.deactivateStore(storeId);
    await load();
  };


  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Store</button>
      </div>

      <div className="space-y-3">
        {stores.length === 0 ? (
          <div className="page-card text-center py-12 text-gray-500 dark:text-slate-400">
            <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No stores yet.</p>
          </div>
        ) : stores.map(s => {
          const mgr = getStoreManager(s.id);
          return (
            <div key={s.id} className={"bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm " + (s.isActive ? 'border-gray-100 dark:border-slate-700' : 'border-gray-100 dark:border-slate-700 opacity-60')}>
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                  <SmartImage
                    src={s.logoUrl}
                    alt={s.name}
                    className="h-full w-full"
                    imgClassName="object-cover"
                    fallback={<Store className="w-5 h-5 text-emerald-600" />}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{s.name}</p>
                    <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded-full " + (s.isLive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                      {s.isLive ? '🟢 Live' : '🟡 Setup'}
                    </span>
                    {!s.isActive && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Subscription plan: ₹{s.monthlyFee}/month
                  </p>
                </div>
              </div>

              {/* Info row */}
              <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1">
                {s.ownerName && <p className="text-xs text-gray-500 dark:text-slate-400">👤 {s.ownerName}</p>}
                {s.address && <p className="text-xs text-gray-500 dark:text-slate-400">📍 {s.address}</p>}
                {s.supportPhone && <p className="text-xs text-gray-500 dark:text-slate-400">📞 {s.supportPhone}</p>}
                {mgr
                  ? <p className="text-xs text-indigo-500 dark:text-indigo-400 font-medium">🔑 @{mgr.username}</p>
                  : <p className="text-xs text-amber-500">⚠️ No manager assigned</p>
                }
              </div>

              {/* Action row */}
              <div className="flex border-t border-gray-50 dark:border-slate-700 divide-x divide-gray-50 dark:divide-slate-700">
                <button onClick={() => openEdit(s)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button type="button" onClick={() => toggleLive(s)}
                  title={s.isLive ? 'Store is live. Click to take it offline.' : 'Store is offline. Click to make it live.'}
                  aria-label={s.isLive ? 'Take store offline' : 'Make store live'}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                  <span>Live</span>
                  <span className={'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ' + (s.isLive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}>
                    <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (s.isLive ? 'translate-x-4' : 'translate-x-0')} />
                  </span>
                </button>
                {s.isActive ? (
                  <button onClick={() => setConfirmDeactivate(s)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <X className="w-3.5 h-3.5" /> Deactivate
                  </button>
                ) : (
                  <button onClick={async () => { await storesApi.update(s.id, { isActive: true } as any); await load(); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                    <CheckCircle className="w-3.5 h-3.5" /> Activate
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {/* Deactivate confirm */}
      {confirmDeactivate && (
        <ConfirmDialog
          title="Deactivate Store"
          message={`Deactivate ${confirmDeactivate.name}? All team members will lose access. Delivery staff will only lose access to this store.`}
          confirmLabel="Deactivate"
          onConfirm={() => { handleDeactivate(confirmDeactivate.id); setConfirmDeactivate(null); }}
          onCancel={() => setConfirmDeactivate(null)}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">{editing ? 'Edit Store' : 'Add Store'}</h2>
                {editing && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{editing.name}</p>}
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 transition-colors">
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 dark:border-slate-700 flex-shrink-0 px-1">
              {([['details', 'Details', Store], ['revenue', 'Plan', CheckCircle], ['manager', 'Staff', User]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-[11px] font-semibold transition-colors border-b-2 ${
                    tab === id
                      ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}>
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
              {editing && canManageInventoryPolicy && (
                <button onClick={() => setTab('inventory')}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-[11px] font-semibold transition-colors border-b-2 ${
                    tab === 'inventory'
                      ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}>
                  <SlidersHorizontal className="w-4 h-4" />
                  Inventory
                </button>
              )}
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* ── Details tab ── */}
              {tab === 'details' && (
                <>
                  {/* Logo upload */}
                  <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-2xl">
                    <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-700 border-2 border-dashed border-gray-200 dark:border-slate-600 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm">
                      {form.logoUrl
                        ? <img src={form.logoUrl} alt="" className="w-full h-full object-cover" />
                        : <Store className="w-7 h-7 text-gray-300 dark:text-slate-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Store Logo</p>
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl cursor-pointer transition-colors shadow-sm">
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {uploading ? 'Uploading...' : 'Upload Logo'}
                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                      </label>
                      {form.logoUrl && (
                        <button onClick={() => setForm(f => ({ ...f, logoUrl: '' }))} className="ml-2 text-xs text-red-400 hover:text-red-500">Remove</button>
                      )}
                    </div>
                  </div>

                  {/* Store name */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Store Name *</label>
                    <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Gobra Fresh" autoFocus />
                  </div>

                  {/* Owner + Phone in grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Owner Name</label>
                      <input type="text" value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} className={inp} placeholder="e.g. Arman Ali" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Support Phone</label>
                      <input type="tel" value={form.supportPhone} onChange={e => setForm(f => ({ ...f, supportPhone: e.target.value }))} className={inp} placeholder="+91 XXXXX" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Area / Address</label>
                    <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inp} placeholder="e.g. Gobra, Kolkata" />
                  </div>
                </>
              )}

              {/* ── Revenue tab ── */}
              {tab === 'revenue' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 dark:bg-emerald-900/20">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Monthly subscription</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Gokez Mart charges the merchant a fixed platform fee. Customer order payments remain with the merchant.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Monthly Fee (₹)</label>
                    <input type="number" value={form.monthlyFee} onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))} className={inp} placeholder="0" min="0" />
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 dark:text-blue-400">This plan does not create a payout, settlement or commission arrangement for customer orders.</p>
                  </div>
                </div>
              )}

              {tab === 'inventory' && editing && canManageInventoryPolicy && (
                inventoryPolicyLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-gray-500 dark:text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading inventory policy...</div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Inventory policy</p>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">These settings apply only to {editing.name}.</p>
                    </div>
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">
                      <span>Track inventory</span>
                      <button type="button" role="switch" aria-checked={inventoryPolicy.inventoryTracking} onClick={() => setInventoryPolicy(policy => ({ ...policy, inventoryTracking: !policy.inventoryTracking }))} className={'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ' + (inventoryPolicy.inventoryTracking ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (inventoryPolicy.inventoryTracking ? 'translate-x-4' : 'translate-x-0')} /></button>
                    </label>
                    <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 p-3 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">
                      <span>Auto mark out of stock at zero</span>
                      <button type="button" role="switch" aria-checked={inventoryPolicy.autoOutOfStock} onClick={() => setInventoryPolicy(policy => ({ ...policy, autoOutOfStock: !policy.autoOutOfStock }))} className={'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ' + (inventoryPolicy.autoOutOfStock ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (inventoryPolicy.autoOutOfStock ? 'translate-x-4' : 'translate-x-0')} /></button>
                    </label>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-200">Low-stock threshold<input type="number" min="0" value={inventoryPolicy.lowStockThreshold} onChange={event => setInventoryPolicy(policy => ({ ...policy, lowStockThreshold: event.target.value }))} className={`${inp} mt-2`} /></label>
                  </div>
                )
              )}

              {/* ── Manager tab ── */}
              {tab === 'manager' && (
                <div className="space-y-4">
                  {zones.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-700 dark:text-slate-300">Mapped zone</label>
                      <select value={selectedZoneId} onChange={e => setSelectedZoneId(e.target.value)} className={inp}>
                        {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}{z.primaryStoreId === managerStoreId ? ' (head store)' : ''}</option>)}
                      </select>
                    </div>
                  )}
                  {managerStoreId && zoneTeamLoading && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading mapped staff...
                    </div>
                  )}
                  {managerStoreId && zoneTeam.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">Mapped staff</p>
                      <div className="divide-y divide-gray-100 dark:divide-slate-700 rounded-xl border border-gray-100 dark:border-slate-700 overflow-hidden">
                        {zoneTeam.map((member: any) => (
                          <div key={member.adminId} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 dark:text-white">{member.name || member.username}</p>
                              <p className="text-[10px] text-gray-500 dark:text-slate-400">@{member.username} · {String(member.role).replace(/_/g, ' ')}{member.assignmentActive === false ? ' · inactive' : ''}</p>
                            </div>
                            <button onClick={() => openEditMember(member)}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
                              Edit details
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {createdStoreId && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Store created! Now assign a store owner.</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input type="text" value={managerSearch}
                          onChange={e => { setManagerMode('search'); setManagerSearch(e.target.value); searchManagers(e.target.value); }}
                          className={`${inp} pl-9`} placeholder="Search ID, name, phone or email" />
                      </div>
                      <button type="button" onClick={() => { setManagerMode('create'); setSelectedManager(null); setManagerResults([]); }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
                        <UserPlus className="w-3.5 h-3.5" /> Add new member
                      </button>
                    </div>
                    {managerMode === 'search' && searchingManager && <p className="text-xs text-gray-500 text-center">Searching...</p>}
                    {managerMode === 'search' && managerResults.length > 0 && (
                      <div className="border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">
                        {managerResults.map((u: any) => (
                          <button key={u.id} onClick={() => setSelectedManager(u)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors ${selectedManager?.id === u.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-emerald-600">{(u.name || u.username)[0].toUpperCase()}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 dark:text-white">{u.name || u.username}</p>
                              <p className="text-[10px] text-gray-500 dark:text-slate-400">@{u.username} · {u.role?.replace('_', ' ')}</p>
                            </div>
                            {selectedManager?.id === u.id && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {managerMode === 'search' && selectedManager && (
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                        <p className="text-xs text-emerald-700 dark:text-emerald-400"><strong>{selectedManager.name || selectedManager.username}</strong> will be assigned as store owner</p>
                      </div>
                    )}
                  </div>

                  {managerMode === 'create' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Full Name</label>
                          <input type="text" value={newManager.name} onChange={e => setNewManager(m => ({ ...m, name: e.target.value }))} className={inp} placeholder="Manager name" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Phone</label>
                          <input type="tel" value={newManager.phone} onChange={e => setNewManager(m => ({ ...m, phone: e.target.value }))} className={inp} placeholder="+91 XXXXX" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Username *</label>
                        <input type="text" value={newManager.username} onChange={e => setNewManager(m => ({ ...m, username: e.target.value }))} className={inp} placeholder="e.g. gobra_manager" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Password *</label>
                        <input type="password" value={newManager.password} onChange={e => setNewManager(m => ({ ...m, password: e.target.value }))} className={inp} placeholder="Min 6 characters" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              {tab === 'manager' ? (
                <button
                  disabled={saving || (managerMode === 'search' && !selectedManager) || (managerMode === 'create' && (!newManager.username || !newManager.password))}
                  onClick={async () => {
                    const storeId = managerStoreId;
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
                      window.alert(e?.response?.data?.error || 'Failed to assign manager');
                    } finally { setSaving(false); }
                  }}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : '✅ Assign & Finish'}
                </button>
              ) : tab === 'inventory' ? (
                <button onClick={saveInventoryPolicy} disabled={savingInventoryPolicy || inventoryPolicyLoading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {savingInventoryPolicy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save inventory policy'}
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : tab === 'details' ? 'Save & Next →' : 'Save'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    {editingMember && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Edit Staff — {editingMember.username}</h2>
            <button onClick={() => setEditingMember(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Full Name</label>
              <input type="text" value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Email</label>
              <input type="email" value={memberForm.email} onChange={e => setMemberForm(f => ({ ...f, email: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Phone</label>
              <input type="tel" value={memberForm.phone} onChange={e => setMemberForm(f => ({ ...f, phone: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Role</label>
              <select value={memberForm.role} onChange={e => setMemberForm(f => ({ ...f, role: e.target.value }))} className={inp}>
                <option value="store_owner">Store Owner</option>
                <option value="store_manager">Store Manager</option>
                <option value="staff">Staff</option>
                <option value="delivery_staff">Delivery Staff</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-slate-300">Active</label>
              <button type="button" onClick={() => setMemberForm(f => ({ ...f, isActive: !f.isActive }))}
                className={'relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors ' + (memberForm.isActive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}>
                <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (memberForm.isActive ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => setEditingMember(null)} className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300">
              Cancel
            </button>
            <button onClick={saveMember} disabled={savingMember}
              className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
              {savingMember ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
