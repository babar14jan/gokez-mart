import { useState, useEffect } from 'react';
import { User, Phone, MapPin, Save, Loader2, Pencil, Plus, X, MessageCircle, Bell, Navigation } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useCustomerStore } from '../store/customerStore';
import { useThemeStore } from '../store/themeStore';
import {
  getNotificationPermission, requestNotificationPermission,
  subscribeToPush, unsubscribeFromPush, getLocationPermission,
} from '../services/push';

const inp = 'w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400';

interface AddressFields { flat: string; block: string; street: string; pincode: string; }

const EMPTY_ADDR: AddressFields = { flat: '', block: '', street: '', pincode: '' };

// Serialize structured fields → single string for storage
const serialize = (a: AddressFields) =>
  [a.flat, a.block, a.street, a.pincode].filter(Boolean).join(', ');

// Parse stored string back into fields (best-effort)
const parse = (s: string | null): AddressFields => {
  if (!s) return EMPTY_ADDR;
  const parts = s.split(',').map(p => p.trim());
  return {
    flat:    parts[0] || '',
    block:   parts[1] || '',
    street:  parts[2] || '',
    pincode: parts[3] || '',
  };
};

interface ProfilePageProps {
  onBack?: () => void;
  supportName?: string;
  supportPhone?: string;
  whatsappNumber?: string;
  onNavigate?: (view: string) => void;
}

function AddressCard({
  label, icon, stored, fieldKey, onSave, saving, saved,
}: {
  label: string; icon: 'primary' | 'secondary';
  stored: string | null; fieldKey: 'address' | 'address2';
  onSave: (key: 'address' | 'address2', val: string) => Promise<void>;
  saving: string | null; saved: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AddressFields>(parse(stored));
  const f = (k: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSave = async () => {
    await onSave(fieldKey, serialize(form));
    setEditing(false);
  };

  const cancel = () => { setForm(parse(stored)); setEditing(false); };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${icon === 'primary' ? 'text-emerald-500' : 'text-gray-400'}`} />
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">{label}</span>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            {stored ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 mt-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Flat / House No.</label>
              <input type="text" value={form.flat} onChange={f('flat')} className={inp} placeholder="e.g. A-204" autoFocus />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Block / Tower</label>
              <input type="text" value={form.block} onChange={f('block')} className={inp} placeholder="e.g. Block B" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-400 mb-1">Street / Area</label>
            <input type="text" value={form.street} onChange={f('street')} className={inp} placeholder="e.g. Kolkata" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-400 mb-1">Pincode</label>
            <input type="tel" inputMode="numeric" maxLength={6} value={form.pincode} onChange={f('pincode')} className={inp} placeholder="700102" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving === fieldKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50">
              {saving === fieldKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
            </button>
            <button onClick={cancel}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700 dark:text-slate-300">
          {stored || <span className="text-gray-400 italic text-xs">Tap + to add</span>}
        </p>
      )}
      {saved === fieldKey && <p className="text-xs text-emerald-600 mt-1">Saved ✓</p>}
    </div>
  );
}

export default function ProfilePage({ onBack, supportName, supportPhone, whatsappNumber }: ProfilePageProps) {
  const { name, phone, address, address2, updateProfile, logout } = useCustomerAuthStore();
  const { setName: syncName } = useCustomerStore();
  const { isDark, toggle } = useThemeStore();

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(name || '');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [locationPermission, setLocationPermission] = useState<string>('prompt');
  const [locationEnabled, setLocationEnabled] = useState(
    localStorage.getItem('mart_location_enabled') !== 'false'
  );

  useEffect(() => {
    getLocationPermission().then(setLocationPermission);
  }, []);

  const handleLocationToggle = async () => {
    if (!locationEnabled) {
      // Turning on — request if not yet granted
      if (locationPermission !== 'granted') {
        navigator.geolocation.getCurrentPosition(
          () => { setLocationPermission('granted'); setLocationEnabled(true); localStorage.setItem('mart_location_enabled', 'true'); },
          () => { setLocationPermission('denied'); }
        );
      } else {
        setLocationEnabled(true);
        localStorage.setItem('mart_location_enabled', 'true');
      }
    } else {
      // Turning off — just disable app-level usage (can't revoke browser permission)
      setLocationEnabled(false);
      localStorage.setItem('mart_location_enabled', 'false');
    }
  };

  const saveName = async () => {
    setSaving('name'); setError('');
    try {
      await authApi.updateProfile({ name: nameVal.trim() });
      updateProfile({ name: nameVal.trim() });
      syncName(nameVal.trim());
      setSaved('name'); setTimeout(() => setSaved(null), 2000);
      setEditingName(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(null); }
  };

  const saveAddress = async (key: 'address' | 'address2', val: string) => {
    setSaving(key); setError('');
    try {
      await authApi.updateProfile({ [key]: val });
      updateProfile({ [key]: val });
      setSaved(key); setTimeout(() => setSaved(null), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(null); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">

        {/* Avatar + name */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input autoFocus type="text" value={nameVal} onChange={e => setNameVal(e.target.value)}
                    className={`${inp} py-1.5 flex-1`} placeholder="Your full name" />
                  <button onClick={saveName} disabled={saving === 'name'}
                    className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex-shrink-0 transition-colors">
                    {saving === 'name' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => { setEditingName(false); setNameVal(name || ''); }}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate flex-1">{name || 'Add your name'}</p>
                  <button onClick={() => setEditingName(true)}
                    className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg flex-shrink-0 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" /> +91 {phone}
              </p>
            </div>
          </div>
          {saved === 'name' && <p className="text-xs text-emerald-600 mt-2">Name saved ✓</p>}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>

        {/* Addresses */}
        <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide px-1">Addresses</p>
        <AddressCard label="Default Address" icon="primary" stored={address} fieldKey="address" onSave={saveAddress} saving={saving} saved={saved} />
        <AddressCard label="Secondary Address" icon="secondary" stored={address2} fieldKey="address2" onSave={saveAddress} saving={saving} saved={saved} />

        {/* Support */}
        {(supportName || supportPhone) && (
          <>
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide px-1">Support</p>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    {(supportName || 'S')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{supportName || 'Support'}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{supportPhone || ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {supportPhone && (
                    <a href={`tel:${supportPhone}`}
                      className="flex items-center justify-center w-9 h-9 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl hover:bg-emerald-100 transition-colors">
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                  {(whatsappNumber || supportPhone) && (
                    <a href={`https://wa.me/${(whatsappNumber || supportPhone)?.replace(/\D/g, '')}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-xl hover:bg-green-100 transition-colors">
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Your Rights (DPDP) */}
        <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide px-1">Your Rights</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">
          <button
            onClick={() => { window.history.pushState({}, '', '/account'); window.history.pushState({}, '', '/grievance'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
            <span className="text-base">💬</span>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-200">Submit a Grievance</p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">Complaint or concern about your data or service</p>
            </div>
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {/* Settings */}
        <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide px-1">Settings</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">

          {/* Dark mode */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="text-base">{isDark ? '🌙' : '☀️'}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-slate-200 flex-1">Dark Mode</span>
            <button onClick={toggle} role="switch" aria-checked={isDark}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${isDark ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Location */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Navigation className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">Location</span>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">
                {locationPermission === 'denied'
                  ? 'Blocked in browser — enable in browser settings'
                  : locationEnabled
                  ? 'Auto-detects your delivery zone'
                  : 'Off — select zone manually from dropdown'}
              </p>
            </div>
            {locationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : (
              <button onClick={handleLocationToggle} role="switch" aria-checked={locationEnabled}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${locationEnabled ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${locationEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>

          {/* Notifications */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Bell className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">Order Notifications</span>
              <p className="text-[10px] text-gray-400 dark:text-slate-500">
                {notifPermission === 'granted' ? 'Enabled — get updates on your orders' :
                 notifPermission === 'denied'  ? 'Blocked — enable in browser settings' :
                 notifPermission === 'unsupported' ? 'Not supported on this browser' :
                 'Get notified when your order status changes'}
              </p>
            </div>
            {notifPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notifPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : notifPermission === 'granted' ? (
              <button
                onClick={async () => {
                  await unsubscribeFromPush();
                  setNotifPermission('default');
                }}
                className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-emerald-500 transition-colors focus:outline-none">
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow translate-x-5 transition duration-200" />
              </button>
            ) : (
              <button
                onClick={async () => {
                  const p = await requestNotificationPermission();
                  setNotifPermission(p);
                  if (p === 'granted') subscribeToPush().catch(() => {});
                }}
                className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 dark:bg-slate-600 transition-colors focus:outline-none">
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow translate-x-0 transition duration-200" />
              </button>
            )}
          </div>

        </div>

        {/* Sign out + Delete account */}
        <div className="flex flex-col items-center gap-2 pb-2">
          <button onClick={async () => {
            try { await authApi.logout(); } catch {}
            logout(); onBack?.();
          }}
            className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-600 px-4 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
            Sign Out
          </button>
          <button
            onClick={() => { window.history.pushState({}, '', '/account'); window.history.pushState({}, '', '/delete-account'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="text-xs text-gray-400 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-500 transition-colors">
            Delete my account
          </button>
        </div>

        {/* Footer links */}
        <div className="flex flex-col items-center gap-1.5 pb-4">
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => { window.history.pushState({}, '', '/privacy'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
              Privacy Policy
            </button>
            <span className="text-gray-300 dark:text-slate-600 text-[10px]">·</span>
            <button onClick={() => { window.history.pushState({}, '', '/terms'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
              Terms of Service
            </button>
          </div>
          <span className="text-[10px] text-gray-300 dark:text-slate-600">&copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.</span>
        </div>

      </div>
    </div>
  );
}
