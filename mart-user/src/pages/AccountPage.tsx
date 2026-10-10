import { useState, useEffect, useRef } from 'react';
import { Phone, MapPin, Save, Loader2, Pencil, Plus, X, MessageCircle, Bell, Navigation, Download, ShieldCheck, FileText, Camera, ChevronRight, Mail } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useCustomerStore } from '../store/customerStore';
import { useThemeStore } from '../store/themeStore';
import { useZoneStore } from '../store/zoneStore';
import { getLocationPermission, getNotificationPermission, requestNotificationPermission, subscribeToPush, unsubscribeFromPush } from '../services/push';
import AddressSheet from '../components/AddressSheet';
import { useLoginFlowStore } from '../store/loginFlowStore';
import LoginFlow, { type Step } from '../components/LoginFlow';
import NamePrompt from '../components/NamePrompt';
import { track } from '../utils/track';
import { useFinePointer } from '../utils/useFinePointer';
import { GOKEZ_SUPPORT } from '../constants/gokezSupport';

interface AccountPageProps {
  onBack?: () => void;
  storeName?: string;
  supportName?: string;
  supportPhone?: string;
  whatsappNumber?: string;
  onNavigate?: (view: string) => void;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2a9.85 9.85 0 0 0-8.35 15.08L2.5 21.5l4.55-1.13A9.85 9.85 0 1 0 12.04 2Zm0 17.9a8 8 0 0 1-4.08-1.12l-.3-.18-2.7.67.72-2.62-.2-.32a8 8 0 1 1 6.56 3.57Zm4.4-5.98c-.24-.12-1.42-.7-1.64-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06a6.55 6.55 0 0 1-1.93-1.19 7.23 7.23 0 0 1-1.34-1.67c-.14-.24 0-.37.1-.49.1-.1.22-.26.32-.39.11-.12.14-.22.22-.36.07-.14.03-.27-.02-.38-.06-.1-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

export default function AccountPage({ onBack, storeName, supportPhone, whatsappNumber }: AccountPageProps) {
  const finePointer = useFinePointer();
  const { name, phone, photoUrl, updateProfile, logout, isLoggedIn } = useCustomerAuthStore();
  const { setName: syncName, addresses, loadAddresses, addAddress, updateAddress, removeAddress, setDefaultAddress } = useCustomerStore();
  const { } = useThemeStore();

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(name || '');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [locationPermission, setLocationPermission] = useState<string>('prompt');
  // Shared with the navbar picker and the catalog loader: toggling this actually
  // runs the same location lookup the navbar uses, so it switches delivery area
  // immediately instead of waiting for a reload.
  const autoDetect = useZoneStore(s => s.autoDetect);
  const selectedZone = useZoneStore(s => s.selectedZone);
  const locationBusy = useZoneStore(s => s.locating);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission());
  const [notificationSubscribed, setNotificationSubscribed] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | 'new' | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  useEffect(() => { if (isLoggedIn) loadAddresses(); }, [isLoggedIn]);



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
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setMarketingConsent(false);
      setNotificationSubscribed(false);
      return;
    }

    authApi.getMarketingConsent().then(response => setMarketingConsent(response.data.data.granted)).catch(() => {});
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(registration => registration.pushManager.getSubscription())
          .then(subscription => setNotificationSubscribed(!!subscription))
          .catch(() => {});
      }
    } catch {}
  }, [isLoggedIn]);

  const handleLocationToggle = async () => {
    setLocationNotice(null);
    const store = useZoneStore.getState();
    if (store.autoDetect) {
      store.setAutoDetect(false);
      return;
    }
    // Enabling runs the shared lookup right away. It can never block ordering —
    // if the fix can't be matched to an area, the customer just picks one from
    // the navbar dropdown (e.g. ordering for family in another area).
    store.setAutoDetect(true);
    const result = await store.detectAndApply();
    switch (result.status) {
      case 'applied':
      case 'kept':
        setLocationNotice(`Delivering to ${result.zone.name}`);
        break;
      case 'no_match':
        setLocationNotice('No nearby area detected — pick one from the dropdown. You can order to any available area.');
        break;
      case 'denied':
        setLocationNotice('Location is blocked in your browser settings.');
        break;
      case 'unavailable':
        setLocationNotice('Could not get your location. You can still pick an area from the dropdown.');
        break;
      case 'error':
        setLocationNotice('Something went wrong. Please try again or pick an area from the dropdown.');
        break;
      case 'busy':
        break;
    }
  };

  const handleOrderNotifications = async () => {
    if (notificationPermission === 'granted') {
      if (notificationSubscribed) {
        await unsubscribeFromPush();
        setNotificationSubscribed(false);
      } else {
        setNotificationSubscribed(await subscribeToPush());
      }
      return;
    }
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') setNotificationSubscribed(await subscribeToPush());
  };

  const handleMarketingNotifications = async () => {
    const next = !marketingConsent;
    setMarketingConsent(next);
    try { await authApi.updateMarketingConsent(next); }
    catch { setMarketingConsent(!next); }
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

  const initial = name
    ? name.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : (phone || '?')[0].toUpperCase();

  // Declining login returns to the page this visit started from: the tab the
  // customer tapped, or '/orders' for the guest "Track My Orders" CTA. It used
  // to branch on cartCount, which sent people to Checkout or Home regardless of
  // where they actually were.
  const loginStep = useRef<Step>('phone');

  const leaveAsGuest = () => {
    // The flow's own GuestLink tracks this itself, but showGuestLink is off here,
    // so without emitting it here every abandonment from this page would be
    // invisible in the hub funnel.
    if (loginStep.current === 'phone' || loginStep.current === 'otp') {
      track('login_abandoned', { step: loginStep.current, reason: 'guest' });
    }
    const { guestReturnPath } = useLoginFlowStore.getState();
    useLoginFlowStore.getState().clear();
    useLoginFlowStore.getState().setGuestReturnPath(null);
    navigate(guestReturnPath || '/');
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const footer = (
    <div className="mt-2 flex flex-col items-center gap-1.5 pb-36">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <button onClick={() => navigate('/privacy/')} className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300">Privacy Policy</button>
        <span className="text-gray-500 dark:text-slate-400 text-[10px]">·</span>
        <button onClick={() => navigate('/terms/')} className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300">Terms of Service</button>
        <span className="text-gray-500 dark:text-slate-400 text-[10px]">·</span>
        <button onClick={() => navigate('/delete-account')} className="text-[10px] text-gray-500 transition-colors hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400">Delete my account</button>
      </div>
      <span className="text-xs text-gray-500 dark:text-slate-400">
        A product of{' '}
        <span className="font-bold bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
          Gokez Technologies Pvt. Ltd.
        </span>
        {' '}&copy; {new Date().getFullYear()}
      </span>
    </div>
  );

  if (!isLoggedIn) {
    return (
      <div className="page-shell bg-white dark:bg-slate-900 font-sans">
        <div className="w-full sm:max-w-sm sm:mx-auto bg-white dark:bg-slate-800 sm:rounded-3xl sm:shadow-xl overflow-hidden">
          <div className="px-5 py-6 space-y-4">
<LoginFlow
              variant="page"
              // Deliberately NOT pendingCheckout={cartCount > 0}. That flag is
              // persisted by beginOtp and read back on boot to auto-open the
              // overlay, so setting it here would turn any reload of /account
              // mid-login into the checkout modal, and it would label the name
              // step "Continue to Checkout" when this page actually navigates to
              // postLoginPath (/orders).
              // Only the guest exit is stood down: the page renders its own
              // "Continue as guest" link below, so the flow's copy is switched off
              // to avoid showing the same action twice. The hero image is NOT --
              // the flow supplies it, so both hosts share one login visual.
              showGuestLink={false}
              onStepChange={(s) => { loginStep.current = s; }}
              onNavigateLegal={(path) => navigate(path)}
              // The page owns the guest exit (the flow's own is switched off above), so it
              // has to do the flow's cleanup itself. LoginFlow.handleGuest normally
              // calls loginFlow.clear() before leaving; without that, a shopper who
              // abandons login here leaves an unexpired OTP flow in sessionStorage,
              // which App reads on next boot and turns into a surprise modal.
              onGuest={leaveAsGuest}
              onNameRequested={() => setShowNamePrompt(true)}
              onSuccess={() => {
                // Honour an explicit redirect intent (for example, Orders). A
                // customer who began login from Account belongs back on Account.
                const redirect = useLoginFlowStore.getState().postLoginPath || '/account';
                useLoginFlowStore.getState().setPostLoginPath(null);
                useLoginFlowStore.getState().setGuestReturnPath(null);
                navigate(redirect);
              }}
            />
            {!isLoggedIn && <div className="text-center">
              <button
                onClick={leaveAsGuest}
                className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
              >
                Continue as guest →
              </button>
            </div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell bg-[#f7f8fa] dark:bg-slate-900 font-sans">
      <div className="mx-auto max-w-2xl space-y-7 px-4 py-5 pb-10 sm:px-6 sm:py-7">
        <div className="relative -mx-4 -mt-5 overflow-hidden rounded-none border-y border-[#e9edf2] bg-white p-5 shadow-[0_2px_10px_rgba(23,32,51,0.04)] dark:border-slate-700 dark:bg-slate-800 sm:-mx-6 sm:-mt-7">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full border-2 border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30">
                {photoUrl
                  ? <img src={photoUrl} alt={name || ''} className="w-full h-full object-cover" />
                  : <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{initial}</span>
                }
              </div>
              <label aria-label="Change profile photo" className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#e9edf2] bg-white shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600">
                {photoUploading
                  ? <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                  : <Camera className="w-3.5 h-3.5 text-emerald-600" />
                }
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={photoUploading} />
              </label>
            </div>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input autoFocus={finePointer} type="text" value={nameVal} onChange={e => setNameVal(e.target.value)}
                    className="min-w-0 w-full flex-1 px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-emerald-500" placeholder="Your full name" />
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={saveName} disabled={saving === 'name'} aria-label="Save profile name" title="Save"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:opacity-60">
                      {saving === 'name' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => { setEditingName(false); setNameVal(name || ''); }} aria-label="Cancel profile name editing" title="Cancel"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="truncate text-[22px] font-bold leading-tight text-[#172033] dark:text-white">
                    {name || <span className="text-base font-normal text-gray-500 dark:text-slate-400">Add your name</span>}
                  </p>
                  <button onClick={() => setEditingName(true)} aria-label="Edit profile name"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700">
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-1 text-sm font-medium text-[#687386] dark:text-slate-300"><Phone className="h-3.5 w-3.5" />+91 {phone}</span>
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Verified
                </span>
              </div>
              {saved === 'name' && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">Name saved ✓</p>}
              {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
            </div>
          </div>
        </div>

        <section>
          <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">My Gokez Mart</p>
          <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <p className="text-[15px] font-semibold text-[#172033] dark:text-white">My addresses</p>
            <button onClick={() => setEditingAddressId('new')}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700">
              <Plus className="w-3 h-3" /> {addresses.length > 0 ? 'Add new address' : 'Add address'}
            </button>
          </div>
          {addresses.length === 0 && (
            <div className="border-t border-[#e9edf2] px-4 py-4 dark:border-slate-700">
              <p className="text-sm text-[#687386] dark:text-slate-400">Save an address for faster checkout.</p>
            </div>
          )}
          {addresses.map(addr => (
            <button type="button" key={addr.id} onClick={() => setEditingAddressId(addr.id)}
              className="flex w-full items-start gap-2 border-t border-[#e9edf2] px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
              <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${addr.isDefault ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                <MapPin className={`h-4 w-4 ${addr.isDefault ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-[#172033] dark:text-slate-200">{addr.label}</span>
                  {addr.isDefault && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">Default</span>
                  )}
                </div>
                <p className="line-clamp-2 text-[13px] leading-snug text-[#687386] dark:text-slate-400">{addr.address}</p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-gray-300" />
            </button>
          ))}
          </div>
        </section>

        {editingAddressId && (
          <AddressSheet
            mode="manage"
            addresses={addresses}
            initialEditingId={editingAddressId}
            onClose={() => setEditingAddressId(null)}
            onAddAddress={async (label, value, coordinates) => {
              await addAddress({ label, address: value, isDefault: addresses.length === 0, ...coordinates });
              return true;
            }}
            onUpdateAddress={async (id, label, value, coordinates) => {
              await updateAddress(id, label, value, coordinates?.latitude ?? null, coordinates?.longitude ?? null);
              return true;
            }}
            onDeleteAddress={(id) => removeAddress(id)}
            onSetDefaultAddress={(id) => setDefaultAddress(id)}
          />
        )}

        {(supportPhone || whatsappNumber) && (
          <section>
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Your local store</p>
            <div className="rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl bg-emerald-50 dark:bg-emerald-900/30">
                  <img src="/store_pic.webp" alt={storeName || 'Store'} className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-[#172033] dark:text-white">{storeName || 'Your delivery store'}</p>
                  <p className="mt-0.5 text-[13px] text-[#687386] dark:text-slate-400">{storeName ? 'Your orders are fulfilled by this store.' : 'Order and delivery help'}</p>
                </div>
              </div>
              {(supportPhone || whatsappNumber) && (
                <div className="mt-4 flex gap-2 border-t border-[#e9edf2] pt-3 dark:border-slate-700">
                  {supportPhone && (
                    <a href={`tel:${supportPhone}`}
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-50 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50">
                      <Phone className="w-4 h-4" /> Call store
                    </a>
                  )}
                  {whatsappNumber && (
                    <a href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I need help with my order on Gokez Mart.`)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-50 text-xs font-semibold text-green-700 transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/30">
                      <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Contact Gokez</p>
          <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
          <a href={`tel:+${GOKEZ_SUPPORT.phoneE164}`}
            className="flex min-h-[64px] items-center gap-3 px-4 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
              <Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">{GOKEZ_SUPPORT.phone}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </a>
          <a href={`mailto:${GOKEZ_SUPPORT.email}`}
            className="flex min-h-[64px] items-center gap-3 border-t border-[#e9edf2] px-4 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
              <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">{GOKEZ_SUPPORT.email}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </a>
          </div>
        </section>

        <button
          onClick={() => navigate('/feedback/')}
          className="flex w-full items-center justify-between rounded-[18px] border border-amber-100 bg-amber-50/70 px-4 py-4 text-left transition-colors hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-lg shadow-sm dark:bg-slate-800" aria-hidden="true">★</span>
            <div>
              <p className="text-[15px] font-semibold text-[#172033] dark:text-white">Share feedback</p>
              <p className="mt-0.5 text-[13px] text-[#687386] dark:text-slate-400">Tell us how Gokez Mart can improve.</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        </button>

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Preferences</p>
        <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800 divide-y divide-[#e9edf2] dark:divide-slate-700">
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Navigation className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Location</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">
                {locationNotice ?? (locationPermission === 'denied'
                  ? 'Blocked in browser — enable in browser settings'
                  : autoDetect
                  ? selectedZone
                    ? `Auto-detects — delivering to ${selectedZone.name}`
                    : 'Auto-detects your delivery zone'
                  : 'Off — select zone manually from dropdown')}
              </p>
            </div>
            {locationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : (
              <button onClick={handleLocationToggle} role="switch" aria-checked={autoDetect} disabled={locationBusy}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-70 ${autoDetect ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoDetect ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Bell className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Order notifications</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">
                {notificationPermission === 'granted' ? (notificationSubscribed ? 'On - delivery and order alerts' : 'Permission granted - enable alerts') :
                 notificationPermission === 'denied' ? 'Blocked - enable in browser settings' :
                 notificationPermission === 'unsupported' ? 'Not supported on this browser' :
                 'Get delivery and order status alerts'}
              </p>
            </div>
            {notificationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notificationPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : (
              <button onClick={handleOrderNotifications} role="switch" aria-checked={notificationSubscribed}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notificationSubscribed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${notificationSubscribed ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <MessageCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Promotional notifications</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">Offers, deals and new arrivals</p>
            </div>
            <button onClick={handleMarketingNotifications} role="switch" aria-checked={marketingConsent}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${marketingConsent ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${marketingConsent ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        </section>

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Privacy &amp; data</p>
        <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <MessageCircle className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[#172033] dark:text-slate-300">Submit a grievance</p>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">Complaint or concern about your data or service</p>
            </div>
            <button
              onClick={() => navigate('/grievance/')}
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2.5 py-1 rounded-lg hover:bg-violet-100 transition-colors flex-shrink-0">
              Open
            </button>
          </div>
          <div className="flex min-h-[64px] items-center gap-3 border-t border-[#e9edf2] px-4 dark:border-slate-700">
            <Download className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-slate-400" />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[#172033] dark:text-slate-300">Download my data</p>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">Export your profile, orders &amp; history</p>
            </div>
            <button
              disabled={exportLoading}
              onClick={async () => {
                setExportLoading(true);
                try {
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
          <button onClick={() => navigate('/privacy/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#e9edf2] px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <ShieldCheck className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-[#172033] dark:text-slate-300">Privacy policy</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/terms/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#e9edf2] px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <FileText className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-[#172033] dark:text-slate-300">Terms of service</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        </div>
        </section>

        <section className="pt-1 text-center">
          <button onClick={async () => {
            try { await authApi.logout(); } catch {}
            logout(); onBack?.();
          }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10">
            Sign Out
          </button>
          <p className="mt-6 text-xs text-gray-400 dark:text-slate-500">Version: v0.0.1</p>
          {footer}
        </section>
      </div>
      {showNamePrompt && <NamePrompt onDone={() => setShowNamePrompt(false)} />}
    </div>
  );
}
