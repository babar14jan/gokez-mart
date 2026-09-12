import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  KeyRound, Settings, LayoutDashboard, Tag, Users,
  BarChart3, Shield, ChevronRight, Moon, Sun,
  Pencil, X, Loader2, Save, Mail, Phone, Store, Package,
  Bell, Download,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { api } from '../services/api';
import { subscribeAdminToPush } from '../services/push';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin:    { label: 'Super Admin',    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  store_owner:    { label: 'Store Owner',    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  store_manager:  { label: 'Store Manager',  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  sales_manager:  { label: 'Sales Manager',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  delivery_staff: { label: 'Delivery Staff', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  staff:          { label: 'Staff',          color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400' },
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={checked}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

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

  // Push notifications
  const [notifPermission, setNotifPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default');
  const [enablingNotif, setEnablingNotif] = useState(false);

  // PWA install
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    api.get('/admin/me').then(r => {
      const d = r.data.data;
      setForm({ name: d.name || '', email: d.email || '', phone: d.phone || '' });
    }).catch(() => {});

    // Check notification permission
    if (!('Notification' in window)) {
      setNotifPermission('unsupported');
    } else {
      setNotifPermission(Notification.permission as any);
    }

    // PWA install prompt
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    if (window.matchMedia('(display-mode: standalone)').matches) setIsInstalled(true);
    return () => window.removeEventListener('beforeinstallprompt', handler);
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

  const handleEnableNotifications = async () => {
    setEnablingNotif(true);
    try {
      const ok = await subscribeAdminToPush();
      setNotifPermission(ok ? 'granted' : 'denied');
    } finally { setEnablingNotif(false); }
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { setIsInstalled(true); setInstallPrompt(null); }
  };

  const [confirmLogout, setConfirmLogout] = useState(false);
  const handleLogout = () => { logout(); navigate('/login'); };

  const roleInfo = ROLE_LABELS[role || 'staff'] || ROLE_LABELS.staff;

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
      { label: 'Settings',        href: '/settings',  icon: Settings },
    ],
    sales_manager: [
      { label: 'Analytics',       href: '/analytics', icon: BarChart3 },
      { label: 'Customers',       href: '/customers', icon: Users },
      { label: 'Product Catalog', href: '/catalog',   icon: Package },
      { label: 'Settings',        href: '/settings',  icon: Settings },
    ],
    delivery_staff: [],
    staff: [],
  };

  const extraLinks = roleLinks[role || 'staff'] || [];

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-6">

      {/* Profile card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-lg font-bold flex items-center justify-center flex-shrink-0">
            {displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{form.name || displayName}</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-1">@{username}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
              <Pencil className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

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

        {/* Dark mode */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
          {isDark ? <Moon className="w-4 h-4 text-gray-400" /> : <Sun className="w-4 h-4 text-gray-400" />}
          <span className="text-sm text-gray-700 dark:text-slate-300 flex-1">Dark Mode</span>
          <Toggle checked={isDark} onChange={toggle} />
        </div>

        {/* Push notifications */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
          <Bell className="w-4 h-4 text-violet-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-gray-700 dark:text-slate-300">Order Notifications</span>
            <p className="text-[10px] text-gray-400 dark:text-slate-500">
              {notifPermission === 'granted' ? 'Enabled — get alerts for new orders' :
               notifPermission === 'denied'  ? 'Blocked — enable in browser settings' :
               notifPermission === 'unsupported' ? 'Not supported on this browser' :
               'Get notified when new orders arrive'}
            </p>
          </div>
          {notifPermission === 'denied' ? (
            <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
          ) : notifPermission === 'unsupported' ? (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
          ) : notifPermission === 'granted' ? (
            <Toggle checked={true} onChange={() => {}} />
          ) : (
            <button onClick={handleEnableNotifications} disabled={enablingNotif}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
              {enablingNotif ? 'Enabling...' : 'Enable'}
            </button>
          )}
        </div>

        {/* Install PWA */}
        {!isInstalled && installPrompt && (
          <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
            <Download className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-700 dark:text-slate-300">Install Gokez Hub</span>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">Add to home screen for quick access</p>
            </div>
            <button onClick={handleInstall}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
              Install
            </button>
          </div>
        )}
      </div>

      {/* Sign out */}
      <div className="flex justify-center">
        <button onClick={() => setConfirmLogout(true)}
          className="text-sm font-medium text-red-500 hover:text-red-600 px-4 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-1.5 pb-2">
        <div className="flex items-center gap-3">
          <a href="https://hub.gokez.com/hub" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            About Gokez Hub
          </a>
          <span className="text-gray-300 dark:text-slate-600 text-[10px]">·</span>
          <a href="mailto:support@gokez.com"
            className="text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            Support
          </a>
        </div>
        <span className="text-[10px] text-gray-300 dark:text-slate-600">
          &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
        </span>
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
