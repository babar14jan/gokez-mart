import { useEffect, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, ChevronLeft, Download, Loader2, Pencil, User } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useCustomerStore } from '../store/customerStore';
import { useAccountLoginStore } from '../store/accountLoginStore';
import AddressButton from './AddressButton';
import AddressSheet from './AddressSheet';

// The Account view's top-bar identity: the customer's avatar plus a "Hi, <name>"
// greeting. Tapping it opens a full-screen profile page where the name can be
// edited and the (currently read-only) mobile number is shown.
export default function AccountGreeting() {
  const { name, phone, photoUrl, isLoggedIn, isPhoneVerified, updateProfile, logout, setGuestProfile } = useCustomerAuthStore();
  const { setName, addresses, loadAddresses, addAddress, updateAddress, removeAddress, setDefaultAddress, getDefaultAddress } = useCustomerStore();
  const openLogin = useAccountLoginStore((s) => s.openLogin);

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showAddressSheet, setShowAddressSheet] = useState(false);
  const [addressSheetInitial, setAddressSheetInitial] = useState<string | 'new' | null>(null);

  useEffect(() => {
    if (isLoggedIn) {
      loadAddresses();
      return;
    }
    try {
      const gName = localStorage.getItem('guest_name');
      const gPhone = localStorage.getItem('guest_phone');
      const gAddr = localStorage.getItem('guest_address');
      if (gName || gPhone || gAddr) {
        setGuestProfile({ name: gName, phone: gPhone, address: gAddr });
        if (gAddr) {
          const exists = useCustomerStore.getState().addresses.some((a) => (a.address || '').trim() === gAddr.trim());
          if (!exists) {
            // Guests have no server-side address book — seed it locally so the
            // saved guest address is visible without logging in.
            useCustomerStore.setState({
              addresses: [{ id: 'guest', label: 'Home', address: gAddr, latitude: null, longitude: null, isDefault: true }],
            });
          }
        }
      }
    } catch {}
  }, [isLoggedIn, loadAddresses, setGuestProfile]);

  const defaultAddress = getDefaultAddress();
  const openAddressSheet = () => {
    setAddressSheetInitial(addresses.length === 0 ? 'new' : null);
    setShowAddressSheet(true);
  };

  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : (phone || '?')[0].toUpperCase();
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';

  const openProfile = () => {
    setValue(name || '');
    setEditing(false);
    setError('');
    setSaved(false);
    setOpen(true);
    // The Account tab is reached without a history entry, so anchor the current
    // entry to /account first: the profile gets its own entry, and pressing back
    // pops it and resolves to the Account view (not Home).
    window.history.replaceState({}, '', '/account');
    window.history.pushState({ profile: true }, '');
  };

  const closeProfile = () => {
    setOpen(false);
    if ((window.history.state as { profile?: boolean } | null)?.profile) window.history.back();
  };

  // Hardware / browser back closes the page too.
  useEffect(() => {
    if (!open) return;
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);

  const save = async () => {
    const next = value.trim();
    if (!next) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      if (isLoggedIn) {
        await authApi.updateProfile({ name: next });
      } else {
        localStorage.setItem('guest_name', next);
      }
      updateProfile({ name: next });
      setName(next);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPhotoUploading(true);
    try {
      const res = await authApi.uploadPhoto(file);
      updateProfile({ photoUrl: res.data.data.url });
    } catch { alert('Failed to upload photo. Please try again.'); }
    finally { setPhotoUploading(false); e.target.value = ''; }
  };

  const handleExport = async () => {
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
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleSignOut = async () => {
    try { await authApi.logout(); } catch {}
    logout();
    setOpen(false);
    navigate('/');
  };

  const handleDeleteAccount = () => {
    setOpen(false);
    navigate('/delete-account');
  };

  return (
    <>
      {isLoggedIn ? (
        <button type="button" onClick={openProfile} aria-label="Open profile"
          className="flex items-center gap-2 transition-opacity hover:opacity-90">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/40 bg-white/20">
            {photoUrl
              ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              : <span className="text-sm font-bold text-white">{initials}</span>}
          </span>
          <span className="max-w-[10rem] truncate text-sm font-bold leading-tight text-white">Hi, {firstName}</span>
        </button>
      ) : (
        <button type="button" onClick={openProfile} aria-label="Open profile"
          className="flex items-center gap-2 transition-opacity hover:opacity-90">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20">
            <User className="h-4 w-4 text-white" />
          </span>
          <span className="max-w-[10rem] truncate text-sm font-bold leading-tight text-white">Hi Guest</span>
        </button>
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[80] flex flex-col bg-[#f7f8fa] font-sans dark:bg-slate-900">
          <header className="bg-gradient-to-r from-[#218044] to-[#2e8b57] pt-[env(safe-area-inset-top)] dark:from-[#18191a] dark:to-[#18191a]">
            <div className="flex min-h-[64px] items-center gap-1 px-2">
              <button type="button" onClick={closeProfile} aria-label="Back"
                className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <h1 className="text-base font-bold text-white">Profile</h1>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            <div className="mx-auto max-w-2xl">
              <div className="relative rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
                {!editing && (
                  <button type="button" onClick={() => { setValue(name || ''); setEditing(true); }} aria-label="Edit name"
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex items-center gap-3 pr-8">
                  <div className="relative h-14 w-14 flex-shrink-0">
                    <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30">
                      {photoUrl
                        ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                        : <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{initials}</span>}
                    </span>
                    {isLoggedIn && (
                      <label aria-label="Change profile photo"
                        className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[#e9edf2] bg-white shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600">
                        {photoUploading
                          ? <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
                          : <Camera className="h-3 w-3 text-emerald-600" />}
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={photoUploading} />
                      </label>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={value}
                          onChange={e => setValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && value.trim() && !saving) save();
                            if (e.key === 'Escape') { setEditing(false); setValue(name || ''); }
                          }}
                          placeholder="Your name"
                          className="min-w-0 flex-1 rounded-lg border border-[#e9edf2] bg-[#f7f8fa] px-2.5 py-2 text-sm font-semibold text-[#172033] outline-none focus:border-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                        />
                        <button type="button" onClick={save} disabled={saving || !value.trim()} aria-label="Save name"
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:opacity-60">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                      </div>
                    ) : (
                      <p className="truncate text-base font-bold text-[#172033] dark:text-white">
                        {name || <span className="font-normal text-gray-500 dark:text-slate-400">Add your name</span>}
                      </p>
                    )}

                    {phone && (
                      <div className="mt-1 flex flex-col items-start gap-1">
                        <span className="text-xs font-medium text-[#687386] dark:text-slate-300">{phone}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isPhoneVerified ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {isPhoneVerified ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                    )}
                    {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
                    {saved && <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved ✓</p>}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <AddressButton address={defaultAddress} heading="Address book" onClick={openAddressSheet} />
              </div>

              {isLoggedIn && (
                <div className="mt-5 overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex min-h-[64px] items-center gap-3 px-4">
                    <Download className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-slate-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-[#172033] dark:text-slate-300">Download my data</p>
                      <p className="text-[12px] text-[#687386] dark:text-slate-400">Export your profile, orders &amp; history</p>
                    </div>
                    <button
                      disabled={exportLoading}
                      onClick={handleExport}
                      className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors">
                      {exportLoading ? 'Preparing...' : exportReady ? 'Downloaded ✓' : 'Export'}
                    </button>
                  </div>
                </div>
              )}

              {isLoggedIn ? (
                <div className="mt-6 text-center">
                  <button type="button" onClick={handleSignOut}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10">
                    Sign Out
                  </button>
                  <div className="mt-3">
                    <button type="button" onClick={handleDeleteAccount}
                      className="text-[11px] text-gray-500 transition-colors hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400">
                      Delete my account
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 text-center">
                  <button type="button" onClick={() => { closeProfile(); openLogin(); }}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
                    Log in or Sign up
                  </button>
                </div>
              )}
            </div>
          </div>

          {showAddressSheet && (
            <AddressSheet
              mode="manage"
              zClassName="z-[90]"
              addresses={addresses}
              initialEditingId={addressSheetInitial}
              onClose={() => setShowAddressSheet(false)}
              onAddAddress={async (label, address, coordinates) => {
                await addAddress({ label, address, isDefault: addresses.length === 0, ...coordinates });
                return true;
              }}
              onUpdateAddress={async (id, label, address, coordinates) => {
                await updateAddress(id, label, address, coordinates?.latitude ?? null, coordinates?.longitude ?? null);
                return true;
              }}
              onDeleteAddress={async (id) => { await removeAddress(id); }}
              onSetDefaultAddress={async (id) => { await setDefaultAddress(id); }}
            />
          )}
        </div>,
        document.body
      )}
    </>
  );
}
