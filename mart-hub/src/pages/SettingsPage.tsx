import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Upload, MapPin, Plus, Trash2, Pencil, X, Store, Clock } from 'lucide-react';
import { settingsApi, productsApi, zonesApi, storesApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import ConfirmDialog from '../components/ConfirmDialog';
import PageSkeleton from '../components/PageSkeleton';
import SmartImage from '../components/SmartImage';

interface Setting { key: string; value: string; label: string; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

/**
 * Tabs, each with its own save.
 *
 * This page used to carry two independent save paths on one scroll: a single
 * "Save Changes" button at the top that wrote every mart_settings key, and a
 * second button inside the branding card that wrote mart_stores. They covered
 * different fields, so editing opening hours and pressing the top button wrote
 * the hours nowhere and reported success. Splitting by tab means one button
 * always covers exactly the fields on screen.
 *
 * `keys` are mart_settings rows. `store` marks the tab as also owning columns on
 * mart_stores, which are written through a different endpoint entirely.
 */
type TabId = 'store' | 'hours' | 'zones' | 'payments';

/** Headings used inside a tab. Every tab key must appear here or in a bespoke
 *  card, or the field would render nowhere while still being saved. */
const GROUP_TITLES = [
  { title: 'Store', keys: ['delivery_area', 'estimated_delivery'] },
  { title: 'Customer Support', keys: ['whatsapp_number', 'support_name', 'support_phone'] },
  { title: 'Delivery & Pricing', keys: ['delivery_charge', 'free_delivery_above', 'min_order_amount'] },
  { title: 'Payment Methods', keys: ['cod_enabled', 'upi_enabled', 'upi_id', 'upi_phone', 'upi_qr_enabled', 'phonepay_enabled', 'phonepay_qr_url'] },
];

const TABS: { id: TabId; label: string; keys: string[]; store?: boolean }[] = [
  { id: 'store', label: 'Store', store: true,
    keys: ['delivery_area', 'estimated_delivery',
           'whatsapp_number', 'support_name', 'support_phone'] },
  { id: 'hours', label: 'Hours & Delivery', store: true,
    keys: ['store_open', 'store_closed_from', 'store_closed_until', 'store_closed_greeting',
           'store_closed_message', 'delivery_charge', 'free_delivery_above', 'min_order_amount'] },
  // Zones persist on their own per action, so this tab has no bulk save.
  { id: 'zones', label: 'Delivery Zones', keys: [] },
  { id: 'payments', label: 'Payments & Inventory',
    keys: ['cod_enabled', 'upi_enabled', 'upi_id', 'upi_phone', 'upi_qr_enabled',
           'phonepay_enabled', 'phonepay_qr_url',
           'inventory_tracking', 'auto_out_of_stock', 'low_stock_threshold'] },
];

// Hardcoded labels and placeholders — never rely on DB labels
const FIELD_META: Record<string, { label: string; placeholder?: string; hint?: string }> = {
  delivery_area:       { label: 'Delivery Area',                     placeholder: 'e.g. Shapoorji, Kolkata', hint: 'Shown to customers on the app' },
  estimated_delivery:  { label: 'Estimated Delivery Time',           placeholder: 'e.g. 10-15 mins' },
  store_open:          { label: 'Store is Open' },
  store_closed_message: { label: 'Closed Banner Message',            placeholder: 'e.g. Your neighbourhood store is taking a break today. We will remove this tomorrow.', hint: 'Shown under the closed notice in the app. Leave empty to use the default wording.' },
  delivery_charge:     { label: 'Delivery Charge (₹)',               placeholder: 'e.g. 15' },
  free_delivery_above: { label: 'Free Delivery Above (₹)',           placeholder: 'e.g. 150', hint: 'Orders above this amount get free delivery' },
  min_order_amount:    { label: 'Minimum Order Amount (₹)',          placeholder: 'e.g. 50' },
  whatsapp_number:     { label: 'WhatsApp Number',                   placeholder: 'e.g. 91XXXXXXXXXX', hint: 'Include country code — 91 for India' },
  support_name:        { label: 'Support Contact Name',              placeholder: 'e.g. Arman' },
  support_phone:       { label: 'Support Phone Number',              placeholder: 'e.g. 9XXXXXXXXX' },
  cod_enabled:         { label: 'Accept Cash on Delivery' },
  upi_enabled:         { label: 'Accept UPI Payment' },
  upi_id:              { label: 'UPI ID',                            placeholder: 'e.g. name@bank', hint: 'Your UPI VPA / payment address' },
  upi_phone:           { label: 'UPI Phone Number',                  placeholder: 'e.g. 9XXXXXXXXX', hint: 'Phone number linked to your UPI' },
  upi_qr_enabled:      { label: 'Show UPI QR Code to Customers' },
  phonepay_enabled:    { label: 'Accept PhonePe / QR Payments' },
  phonepay_qr_url:     { label: 'UPI QR Code Image',                 hint: 'Upload any UPI QR (PhonePe, GPay, Paytm, etc.)' },
};

const BOOLEAN_KEYS = new Set(['store_open', 'cod_enabled', 'upi_enabled', 'upi_qr_enabled', 'phonepay_enabled', 'inventory_tracking']);

/**
 * How long the closed banner message may be.
 *
 * It is one line under the closed notice in the app, so it is capped rather
 * than left open — a paragraph would push the product grid off the screen and
 * the customer would read the store's apology instead of the shop.
 */
const CLOSED_MESSAGE_MAX = 200;

/** The greeting is the banner's first line, so it is much shorter. */
const CLOSED_GREETING_MAX = 80;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The IST calendar date as { y, mo, d }. */
function istToday(): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return { y: Number(get('year')), mo: Number(get('month')), d: Number(get('day')) };
}

/**
 * The reopening time as the app will show it: "today at 6:00 PM",
 * "tomorrow at 9:00 AM", or "on 22 Oct at 6:00 PM".
 *
 * Formatted from the raw value the owner typed, with no timezone conversion,
 * because the value IS the store's IST wall clock — the same string the
 * backend reads. That makes the preview here match the banner on a customer's
 * phone exactly, instead of drifting by the admin's own timezone offset.
 */
function formatResumeTime(raw: string | undefined | null): string {
  if (!raw) return 'later';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!m) return 'later';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const meridiem = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time = `${h12}:${String(minute).padStart(2, '0')} ${meridiem}`;

  // Today and tomorrow are named rather than dated, exactly as the app words
  // it, so the preview is the same sentence the customer will read.
  const today = istToday();
  if (year === today.y && month === today.mo && day === today.d) return `today at ${time}`;
  const tomorrow = new Date(Date.UTC(today.y, today.mo - 1, today.d + 1));
  if (year === tomorrow.getUTCFullYear()
    && month === tomorrow.getUTCMonth() + 1
    && day === tomorrow.getUTCDate()) {
    return `tomorrow at ${time}`;
  }
  return `on ${day} ${MONTHS[month - 1] || ''} at ${time}`;
}

// Proper toggle component
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${checked ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

const EMPTY_ZONE = { name: '', lat: '', lng: '', radiusKm: '5' };

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABELS: Record<string,string> = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
const DEFAULT_HOURS = Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TabId>('store');
  // Pristine copy of the last persisted state, per scope. A field is dirty when
  // it differs from what the database actually holds, which is why this is
  // compared against `savedValues` rather than tracked with a separate flag:
  // a flag set on keystroke stays set even if the edit is undone, leaving a Save
  // button that re-writes values nobody changed.
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [savedBranding, setSavedBranding] = useState<{ ownerName: string; supportPhone: string; logoUrl: string; openingHours: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [addingZone, setAddingZone] = useState(false);
  const [confirmDeleteZoneId, setConfirmDeleteZoneId] = useState<string | null>(null);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [savingZone, setSavingZone] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Store branding state
  const [storeData, setStoreData] = useState<any>(null);
  const [branding, setBranding] = useState({
    ownerName: '', supportPhone: '', logoUrl: '',
    openingHours: DEFAULT_HOURS as any,
  });

  const loadZones = async () => { const zr = await zonesApi.getAll(getActiveStoreId()); setZones(zr.data.data || []); };

  // Reads back whatever the database actually holds for this store. Used on
  // mount and again after every save, so the form can never quietly drift away
  // from the persisted value.
  const loadStore = async () => {
    const sr = await storesApi.getAll();
    const store = (sr.data.data || []).find((s: any) => s.id === getActiveStoreId());
    if (store) {
      setStoreData(store);
      const next = {
        ownerName: store.ownerName || '',
        supportPhone: store.supportPhone || '',
        logoUrl: store.logoUrl || '',
        openingHours: store.openingHours || DEFAULT_HOURS,
      };
      setBranding(next);
      // Baseline comes from the database, never from the form. A write that
      // silently did nothing therefore leaves the tab dirty rather than letting
      // the Save button report a success that did not happen.
      setSavedBranding(next);
    }
  };

  useEffect(() => {
    Promise.all([
      settingsApi.getAll(getActiveStoreId()),
      zonesApi.getAll(getActiveStoreId()),
      loadStore(),
    ]).then(([r, zr]) => {
      setZones(zr.data.data || []);
      const map: Record<string, Setting> = {};
      const vals: Record<string, string> = {};
      for (const s of (r.data.data || [])) { map[s.key] = s; vals[s.key] = s.value; }
      setSettings(map);
      setValues(vals);
      setSavedValues(vals);
      if (vals.phonepay_qr_url) setQrPreview(vals.phonepay_qr_url);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  /**
   * The closed banner exactly as the customer will see it.
   *
   * The defaults mirror the storefront's, so the preview never promises
   * something the app will not show.
   */
  const closedPreview = (() => {
    const resume = formatResumeTime(values['store_closed_until']);
    const greeting = (values['store_closed_greeting'] || '').trim()
      || 'Your neighbourhood store is closed now.';
    const raw = (values['store_closed_message'] || '').trim();
    const message = raw
      ? raw.replace(/\{until\}/g, resume)
      : `You can order now — we will start delivering from next opening hours.`;
    return { greeting, message };
  })();

  /** Settings keys belonging to the active tab, as a settingsApi.update payload. */
  const keysFor = (tab: TabId) => {
    const tab_ = TABS.find(t => t.id === tab)!;
    const payload: Record<string, string> = {};
    for (const key of tab_.keys) if (key in values) payload[key] = values[key];
    return payload;
  };

  /** The store has said it is shut, regardless of what its hours say. */
  const manualClosed = values['store_open'] === 'false';

  /** A manual closure has to say when it lifts, so both ends are required. */
  const closureTimesMissing = manualClosed
    && (!values['store_closed_from'] || !values['store_closed_until']);

  /**
   * Whether there is anything left to clear.
   *
   * The Clear button is offered whenever a closure is on, and also when the
   * switch is off but the times from an earlier closure are still filled in.
   * That is the flow it exists for: wipe the old times first, then switch the
   * closure on and pick the new ones, rather than editing a stale pair.
   */
  const hasClosureData = manualClosed
    || Boolean(values['store_closed_from'])
    || Boolean(values['store_closed_until']);

  /**
   * One click back to the store's normal hours: the closure is switched off
   * and both of its times are cleared, so nothing is left half-set.
   */
  const clearManualClosure = useCallback(() => {
    setValues(v => ({ ...v, store_open: 'true', store_closed_from: '', store_closed_until: '' }));
  }, []);

  const isDirty = (tab: TabId) => {
    const tab_ = TABS.find(t => t.id === tab)!;
    if (tab_ === undefined) return false;
    for (const key of tab_.keys) {
      if (key in values && values[key] !== savedValues[key]) return true;
    }
    // A picked-but-unsaved QR file has not reached `values` yet, so nothing
    // else here can see it. Without this the tab reads clean, shows no dirty
    // dot, triggers no unload warning, and the selection is silently lost.
    if (tab === 'payments' && qrFile) return true;
    if (!tab_.store || !savedBranding) return false;
    if (branding.ownerName !== savedBranding.ownerName) return true;
    if (branding.supportPhone !== savedBranding.supportPhone) return true;
    // The logo is set by an upload rather than typed, so a changed URL is the
    // only signal that it is unsaved.
    if (branding.logoUrl !== savedBranding.logoUrl) return true;
    if (JSON.stringify(branding.openingHours) !== JSON.stringify(savedBranding.openingHours)) return true;
    return false;
  };

  /**
   * Saves the active tab.
   *
   * A tab can span two tables, so this issues up to two requests. They are
   * sequential and the UI reports exactly which one failed: firing them in
   * parallel would let one succeed and one fail with no way for the user to
   * tell which half of the tab was persisted.
   */
  const saveTab = async (tab: TabId) => {
    const tab_ = TABS.find(t => t.id === tab)!;
    setSaving(true);
    setSaveError(null);
    try {
      if (tab_.store) {
        if (!storeData) throw new Error('Store not loaded yet');
        // Must be updateSettings(), not update(): the latter is requireSuperAdmin
        // and returns 403 for a store owner or manager, so the write never
        // happened even though the click looked successful.
        await storesApi.updateSettings(getActiveStoreId(), {
          ownerName: branding.ownerName,
          supportPhone: branding.supportPhone,
          logoUrl: branding.logoUrl,
          openingHours: branding.openingHours,
        });
        // Read back what the database actually holds, so the form reflects the
        // persisted value and a silently dropped write cannot look like success.
        await loadStore();
      }
      const payload = keysFor(tab);
      if (Object.keys(payload).length > 0) {
        // The QR has to reach the server first, because settingsApi stores a URL
        // rather than the image itself.
        if (tab === 'payments' && qrFile) {
          const res = await productsApi.uploadPhoto(qrFile);
          payload.phonepay_qr_url = res.data.data.url;
          setValues(v => ({ ...v, phonepay_qr_url: res.data.data.url }));
          setQrFile(null);
        }
        await settingsApi.update(payload, getActiveStoreId());
        // Re-read rather than trusting the local copy: the backend may normalise
        // or reject a value, and the form should show what is really stored.
        const sr = await settingsApi.getAll(getActiveStoreId());
        const map: Record<string, Setting> = {};
        const vals: Record<string, string> = {};
        for (const item of (sr.data.data || [])) { map[item.key] = item; vals[item.key] = item.value; }
        setSettings(map);
        setValues(vals);
        setSavedValues(vals);
        if (vals.phonepay_qr_url) setQrPreview(vals.phonepay_qr_url);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      // Surface the real reason. Swallowing it into a generic message is what
      // made a 403 look like "saved then vanished".
      setSaveError(e?.response?.data?.error || e?.message || 'Unknown error');
    } finally { setSaving(false); }
  };

  // Warn before a browser-level navigation (refresh, tab close, back out of the
  // SPA's history) would throw away unsaved edits. In-app sidebar navigation is
  // deliberately not blocked: this app uses BrowserRouter, and react-router's
  // useBlocker requires a data router, which it is not. Hand-rolling a history
  // patcher to cover it would be far easier to get subtly wrong than the
  // per-tab dirty dot and the Discard button already are.
  useEffect(() => {
    if (!TABS.some(t => isDirty(t.id))) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore the text and show their own wording; a non-empty
      // returnValue is what makes them prompt at all.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [values, branding, savedValues, savedBranding]);

  /** Drops unsaved edits on the active tab. */
  const discardTab = (tab: TabId) => {
    const tab_ = TABS.find(t => t.id === tab)!;
    if (tab_.store) {
      // Re-read rather than copying the baseline, so discard cannot itself
      // disagree with the database.
      loadStore();
    }
    setValues(v => {
      const next = { ...v };
      for (const key of tab_.keys) if (key in savedValues) next[key] = savedValues[key];
      return next;
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploadingLogo(true);
    try {
      const res = await productsApi.uploadPhoto(file);
      setBranding(b => ({ ...b, logoUrl: res.data.data.url }));
    } catch { alert('Upload failed'); } finally { setUploadingLogo(false); }
  };

  const updateHours = (day: string, field: string, value: any) => {
    setBranding(b => ({ ...b, openingHours: { ...b.openingHours, [day]: { ...b.openingHours[day], [field]: value } } }));
  };

  const saveZone = async (isEdit: boolean) => {
    const form = isEdit ? editingZone : zoneForm;
    if (!form.name || !form.lat || !form.lng) return;
    setSavingZone(true);
    try {
      if (isEdit) {
        await zonesApi.update(editingZone.id, { name: form.name, lat: parseFloat(form.lat), lng: parseFloat(form.lng), radiusKm: parseFloat(form.radiusKm) });
        setEditingZone(null);
      } else {
        await zonesApi.create({ name: form.name, lat: parseFloat(form.lat), lng: parseFloat(form.lng), radiusKm: parseFloat(form.radiusKm), storeId: getActiveStoreId() });
        setZoneForm(EMPTY_ZONE); setAddingZone(false);
      }
      await loadZones();
    } catch { alert('Failed to save zone'); } finally { setSavingZone(false); }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Tabs. role="tablist" with aria-selected so the active section is
          announced, and each tab marks unsaved work with a dot. */}
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl overflow-x-auto">
        {TABS.map(tab => {
          const active = tab.id === activeTab;
          const dirty = isDirty(tab.id);
          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 min-w-fit whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                active
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
              }`}
            >
              {tab.label}
              {dirty && <span aria-label="Unsaved changes" className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />}
            </button>
          );
        })}
      </div>

      {/* One save per tab, covering exactly the fields on screen. Disabled while
          clean so it cannot re-write values nobody changed. The error shows
          inline rather than in an alert the user can dismiss without reading. */}
      {activeTab !== 'zones' && (
        <div className="flex items-center justify-end gap-2">
          {saveError && (
            <span role="alert" className="text-xs font-medium text-red-600 dark:text-red-400 mr-auto">
              {saveError}
            </span>
          )}
          {isDirty(activeTab) && (
            <button onClick={() => discardTab(activeTab)} disabled={saving}
              className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
              Discard
            </button>
          )}
          <button onClick={() => saveTab(activeTab)} disabled={saving || !isDirty(activeTab) || (activeTab === 'hours' && closureTimesMissing)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> {saved ? 'Saved \u2713' : 'Save Changes'}</>}
          </button>
        </div>
      )}

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="space-y-6">

      {/* Store tab */}
      {activeTab === 'store' && storeData && (
        <>
          {/* Store name and address are owned by the Stores page (mart_stores).
              Shown here read-only so it is clear where the value comes from and
              staff do not expect to edit it on this tab. */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700">
              <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Store className="w-3.5 h-3.5" /> Store Identity
              </h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Store Name</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{storeData.name || '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Store Address</p>
                <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">{storeData.address || '—'}</p>
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg px-2.5 py-2">
                If you want to change the store name and address, contact the super admin.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700 flex items-center justify-between">
              <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Store className="w-3.5 h-3.5" /> Store Branding
              </h2>
            </div>
            <div className="p-4 space-y-4">
              {/* Logo */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Store Logo</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 flex items-center justify-center overflow-hidden flex-shrink-0">
                    <SmartImage
                      src={branding.logoUrl}
                      className="h-full w-full"
                      imgClassName="object-cover"
                      fallback={<Store className="w-6 h-6 text-gray-300" />}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploadingLogo} />
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Owner Name</label>
                <input type="text" value={branding.ownerName} onChange={e => setBranding(b => ({ ...b, ownerName: e.target.value }))} className={inp} placeholder="Store owner's name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Store Support Phone</label>
                <input type="tel" value={branding.supportPhone} onChange={e => setBranding(b => ({ ...b, supportPhone: e.target.value }))} className={inp} placeholder="+91 XXXXX XXXXX" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Hours tab: the schedule, plus the manual override that sits with it. */}
      {activeTab === 'hours' && storeData && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700">
            <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Opening Hours
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-4 py-0.5">
              <div>
                <label className="text-sm text-gray-700 dark:text-slate-300">Manually Closed</label>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                  Overrides the hours below, and always wins over them. While it is on, the start and reopen
                  times below are required.
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {hasClosureData && (
                  <button type="button" onClick={clearManualClosure}
                    className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 underline">
                    Clear
                  </button>
                )}
                <Toggle checked={manualClosed}
                  onChange={() => setValues(v => ({ ...v, store_open: manualClosed ? 'true' : 'false' }))} />
              </div>
            </div>
            {/* Scheduled closure: when the store is shut, for how long, and what
                the customer is told. Bespoke rather than a normal field because
                it is a form, not a value, and because it belongs next to the
                switch that turns the store off. */}
            <div className="space-y-4 border-t border-gray-100 dark:border-slate-700 pt-4">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">Scheduled Closure</p>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                  Close the store for a set period. From the start time the app shows the closed banner,
                  and at the end time the store reopens by itself. Times are India Standard Time.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">
                    Closed from {manualClosed && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="datetime-local"
                    value={values['store_closed_from'] || ''}
                    onChange={e => setValues(v => ({ ...v, store_closed_from: e.target.value }))}
                    className={inp}
                  />
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">Leave empty for no scheduled closure.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">
                    Reopens at {manualClosed && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="datetime-local"
                    value={values['store_closed_until'] || ''}
                    onChange={e => setValues(v => ({ ...v, store_closed_until: e.target.value }))}
                    className={inp}
                  />
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">The store reopens on its own at this time.</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Greeting (optional)</label>
                  <span className={`text-[10px] font-semibold ${(values['store_closed_greeting'] || '').length >= CLOSED_GREETING_MAX ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {(values['store_closed_greeting'] || '').length}/{CLOSED_GREETING_MAX}
                  </span>
                </div>
                <input
                  type="text"
                  value={values['store_closed_greeting'] || ''}
                  onChange={e => setValues(v => ({ ...v, store_closed_greeting: e.target.value.slice(0, CLOSED_GREETING_MAX) }))}
                  maxLength={CLOSED_GREETING_MAX}
                  placeholder="e.g. Hi! 👋"
                  className={inp}
                />
                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                  The bold first line of the banner. Leave empty to use the default heading.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Message (optional)</label>
                  <span className={`text-[10px] font-semibold ${(values['store_closed_message'] || '').length >= CLOSED_MESSAGE_MAX ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    {(values['store_closed_message'] || '').length}/{CLOSED_MESSAGE_MAX}
                  </span>
                </div>
                <textarea
                  value={values['store_closed_message'] || ''}
                  onChange={e => setValues(v => ({ ...v, store_closed_message: e.target.value.slice(0, CLOSED_MESSAGE_MAX) }))}
                  rows={3}
                  maxLength={CLOSED_MESSAGE_MAX}
                  placeholder={'e.g. Your neighbourhood store is taking a break today. We will be back {until}.'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400 resize-y"
                />
                <p className="text-[10px] text-gray-400 dark:text-slate-500">
                  The line under the greeting. Write <code className="font-mono text-gray-500">{'{until}'}</code> anywhere in it and the
                  reopening time is filled in for you. Leave empty to use the default wording.
                </p>
              </div>

              {closureTimesMissing && (
                <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                  A manual closure needs both a start and a reopen time, so the customer is told when it
                  reopens. Use Clear to go back to the normal hours.
                </p>
              )}

              {/* Exactly what the customer will see. */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Preview</label>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 px-4 py-2.5">
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200 leading-snug">
                    {closedPreview.greeting}
                  </p>
                  <p className="text-xs font-medium text-amber-800/80 dark:text-amber-300/80 leading-snug">
                    {closedPreview.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
                Times are India Standard Time. Orders placed outside them are still accepted, and flagged for staff.
              </p>
              <div className="space-y-2">
                {DAYS.map(day => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-600 dark:text-slate-300 w-8">{DAY_LABELS[day]}</span>
                    <button type="button" onClick={() => updateHours(day, 'closed', !branding.openingHours[day]?.closed)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${!branding.openingHours[day]?.closed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${!branding.openingHours[day]?.closed ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    {!branding.openingHours[day]?.closed ? (
                      <>
                        <input type="time" value={branding.openingHours[day]?.open || '09:00'} onChange={e => updateHours(day, 'open', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                        <span className="text-xs text-gray-500">to</span>
                        <input type="time" value={branding.openingHours[day]?.close || '21:00'} onChange={e => updateHours(day, 'close', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                      </>
                    ) : (
                      <span className="text-xs text-red-400 font-medium">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings groups, each shown only on the tab that owns its keys. */}
      {TABS.filter(t => t.id === activeTab && t.keys.length > 0).map(tab => (
        <div key={tab.id} className="space-y-4">
          {GROUP_TITLES.filter(g => g.keys.some(k => tab.keys.includes(k))).map(group => (
          <div key={group.title} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700">
            <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{group.title}</h2>
          </div>
          <div className="p-4 space-y-4">
            {group.keys.filter(key => tab.keys.includes(key)).map(key => {
              const setting = settings[key];
              const meta = FIELD_META[key];
              if (!meta) return null;
              if (!setting && !BOOLEAN_KEYS.has(key)) return null;

              if (key === 'phonepay_qr_url') {
                const qrEnabled = values['upi_qr_enabled'] === 'true' || values['phonepay_enabled'] === 'true';
                if (!qrEnabled) return null;
                return (
                  <div key={key} className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">{meta.label}</label>
                    <div className="flex items-center gap-3">
                      {qrPreview ? (
                        <img src={qrPreview} alt="UPI QR" className="w-20 h-20 rounded-xl object-contain border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700" />
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-gray-100 dark:bg-slate-700 border border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center">
                          <span className="text-xs text-gray-500 dark:text-slate-400">No QR</span>
                        </div>
                      )}
                      <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">
                        <Upload className="w-3.5 h-3.5" /> {qrPreview ? 'Change QR' : 'Upload QR'}
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setQrFile(f); setQrPreview(URL.createObjectURL(f)); } }} />
                      </label>
                    </div>
                    {meta.hint && <p className="text-[10px] text-gray-500 dark:text-slate-400">{meta.hint}</p>}
                  </div>
                );
              }

              if (BOOLEAN_KEYS.has(key)) {
                return (
                  <div key={key} className="flex items-center justify-between py-0.5">
                    <label className="text-sm text-gray-700 dark:text-slate-300">{meta.label}</label>
                    <Toggle checked={values[key] === 'true'} onChange={() => setValues(v => ({ ...v, [key]: v[key] === 'true' ? 'false' : 'true' }))} />
                  </div>
                );
              }

              return (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">{meta.label}</label>
                  <input type="text" value={values[key] || ''}
                    onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                    className={inp}
                    placeholder={meta.placeholder || meta.label} />
                  {meta.hint && <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{meta.hint}</p>}
                </div>
              );
            })}
          </div>
        </div>
          ))}
        </div>
      ))}

      {/* Inventory card: bespoke because its sub-fields depend on the master
          toggle. Lives on the Payments & Inventory tab. */}
      {activeTab === 'payments' && (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700">
          <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Inventory</h2>
        </div>
        <div className="p-4 space-y-4">
          {/* Master toggle */}
          <div className="flex items-center justify-between py-0.5">
            <div>
              <label className="text-sm text-gray-700 dark:text-slate-300">Enable Inventory Tracking</label>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Track stock levels and deduct on delivery</p>
            </div>
            <Toggle
              checked={values['inventory_tracking'] === 'true'}
              onChange={() => setValues(v => ({ ...v, inventory_tracking: v['inventory_tracking'] === 'true' ? 'false' : 'true' }))}
            />
          </div>

          {values['inventory_tracking'] === 'true' && (
            <>
              {/* Auto out of stock */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">When stock hits 0</label>
                <select
                  value={values['auto_out_of_stock'] || 'on_zero'}
                  onChange={e => setValues(v => ({ ...v, auto_out_of_stock: e.target.value }))}
                  className={inp}>
                  <option value="on_zero">Auto mark Out of Stock</option>
                  <option value="never">Do nothing (manual control)</option>
                </select>
              </div>

              {/* Low stock threshold */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                  Low Stock Alert Threshold
                  <span className="ml-1 text-gray-500 font-normal">· send push alert + highlight in yellow</span>
                </label>
                <input
                  type="number" min="1"
                  value={values['low_stock_threshold'] || '5'}
                  onChange={e => setValues(v => ({ ...v, low_stock_threshold: e.target.value }))}
                  className={inp} placeholder="5" />
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Delivery Zones: each action persists on its own, so this tab has no
          bulk save and every row is either stored or not. */}
      {activeTab === 'zones' && (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700 flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5" /> Delivery Zones
          </h2>
          <button onClick={() => { setAddingZone(a => !a); setEditingZone(null); }}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
            <Plus className="w-3.5 h-3.5" /> Add Zone
          </button>
        </div>

        {/* Add zone form */}
        {addingZone && (
          <ZoneForm
            form={zoneForm}
            setForm={setZoneForm}
            onSave={() => saveZone(false)}
            onCancel={() => { setAddingZone(false); setZoneForm(EMPTY_ZONE); }}
            saving={savingZone}
            inp={inp}
          />
        )}

        {zones.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-slate-400">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No delivery zones yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {zones.map((zone: any) => (
              <div key={zone.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <MapPin className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{zone.name}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{zone.radiusKm}km radius · {zone.lat}, {zone.lng}</p>
                  </div>
                  <Toggle
                    checked={zone.isActive}
                    onChange={async () => { await zonesApi.update(zone.id, { isActive: !zone.isActive }); await loadZones(); }}
                  />
                  <button onClick={() => { setEditingZone({ ...zone, lat: String(zone.lat), lng: String(zone.lng), radiusKm: String(zone.radiusKm) }); setAddingZone(false); }}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDeleteZoneId(zone.id)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* Edit zone form inline */}
                {editingZone?.id === zone.id && (
                  <ZoneForm
                    form={editingZone}
                    setForm={setEditingZone}
                    onSave={() => saveZone(true)}
                    onCancel={() => setEditingZone(null)}
                    saving={savingZone}
                    inp={inp}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      )}

      {confirmDeleteZoneId && (
        <ConfirmDialog
          title="Delete Zone"
          message="Are you sure you want to delete this delivery zone?"
          confirmLabel="Delete"
          onConfirm={async () => { await zonesApi.delete(confirmDeleteZoneId); setConfirmDeleteZoneId(null); await loadZones(); }}
          onCancel={() => setConfirmDeleteZoneId(null)}
        />
      )}

      </div>
    </div>
  );
}

function ZoneForm({ form, setForm, onSave, onCancel, saving, inp }: {
  form: any; setForm: (f: any) => void;
  onSave: () => void; onCancel: () => void;
  saving: boolean; inp: string;
}) {
  return (
    <div className="p-4 border-b border-gray-100 dark:border-slate-700 bg-emerald-50 dark:bg-emerald-900/10 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Zone Name *</label>
          <input type="text" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Shapoorji" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Radius (km) *</label>
          <input type="number" value={form.radiusKm} onChange={e => setForm((f: any) => ({ ...f, radiusKm: e.target.value }))} className={inp} placeholder="5" min="0.5" step="0.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Latitude *</label>
          <input type="text" value={form.lat} onChange={e => setForm((f: any) => ({ ...f, lat: e.target.value }))} className={inp} placeholder="22.5657" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Longitude *</label>
          <input type="text" value={form.lng} onChange={e => setForm((f: any) => ({ ...f, lng: e.target.value }))} className={inp} placeholder="88.5142" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !form.name || !form.lat || !form.lng}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-600">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}
