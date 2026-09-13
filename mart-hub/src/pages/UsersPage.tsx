import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, Users, Eye, EyeOff, Filter } from 'lucide-react';
import { usersApi, storesApi, teamApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import ConfirmDialog from '../components/ConfirmDialog';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const ROLES = [
  { value: 'super_admin',    label: 'Super Admin',    desc: 'Full access to all stores' },
  { value: 'store_owner',    label: 'Store Owner',    desc: 'Full store — orders, products, settings, analytics' },
  { value: 'store_manager',  label: 'Store Manager',  desc: 'Day-to-day ops — orders, products, customers, analytics' },
  { value: 'sales_manager',  label: 'Sales Manager',  desc: 'Orders, products, customers' },
  { value: 'staff',          label: 'Staff',          desc: 'Orders, packing, inventory, delivery' },
  { value: 'delivery_staff', label: 'Delivery Staff', desc: 'Dispatch and deliver orders only' },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  store_owner:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  store_manager:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  sales_manager:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  delivery_staff: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  staff:          'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
};

const EMPTY_FORM = { username: '', password: '', name: '', email: '', phone: '', role: 'store_owner', storeId: '' };

interface AdminUser {
  id: string; username: string; name: string | null; email: string | null;
  phone: string | null; role: string; storeId: string | null; lastLoginAt: string | null; createdAt: string;
}

export default function UsersPage() {
  const { id: currentUserId } = useAuthStore() as any;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [userStores, setUserStores] = useState<Record<string, any[]>>({});
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPw, setShowPw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [confirmRemoveStore, setConfirmRemoveStore] = useState<{ userId: string; storeId: string; storeName: string } | null>(null);

  const load = async () => {
    const [ur, sr] = await Promise.all([usersApi.getAll(), storesApi.getAll()]);
    const allUsers = ur.data.data || [];
    const allStores = sr.data.data || [];
    setUsers(allUsers);
    setStores(allStores);
    // Load store assignments for delivery_staff users
    const deliveryUsers = allUsers.filter((u: AdminUser) => u.role === 'delivery_staff');
    const storeMap: Record<string, any[]> = {};
    await Promise.all(deliveryUsers.map(async (u: AdminUser) => {
      try {
        const r = await teamApi.getUserStores(u.id);
        storeMap[u.id] = r.data.data || [];
      } catch {}
    }));
    setUserStores(storeMap);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, storeId: stores[0]?.id || '' });
    setShowPw(false); setShowModal(true);
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setForm({ username: u.username, password: '', name: u.name || '', email: u.email || '', phone: u.phone || '', role: u.role, storeId: u.storeId || '' });
    setShowPw(false); setShowModal(true);
  };

  const handleSave = async () => {
    if (!editing && (!form.username.trim() || !form.password)) return;
    setSaving(true);
    try {
      if (editing) {
        const payload: any = { name: form.name, email: form.email, phone: form.phone, role: form.role, storeId: form.role === 'super_admin' ? null : form.storeId };
        if (form.password) payload.password = form.password;
        await usersApi.update(editing.id, payload);
      } else {
        await usersApi.create({ ...form, storeId: form.role === 'super_admin' ? undefined : form.storeId });
      }
      setShowModal(false); await load();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save user');
    } finally { setSaving(false); }
  };

  const handleDelete = async (u: AdminUser) => {
    await usersApi.delete(u.id);
    setConfirmDelete(null); await load();
  };

  const handleRemoveFromStore = async () => {
    if (!confirmRemoveStore) return;
    await teamApi.removeMember(confirmRemoveStore.storeId, confirmRemoveStore.userId);
    setConfirmRemoveStore(null); await load();
  };

  const filteredUsers = storeFilter === 'all'
    ? users
    : users.filter(u => u.storeId === storeFilter || (userStores[u.id] || []).some((s: any) => s.id === storeFilter));

  const storeName = (id: string | null) => stores.find(s => s.id === id)?.name || '—';

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Store filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            className="text-xs border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500">
            <option value="all">All Stores ({users.length})</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({users.filter(u => u.storeId === s.id || (userStores[u.id] || []).some((us: any) => us.id === s.id)).length})</option>
            ))}
          </select>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>
      </div>

      <div className="page-card">
        {/* Desktop header */}
        <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          <div className="col-span-3">User</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-2">Store</div>
          <div className="col-span-3">Contact</div>
          <div className="col-span-1">Last Login</div>
          <div className="col-span-1"></div>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-slate-500">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No users yet.</p>
          </div>
        ) : filteredUsers.map(u => (
          <div key={u.id} className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 items-center">
            {/* Mobile */}
            <div className="sm:hidden flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{u.name || u.username}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[u.role] || ROLE_COLORS.staff}`}>{u.role.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500">@{u.username} · {storeName(u.storeId)}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><Pencil className="w-4 h-4" /></button>
                {u.id !== currentUserId && <button onClick={() => setConfirmDelete(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
            {/* Desktop */}
            <div className="hidden sm:block col-span-3">
              <p className="text-xs font-semibold text-gray-900 dark:text-white">{u.name || u.username}</p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">@{u.username}</p>
            </div>
            <div className="hidden sm:block col-span-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[u.role] || ROLE_COLORS.staff}`}>{u.role.replace(/_/g, ' ')}</span>
            </div>
            <div className="hidden sm:block col-span-2">
              {u.role === 'delivery_staff' && userStores[u.id]?.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {userStores[u.id].map((s: any) => (
                    <div key={s.id} className="flex items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-400 line-through'}`}>{s.name}</span>
                      <button onClick={() => setConfirmRemoveStore({ userId: u.id, storeId: s.id, storeName: s.name })}
                        className="text-gray-300 hover:text-red-400 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-gray-600 dark:text-slate-400">{storeName(u.storeId)}</span>
              )}
            </div>
            <div className="hidden sm:block col-span-3 text-xs text-gray-500 dark:text-slate-400">{u.phone || u.email || '—'}</div>
            <div className="hidden sm:block col-span-1 text-[10px] text-gray-400 dark:text-slate-500">
              {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Never'}
            </div>
            <div className="hidden sm:flex col-span-1 justify-end gap-1">
              <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><Pencil className="w-4 h-4" /></button>
              {u.id !== currentUserId && <button onClick={() => setConfirmDelete(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              {!editing && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Username *</label>
                  <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') }))} className={inp} placeholder="e.g. john_store" autoFocus />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">{editing ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={`${inp} pr-10`} placeholder={editing ? 'Leave blank to keep current' : 'Min 6 characters'} />
                  <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Full Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. John Doe" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inp} placeholder="9876543210" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inp} placeholder="john@example.com" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Role *</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inp}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>
              {form.role !== 'super_admin' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Assigned Store *</label>
                  <select value={form.storeId} onChange={e => setForm(f => ({ ...f, storeId: e.target.value }))} className={inp}>
                    <option value="">Select store...</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
              <button onClick={handleSave} disabled={saving || (!editing && (!form.username || !form.password)) || (form.role !== 'super_admin' && !form.storeId)}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : editing ? 'Update User' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove from store confirm */}
      {confirmRemoveStore && (
        <ConfirmDialog
          title="Remove from Store"
          message={`Remove this user from ${confirmRemoveStore.storeName}? They will lose access to that store.`}
          confirmLabel="Remove"
          onConfirm={handleRemoveFromStore}
          onCancel={() => setConfirmRemoveStore(null)}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Delete {confirmDelete.name || confirmDelete.username}?</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl hover:bg-gray-100">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
