import { useEffect, useState } from 'react';
import { Users, Plus, X, Loader2, Search, UserPlus, CheckCircle, Pencil, Store } from 'lucide-react';
import { teamApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import ConfirmDialog from '../components/ConfirmDialog';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const ROLE_OPTIONS = [
  { value: 'store_owner',    label: 'Store Owner',    desc: 'Full store control' },
  { value: 'store_manager',  label: 'Store Manager',  desc: 'Orders, products, customers' },
  { value: 'sales_manager',  label: 'Sales Manager',  desc: 'Orders and customers' },
  { value: 'staff',          label: 'Staff',          desc: 'Packing, inventory, delivery' },
  { value: 'delivery_staff', label: 'Delivery',       desc: 'Delivery only' },
];

const ROLE_COLORS: Record<string, string> = {
  store_owner:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  store_manager:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sales_manager:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  staff:          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delivery_staff: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
};

type ModalMode = 'search' | 'create';

export default function TeamPage() {
  const storeId = getActiveStoreId();
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState<ModalMode>('search');
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedRole, setSelectedRole] = useState('delivery_staff');
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<any | null>(null);

  const load = async () => {
    try { const r = await teamApi.getStoreTeam(storeId); setTeam(r.data.data || []); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handlePhoneSearch = async () => {
    if (!phone.trim()) return;
    setSearching(true); setFoundUser(null); setNotFound(false);
    try {
      const r = await teamApi.lookupByPhone(phone);
      setFoundUser(r.data.data);
      setSelectedRole(r.data.data.role === 'delivery_staff' ? 'delivery_staff' : 'staff');
    } catch { setNotFound(true); setMode('create'); setNewUser(u => ({ ...u, phone })); }
    finally { setSearching(false); }
  };

  const handleAdd = async () => {
    setSaving(true);
    try {
      if (foundUser) {
        await teamApi.addMember(storeId, { adminId: foundUser.id, role: selectedRole });
      } else {
        if (!newUser.username || !newUser.password) return;
        await teamApi.addMember(storeId, { ...newUser, role: selectedRole });
      }
      setShowModal(false); setPhone(''); setFoundUser(null); setNotFound(false);
      setNewUser({ username: '', password: '', name: '', phone: '', email: '' });
      await load();
    } catch (e: any) { alert(e?.response?.data?.error || 'Failed to add member'); }
    finally { setSaving(false); }
  };

  const handleUpdateRole = async (member: any, role: string) => {
    try { await teamApi.updateMember(storeId, member.adminId, { role }); await load(); }
    catch { alert('Failed to update role'); }
  };

  const handleToggleActive = async (member: any) => {
    try { await teamApi.updateMember(storeId, member.adminId, { isActive: !member.assignmentActive }); await load(); }
    catch { alert('Failed to update'); }
  };

  const handleRemove = async (member: any) => {
    try { await teamApi.removeMember(storeId, member.adminId); await load(); }
    catch { alert('Failed to remove'); }
    finally { setConfirmRemove(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-slate-500">{team.length} member{team.length !== 1 ? 's' : ''} in your store</p>
        <button onClick={() => { setShowModal(true); setMode('search'); setPhone(''); setFoundUser(null); setNotFound(false); }} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Member
        </button>
      </div>

      {/* Team list */}
      {team.length === 0 ? (
        <div className="page-card text-center py-12 text-gray-400 dark:text-slate-500">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No team members yet.</p>
          <p className="text-xs mt-1">Add your store manager, staff and delivery team.</p>
        </div>
      ) : (
        <div className="page-card overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {team.map(member => (
              <div key={member.adminId} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                  {(member.name || member.username || 'U')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{member.name || member.username}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_OPTIONS.find(r => r.value === member.role)?.label || member.role}
                    </span>
                    {!member.assignmentActive && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">@{member.username}{member.phone ? ` · ${member.phone}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Active toggle */}
                  <button onClick={() => handleToggleActive(member)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${member.assignmentActive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${member.assignmentActive ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  {/* Edit role */}
                  <button onClick={() => setEditingMember(member)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  {/* Remove */}
                  <button onClick={() => setConfirmRemove(member)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit role modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Change Role — {editingMember.name || editingMember.username}</h2>
            <div className="space-y-2">
              {ROLE_OPTIONS.filter(r => r.value !== 'store_owner').map(r => (
                <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${editingMember.role === r.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                  <input type="radio" name="editRole" value={r.value} checked={editingMember.role === r.value}
                    onChange={() => setEditingMember((m: any) => ({ ...m, role: r.value }))} className="accent-emerald-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.label}</p>
                    <p className="text-xs text-gray-400">{r.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setEditingMember(null)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={() => { handleUpdateRole(editingMember, editingMember.role); setEditingMember(null); }}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Add Team Member</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"><X className="w-4 h-4 text-gray-500" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <button onClick={() => { setMode('search'); setFoundUser(null); setNotFound(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl border-2 transition-all ${mode === 'search' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-100 dark:border-slate-700 text-gray-500'}`}>
                  <Search className="w-3.5 h-3.5" /> Find by Phone
                </button>
                <button onClick={() => setMode('create')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl border-2 transition-all ${mode === 'create' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-100 dark:border-slate-700 text-gray-500'}`}>
                  <UserPlus className="w-3.5 h-3.5" /> Create New
                </button>
              </div>

              {/* Search by phone */}
              {mode === 'search' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handlePhoneSearch()}
                      className={`${inp} flex-1`} placeholder="Enter phone number" autoFocus />
                    <button onClick={handlePhoneSearch} disabled={searching || !phone.trim()}
                      className="px-3 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50">
                      {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </button>
                  </div>

                  {foundUser && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{foundUser.name || foundUser.username}</p>
                        <p className="text-xs text-gray-400">@{foundUser.username}</p>
                        {foundUser.stores?.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <Store className="w-3 h-3 text-gray-400" />
                            {foundUser.stores.map((s: any) => (
                              <span key={s.id} className="text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 px-1.5 py-0.5 rounded-full">{s.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {notFound && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">No user found with this phone. Switch to "Create New" to add them.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Create new */}
              {mode === 'create' && (
                <div className="space-y-3">
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Full Name</label>
                    <input type="text" value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} className={inp} placeholder="Full name" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Phone</label>
                    <input type="tel" value={newUser.phone} onChange={e => setNewUser(u => ({ ...u, phone: e.target.value }))} className={inp} placeholder="+91 XXXXX XXXXX" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Username *</label>
                    <input type="text" value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} className={inp} placeholder="e.g. raju_delivery" /></div>
                  <div><label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Password *</label>
                    <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} className={inp} placeholder="Min 6 characters" /></div>
                </div>
              )}

              {/* Role selection */}
              {(foundUser || mode === 'create') && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Assign Role</label>
                  <div className="space-y-2">
                    {ROLE_OPTIONS.filter(r => r.value !== 'store_owner').map(r => (
                      <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedRole === r.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-100 dark:border-slate-700'}`}>
                        <input type="radio" name="role" value={r.value} checked={selectedRole === r.value}
                          onChange={() => setSelectedRole(r.value)} className="accent-emerald-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.label}</p>
                          <p className="text-xs text-gray-400">{r.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex gap-3 sticky bottom-0 bg-white dark:bg-slate-800">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 rounded-xl">Cancel</button>
              <button onClick={handleAdd}
                disabled={saving || (!foundUser && mode === 'search') || (mode === 'create' && (!newUser.username || !newUser.password))}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : 'Add to Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm remove */}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove from Store"
          message={`Remove ${confirmRemove.name || confirmRemove.username} from your store? They will lose access.`}
          confirmLabel="Remove"
          onConfirm={() => handleRemove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
