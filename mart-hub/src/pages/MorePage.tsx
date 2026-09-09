import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  KeyRound, Settings, LayoutDashboard, Tag, Users,
  BarChart3, Shield, LogOut, ChevronRight, Moon, Sun,
  Pencil, X, Loader2, Save, Mail, Phone, Store, Package,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { api } from '../services/api';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', store_owner: 'Store Owner', store_manager: 'Store Manager',
  sales_manager: 'Sales Manager', delivery_staff: 'Delivery Staff', staff: 'Staff',
};

export default function MorePage() {
  const { username, name, email, phone, role, logout, setProfile } = useAuthStore();
  const { isDark, toggle } = useThemeStore();
  const navigate = useNavigate();
  const displayName = name || username || 'Admin';

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: name || '', email: email || '', phone: phone || '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/me').then(r => {
      const d = r.data.data;
      setForm({ name: d.name || '', email: d.email || '', phone: d.phone || '' });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      await api.put('/admin/profile', { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null });
      setProfile({ name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null });
      setSaved(true); setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update');
    } finally { setSaving(false); }
  };

  const handleCancel = () => {
    setForm({ name: name || '', email: email || '', phone: phone || '' });
    setError(''); setEditing(false);
  };

  const [confirmLogout, setConfirmLogout] = useState(false);
  const handleLogout = () => { logout(); navigate('/login'); };

  const roleLinks: Record<string, { label: string; href: string; icon: React.ElementType }[]> = {
    super_admin: [
      { label: 'Analytics',          href: '/analytics',          icon: BarChart3 },
      { label: 'Customers',          href: '/customers',          icon: Users },
      { label: 'Categories',         href: '/categories',         icon: Tag },
      { label: 'Product Catalog',    href: '/catalog',            icon: Package },
      { label: 'Store Applications', href: '/store-applications', icon: Store },
      { label: 'Stores',             href: '/stores',             icon: LayoutDashboard },
      { label: 'Users',              href: '/users',              icon: Users },
      { label: 'Compliance',         href: '/compliance',         icon: Shield },
      { label: 'Settings',           href: '/settings',           icon: Settings },
    ],
    store_owner: [
      { label: 'My Team',         href: '/team',      icon: Users },
      { label: 'Analytics',       href: '/analytics', icon: BarChart3 },
      { label: 'Customers',       href: '/customers', icon: Users },
      { label: 'Product Catalog', href: '/catalog',   icon: Package },
      { label: 'Settings',        href: '/settings',  icon: Settings },
    ],
    store_manager: [
      { label: 'Analytics',       href: '/analytics', icon: BarChart3 },
      { label: 'Customers',       href: '/customers', icon: Users },
      { label: 'Product Catalog', href: '/catalog',   icon: Package },
    ],
    sales_manager: [
      { label: 'Product Catalog', href: '/catalog', icon: Package },
    ],
    delivery_staff: [],
    staff: [],
  };

  const extraLinks = roleLinks[role || 'staff'] || [];

  return (
    <div className="max-w-lg mx-auto space-y-4">

      {/* Profile card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-lg font-bold flex items-center justify-center flex-shrink-0">
            {displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{form.name || displayName}</p>
            <p className="text-xs text-gray-400">@{username} · {ROLE_LABELS[role || ''] || role}</p>
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
              <Pencil className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {/* Inline edit form */}
        {editing && (
          <div className="border-t border-gray-100 dark:border-slate-700 p-4 space-y-3">
            {error && <p className="text-xs text-red-500">{error}</p>}
            {saved && <p className="text-xs text-emerald-600">✓ Profile updated</p>}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="Your name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inp} placeholder="your@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inp} placeholder="+91 XXXXX XXXXX" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleCancel}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-gray-600 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 transition-colors">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Account */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">Account</p>
        <button onClick={() => navigate('/change-password')}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors border-t border-gray-50 dark:border-slate-700">
          <KeyRound className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-700 dark:text-slate-300 flex-1 text-left">Change Password</span>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </button>
      </div>

      {/* Role-specific links */}
      {extraLinks.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">Manage</p>
          {extraLinks.map(({ label, href, icon: Icon }) => (
            <button key={href} onClick={() => navigate(href)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors border-t border-gray-50 dark:border-slate-700">
              <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-slate-300 flex-1 text-left">{label}</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </button>
          ))}
        </div>
      )}

      {/* Preferences */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">Preferences</p>
        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
          {isDark ? <Moon className="w-4 h-4 text-gray-400" /> : <Sun className="w-4 h-4 text-gray-400" />}
          <span className="text-sm text-gray-700 dark:text-slate-300 flex-1">Dark Mode</span>
          <button onClick={toggle} role="switch" aria-checked={isDark}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${isDark ? 'bg-emerald-500' : 'bg-gray-200'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Sign out */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        <button onClick={() => setConfirmLogout(true)}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-semibold">Sign out</span>
        </button>
      </div>

      {confirmLogout && (
        <ConfirmDialog
          title="Sign out"
          message="Are you sure you want to sign out?"
          confirmLabel="Sign out"
          onConfirm={handleLogout}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
