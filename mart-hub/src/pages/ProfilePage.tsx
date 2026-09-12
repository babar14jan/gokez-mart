import { useEffect, useState } from 'react';
import { Loader2, Save, User, Mail, Phone, Shield, Clock } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';

const inp = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 text-gray-900 dark:text-white placeholder:text-gray-400 transition-all';

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin:    { label: 'Super Admin',    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  store_owner:    { label: 'Store Owner',    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  store_manager:  { label: 'Store Manager',  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  sales_manager:  { label: 'Sales Manager',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  delivery_staff: { label: 'Delivery Staff', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  staff:          { label: 'Staff',          color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400' },
};

export default function ProfilePage() {
  const { name, username, email, phone, role, setProfile } = useAuthStore();
  const [form, setForm] = useState({ name: name || '', email: email || '', phone: phone || '' });
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/me').then(r => {
      const d = r.data.data;
      setForm({ name: d.name || '', email: d.email || '', phone: d.phone || '' });
      setLastLogin(d.last_login_at);
      setCreatedAt(d.created_at);
    }).catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      await api.put('/admin/profile', { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null });
      setProfile({ name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update profile');
    } finally { setSaving(false); }
  };

  const roleInfo = ROLE_LABELS[role || 'super_admin'] || ROLE_LABELS.staff;

  const formatDate = (d: string | null) => d
    ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never';

  return (
    <div className="space-y-4 max-w-2xl">

      {/* Profile summary card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-bold text-white">
            {(form.name || username || 'A').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-gray-900 dark:text-white">{form.name || username}</p>
          <p className="text-xs text-gray-400 mt-0.5">@{username}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
            {lastLogin && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-slate-500">
                <Clock className="w-3 h-3" /> Last login: {formatDate(lastLogin)}
              </span>
            )}
            {createdAt && (
              <span className="text-[10px] text-gray-400 dark:text-slate-500">
                Member since {new Date(createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="page-card">
        <div className="page-card-header">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400 dark:text-slate-500" />
            <p className="page-card-title">Profile Details</p>
          </div>
        </div>
        <form onSubmit={handleSave} className="p-4 space-y-4">
          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-3 py-2.5 rounded-xl">{error}</div>}
          {saved && <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm px-3 py-2.5 rounded-xl">Profile updated successfully ✓</div>}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" /> Display Name *
              </label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={inp} placeholder="Your full name" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" /> Username
              </label>
              <input type="text" value={username || ''} disabled
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed" />
              <p className="text-[10px] text-gray-400 mt-1">Cannot be changed.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" /> Email
              </label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className={inp} placeholder="your@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" /> Mobile Number
              </label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inp} placeholder="+91 XXXXX XXXXX" />
            </div>
          </div>

          {/* Role — read only for now, future: role management */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" /> Role
            </label>
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${roleInfo.color}`}>{roleInfo.label}</span>
            </div>
          </div>

          <button type="submit" disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Profile</>}
          </button>
        </form>
      </div>
    </div>
  );
}
