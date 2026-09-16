import { useState, useEffect } from 'react';
import { Phone, MapPin, Save, Loader2, Pencil, Plus, X, MessageCircle, Bell, Navigation, User, Camera } from 'lucide-react';
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


function AddressModalForm({ stored, onSave, onCancel, saving }: {
  stored: string | null;
  onSave: (val: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<AddressFields>(parse(stored));
  const f = (k: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Flat / House No.</label>
          <input type="text" value={form.flat} onChange={f('flat')} className={inp} placeholder="e.g. A-204" autoFocus />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Block / Tower</label>
          <input type="text" value={form.block} onChange={f('block')} className={inp} placeholder="e.g. Block B" />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-500 mb-1">Street / Area</label>
        <input type="text" value={form.street} onChange={f('street')} className={inp} placeholder="e.g. Kolkata" />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-500 mb-1">Pincode</label>
        <input type="tel" inputMode="numeric" maxLength={6} value={form.pincode} onChange={f('pincode')} className={inp} placeholder="700102" />
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel}
          className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl transition-colors">
          Cancel
        </button>
        <button onClick={() => onSave(serialize(form))} disabled={saving}
          className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Address'}
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage({ onBack, supportName, supportPhone, whatsappNumber }: ProfilePageProps) {
  const { name, phone, address, address2, photoUrl, updateProfile, logout, isLoggedIn } = useCustomerAuthStore();
  const { setName: syncName } = useCustomerStore();
  const { } = useThemeStore();

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(name || '');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [notifSubscribed, setNotifSubscribed] = useState(false);
  const [locationPermission, setLocationPermission] = useState<string>('prompt');
  const [locationEnabled, setLocationEnabled] = useState(
    localStorage.getItem('mart_location_enabled') !== 'false'
  );
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [editingAddress, setEditingAddress] = useState<'address' | 'address2' | null>(null);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoUploading(true);
    try {
      const res = await authApi.uploadPhoto(file);
      updateProfile({ photoUrl: res.data.data.url });
    } catch { alert('Failed to upload photo. Please try again.'); }
    finally { setPhotoUploading(false); e.target.value = ''; }
  };

  useEffect(() => {
    getLocationPermission().then(setLocationPermission);
    authApi.getMarketingConsent().then(r => setMarketingConsent(r.data.data.granted)).catch(() => {});
    if (!isLoggedIn) return;
    // Check actual subscription + auto-subscribe if permission granted but no subscription
    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg =>
        reg.pushManager.getSubscription().then(sub => {
          setNotifSubscribed(!!sub);
          if (!sub) subscribeToPush().then(ok => setNotifSubscribed(ok)).catch(() => {});
        })
      ).catch(() => {});
    }
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

      {/* Profile cover — full width, Facebook style */}
      {(() => {
        const initial = name
          ? name.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
          : (phone || '?')[0].toUpperCase();
        const gradient = 'from-slate-800 via-purple-900 to-slate-900';
        return (
          <div className={`relative bg-gradient-to-br ${gradient} dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 w-full`} style={{ minHeight: '160px' }}>
            {/* Decorative circles */}
            <div className="absolute -right-8 -top-8 w-56 h-56 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute right-8 -bottom-12 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute left-1/3 top-4 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />

            {/* Content pinned to bottom */}
            <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 pt-8 flex items-end gap-4">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm border-3 border-white/40 flex items-center justify-center shadow-xl overflow-hidden" style={{ border: '3px solid rgba(255,255,255,0.4)' }}>
                  {photoUrl
                    ? <img src={photoUrl} alt={name || ''} className="w-full h-full object-cover" />
                    : <span className="text-3xl font-black text-white drop-shadow tracking-tight">{initial}</span>
                  }
                </div>
                <label className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md cursor-pointer hover:bg-gray-100 transition-colors">
                  {photoUploading
                    ? <Loader2 className="w-3.5 h-3.5 text-purple-600 animate-spin" />
                    : <Camera className="w-3.5 h-3.5 text-purple-600" />
                  }
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={photoUploading} />
                </label>
              </div>

              {/* Name + phone */}
              <div className="flex-1 min-w-0 pb-1">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus type="text" value={nameVal} onChange={e => setNameVal(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl text-white placeholder:text-white/60 focus:outline-none focus:border-white/60" placeholder="Your full name" />
                    <button onClick={saveName} disabled={saving === 'name'}
                      className="p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg flex-shrink-0 border border-white/30">
                      {saving === 'name' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => { setEditingName(false); setNameVal(name || ''); }}
                      className="p-1.5 text-white/70 hover:bg-white/20 rounded-lg flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-black text-white drop-shadow truncate">
                      {name || <span className="font-normal text-white/70 text-base">Add your name</span>}
                    </p>
                    <button onClick={() => setEditingName(true)}
                      className="absolute top-3 right-3 p-2 bg-white/20 hover:bg-white/30 text-white rounded-xl border border-white/30 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3 h-3 text-white/70" />
                    <span className="text-sm font-semibold text-white">+91 {phone}</span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-slate-800 px-2 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Verified
                  </span>
                </div>
                {saved === 'name' && <p className="text-xs text-white/90 mt-1 font-semibold">Name saved ✓</p>}
                {error && <p className="text-xs text-red-200 mt-1">{error}</p>}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">

        {/* Addresses — now below profile card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Addresses</p>
          </div>

          {/* Default address */}
          <div className="px-4 pb-3 border-t border-gray-50 dark:border-slate-700">
            <div className="flex items-start justify-between gap-2 pt-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full">Default</span>
                  </div>
                  {saving === 'address' ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500 mb-1">Flat / House No.</label>
                          <input type="text" value={parse(address).flat}
                            onChange={e => { const p = parse(address); p.flat = e.target.value; saveAddress('address', serialize(p)); }}
                            className={inp} placeholder="e.g. A-204" autoFocus />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500 mb-1">Block / Tower</label>
                          <input type="text" value={parse(address).block}
                            onChange={e => { const p = parse(address); p.block = e.target.value; saveAddress('address', serialize(p)); }}
                            className={inp} placeholder="e.g. Block B" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-slate-300 leading-snug">
                      {address || <span className="text-gray-500 italic text-xs">No default address — tap Edit to add</span>}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setEditingAddress('address')}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-gray-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg border border-gray-200 dark:border-slate-600 transition-colors flex-shrink-0">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
          </div>

          {/* Secondary address */}
          {(address2 || editingAddress === 'address2') ? (
            <div className="px-4 pb-3 border-t border-gray-50 dark:border-slate-700">
              <div className="flex items-start justify-between gap-2 pt-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400">Other address</span>
                    <p className="text-sm text-gray-700 dark:text-slate-300 leading-snug mt-0.5">
                      {address2 || <span className="text-gray-500 italic text-xs">Tap Edit to add</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {address2 && (
                    <button
                      onClick={async () => {
                        const tmp = address2;
                        await saveAddress('address', tmp);
                        await saveAddress('address2', address || '');
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors">
                      ★ Default
                    </button>
                  )}
                  <button onClick={() => setEditingAddress('address2')}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-gray-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg border border-gray-200 dark:border-slate-600 transition-colors">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-3 border-t border-gray-50 dark:border-slate-700 pt-3">
              <button onClick={() => setEditingAddress('address2')}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add another address
              </button>
            </div>
          )}
        </div>

        {/* Address edit modal */}
        {editingAddress && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  {editingAddress === 'address' ? 'Edit Default Address' : 'Edit Other Address'}
                </p>
                <button onClick={() => setEditingAddress(null)} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              <AddressModalForm
                stored={editingAddress === 'address' ? address : address2}
                onSave={async (val) => { await saveAddress(editingAddress, val); setEditingAddress(null); }}
                onCancel={() => setEditingAddress(null)}
                saving={saving === editingAddress}
              />
            </div>
          </div>
        )}

        {/* Support */}
        {(supportName || supportPhone) && (
          <>
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1">Contact Store</p>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    {(supportName || 'S')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{supportName || 'Store Support'}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{supportPhone || ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {supportPhone && (
                    <a href={`tel:${supportPhone}`}
                      className="flex items-center justify-center w-9 h-9 bg-blue-50 dark:bg-blue-900/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.47 11.47 0 003.58.57 1 1 0 011 1V21a1 1 0 01-1 1A17 17 0 013 5a1 1 0 011-1h3.5a1 1 0 011 1 11.47 11.47 0 00.57 3.58 1 1 0 01-.25 1.01l-2.2 2.2z"/>
                      </svg>
                    </a>
                  )}
                  {(whatsappNumber || supportPhone) && (
                    <a href={`https://wa.me/${(whatsappNumber || supportPhone)?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I need help with my order on Gokez Mart.`)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 bg-green-50 dark:bg-green-900/20 rounded-xl hover:bg-green-100 transition-colors">
                      <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp" className="w-5 h-5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Help & Support */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider px-4 pt-3 pb-1">Contact Gokez</p>
          <a href="mailto:support@gokez.com"
            className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-200">Email Support</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">support@gokez.com</p>
            </div>
            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </a>
          <a href="https://wa.me/918777376280?text=Hi%2C%20I%20need%20help%20with%20Gokez%20Mart." target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
            <div className="w-8 h-8 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
              <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp" className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-200">WhatsApp Support</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Chat with us on WhatsApp</p>
            </div>
            <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </a>
        </div>

        {/* Settings */}
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1">Settings</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">

          {/* Location */}
          <div className="flex items-center gap-3 px-4 py-3">
            <Navigation className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">Location</span>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">
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
              <p className="text-[10px] text-gray-500 dark:text-slate-400">
                {notifPermission === 'granted' ? (notifSubscribed ? 'On — rider dispatch & delivery alerts' : 'Permission granted — tap to enable') :
                 notifPermission === 'denied'  ? 'Blocked — enable in browser settings' :
                 notifPermission === 'unsupported' ? 'Not supported on this browser' :
                 'Get notified when rider is on the way & delivered'}
              </p>
            </div>
            {notifPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notifPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : notifPermission === 'granted' ? (
              <button
                onClick={async () => {
                  if (notifSubscribed) {
                    await unsubscribeFromPush();
                    setNotifSubscribed(false);
                  } else {
                    const ok = await subscribeToPush();
                    setNotifSubscribed(ok);
                  }
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  notifSubscribed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'
                }`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  notifSubscribed ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            ) : (
              <button
                onClick={async () => {
                  const p = await requestNotificationPermission();
                  setNotifPermission(p);
                  if (p === 'granted') {
                    const ok = await subscribeToPush();
                    setNotifSubscribed(ok);
                  }
                }}
                className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 dark:bg-slate-600 transition-colors focus:outline-none">
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow translate-x-0 transition duration-200" />
              </button>
            )}
          </div>

        </div>

        {/* Data & Privacy */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-4 pt-3 pb-1">Data &amp; Privacy</p>

          {/* Marketing consent */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
            <Bell className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 dark:text-slate-300">Promotional Notifications</p>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">Offers, deals and new arrivals</p>
            </div>
            <button onClick={async () => {
              const next = !marketingConsent;
              setMarketingConsent(next);
              try { await authApi.updateMarketingConsent(next); }
              catch { setMarketingConsent(!next); }
            }}
              role="switch" aria-checked={marketingConsent}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${marketingConsent ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${marketingConsent ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Submit a Grievance */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
            <MessageCircle className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 dark:text-slate-300">Submit a Grievance</p>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">Complaint or concern about your data or service</p>
            </div>
            <button
              onClick={() => { window.history.pushState({}, '', '/account'); window.history.pushState({}, '', '/grievance'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2.5 py-1 rounded-lg hover:bg-violet-100 transition-colors flex-shrink-0">
              Open
            </button>
          </div>

          {/* Download my data */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-50 dark:border-slate-700">
            <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 dark:text-slate-300">Download My Data</p>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">Export your profile, orders &amp; history</p>
            </div>
            <button
              disabled={exportLoading}
              onClick={async () => {
                setExportLoading(true);
                try {
                  // First request the export, then fetch the actual data
                  await authApi.requestDataExport();
                  const res = await authApi.getDataExport();
                  const data = res.data.data?.data;
                  if (data) {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'my-gokez-data.json'; a.click();
                    URL.revokeObjectURL(url);
                    setExportReady(true);
                  } else {
                    alert('Export not ready. Please try again.');
                  }
                } catch { alert('Failed to export data. Please try again.'); }
                finally { setExportLoading(false); }
              }}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
              {exportLoading ? 'Preparing...' : exportReady ? 'Downloaded ✓' : 'Export'}
            </button>
          </div>
        </div>

        {/* Share Feedback */}
        <button
          onClick={() => { window.history.pushState({}, '', '/account'); window.history.pushState({}, '', '/feedback'); window.dispatchEvent(new PopStateEvent('popstate')); }}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-xl">⭐</span>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Share Feedback</p>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">Rate your experience with Gokez Mart</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>

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
            className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-500 dark:hover:text-slate-400 transition-colors">
            Delete my account
          </button>
        </div>

        {/* Footer links */}
        <div className="flex flex-col items-center gap-1.5 pb-36">
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => { window.history.pushState({}, '', '/privacy'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300">
              Privacy Policy
            </button>
            <span className="text-gray-500 dark:text-slate-400 text-[10px]">·</span>
            <button onClick={() => { window.history.pushState({}, '', '/terms'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300">
              Terms of Service
            </button>
          </div>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            A product of{' '}
            <span className="font-bold bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
              Gokez Technologies Pvt. Ltd.
            </span>
            {' '}&copy; {new Date().getFullYear()}
          </span>
        </div>

      </div>
    </div>
  );
}
