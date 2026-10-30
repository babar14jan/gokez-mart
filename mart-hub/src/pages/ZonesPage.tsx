import { useEffect, useState } from 'react';
import { Check, Loader2, MapPin, Pencil, Plus, Store, Trash2, X, Clock, Save } from 'lucide-react';
import { storesApi, zonesApi } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import PageSkeleton from '../components/PageSkeleton';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

interface ZoneStore { id: string; name: string; isPrimary: boolean; }

interface MartZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isActive: boolean;
  primaryStoreId: string | null;
  openingHours: any;
  primaryStore?: { id: string; name: string; address: string | null } | null;
  stores?: ZoneStore[];
}

interface MartStore { id: string; name: string; address: string | null; }

const EMPTY_FORM = { name: '', lat: '', lng: '', radiusKm: '5' };
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAY_LABELS: Record<string,string> = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

export default function ZonesPage() {
  const [zones, setZones] = useState<MartZone[]>([]);
  const [stores, setStores] = useState<MartStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<MartZone | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [primaryStoreId, setPrimaryStoreId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<MartZone | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<MartZone | null>(null);
  const [settingsZone, setSettingsZone] = useState<MartZone | null>(null);
  const [zoneValues, setZoneValues] = useState<Record<string, string>>({});
  const [zoneHours, setZoneHours] = useState<any>(DEFAULT_HOURS);
  const [savingZoneSettings, setSavingZoneSettings] = useState(false);

  const load = async () => {
    try {
      const [zr, sr] = await Promise.all([zonesApi.getAll(), storesApi.getAll()]);
      setZones(zr.data.data || []);
      setStores(sr.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSelectedStoreIds([]);
    setPrimaryStoreId('');
    setShowModal(true);
  };

  const openEdit = (zone: MartZone) => {
    setEditing(zone);
    setForm({
      name: zone.name,
      lat: String(zone.lat),
      lng: String(zone.lng),
      radiusKm: String(zone.radiusKm),
    });
    const tagged = (zone.stores || []).map(s => s.id);
    setSelectedStoreIds(tagged);
    setPrimaryStoreId(zone.primaryStoreId || tagged[0] || '');
    setShowModal(true);
  };

  const toggleStore = (storeId: string) => {
    setSelectedStoreIds(ids => {
      const next = ids.includes(storeId) ? ids.filter(id => id !== storeId) : [...ids, storeId];
      if (!next.includes(primaryStoreId)) setPrimaryStoreId(next[0] || '');
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.lat.trim() || !form.lng.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
        radiusKm: parseFloat(form.radiusKm) || 5,
      };
      const tagged = primaryStoreId && !selectedStoreIds.includes(primaryStoreId)
        ? [...selectedStoreIds, primaryStoreId]
        : selectedStoreIds;

      let zoneId = editing?.id;
      if (editing) {
        await zonesApi.update(editing.id, payload);
      } else {
        const res = await zonesApi.create({
          ...payload,
          storeId: primaryStoreId || tagged[0] || undefined,
        });
        zoneId = res.data.data.id;
      }

      if (zoneId) {
        await zonesApi.tagStores(zoneId, tagged);
        if (primaryStoreId) await zonesApi.setPrimary(zoneId, primaryStoreId);
      }

      setShowModal(false);
      await load();
    } catch (e: any) {
      window.alert(e?.response?.data?.error || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (zone: MartZone) => {
    await zonesApi.delete(zone.id);
    await load();
  };

  const openSettings = async (zone: MartZone) => {
    setSettingsZone(zone);
    setZoneValues({});
    setZoneHours(zone.openingHours || DEFAULT_HOURS);
    try {
      const sr = await zonesApi.getSettings(zone.id);
      setZoneValues(sr.data.data || {});
    } catch {}
  };

  const updateZoneHours = (day: string, field: string, value: any) => {
    setZoneHours((h: any) => ({ ...h, [day]: { ...h[day], [field]: value } }));
  };

  const manualClosed = zoneValues['store_open'] === 'false';
  const closureTimesMissing = manualClosed && (!zoneValues['store_closed_from'] || !zoneValues['store_closed_until']);
  const hasClosureData = manualClosed || Boolean(zoneValues['store_closed_from']) || Boolean(zoneValues['store_closed_until']);
  const clearManualClosure = () => setZoneValues(v => ({ ...v, store_open: 'true', store_closed_from: '', store_closed_until: '' }));

  const saveZoneSettings = async () => {
    if (!settingsZone) return;
    setSavingZoneSettings(true);
    try {
      await zonesApi.update(settingsZone.id, { openingHours: zoneHours });
      const payload: Record<string, string> = {};
      for (const k of ['store_open','store_closed_from','store_closed_until','store_closed_greeting','store_closed_message']) {
        if (zoneValues[k] !== undefined) payload[k] = zoneValues[k];
      }
      if (Object.keys(payload).length) await zonesApi.updateSettings(settingsZone.id, payload);
      await load();
      setSettingsZone(null);
    } catch (e: any) {
      window.alert(e?.response?.data?.error || 'Failed to save zone settings');
    } finally {
      setSavingZoneSettings(false);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Zone</button>
      </div>

      <div className="space-y-3">
        {zones.length === 0 ? (
          <div className="page-card py-12 text-center text-gray-500 dark:text-slate-400">
            <MapPin className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">No zones yet.</p>
          </div>
        ) : zones.map(zone => {
          const tagged = zone.stores || [];
          return (
            <div key={zone.id} className={'overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 ' + (zone.isActive ? '' : 'opacity-60')}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                  <MapPin className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{zone.name}</p>
                    <span className={'rounded-full px-1.5 py-0.5 text-[10px] font-bold ' + (zone.isActive
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400')}>
                      {zone.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {zone.radiusKm}km radius · {zone.lat}, {zone.lng}
                  </p>
                </div>
                <button onClick={() => setConfirmToggle(zone)} title={zone.isActive ? 'Deactivate zone' : 'Activate zone'}
                  className={'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ' + (zone.isActive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}>
                  <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (zone.isActive ? 'translate-x-4' : 'translate-x-0')} />
                </button>
              </div>

              <div className="space-y-1.5 px-4 pb-3">
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  <span className="font-semibold text-gray-700 dark:text-slate-300">Zone head:</span>{' '}
                  {zone.primaryStore?.name || 'Not set'}
                </p>
                {tagged.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tagged.map(store => (
                      <span key={store.id}
                        className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' + (store.isPrimary
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300')}>
                        {store.isPrimary && <Check className="h-3 w-3" />}
                        {store.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">No stores tagged yet.</p>
                )}
              </div>

              <div className="flex divide-x divide-gray-50 border-t border-gray-50 dark:divide-slate-700 dark:border-slate-700">
                <button onClick={() => openSettings(zone)}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700">
                  <Clock className="h-3.5 w-3.5" /> Hours
                </button>
                <button onClick={() => openEdit(zone)}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => setConfirmDelete(zone)}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm"
          onClick={saving ? undefined : () => setShowModal(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800"
            onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Zone' : 'Add Zone'}</h2>
              <button onClick={() => setShowModal(false)} disabled={saving}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">Zone Name *</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className={inp} placeholder="e.g. Shapoorji" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">Radius (km) *</label>
                  <input type="number" value={form.radiusKm} onChange={e => setForm(f => ({ ...f, radiusKm: e.target.value }))}
                    className={inp} placeholder="5" min="0.5" step="0.5" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">Latitude *</label>
                  <input type="text" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
                    className={inp} placeholder="22.5657" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">Longitude *</label>
                  <input type="text" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
                    className={inp} placeholder="88.5142" />
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-gray-700 dark:text-slate-300">Stores in this zone</p>
                {stores.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-slate-400">No stores available.</p>
                ) : (
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-slate-600">
                    {stores.map(store => {
                      const checked = selectedStoreIds.includes(store.id);
                      return (
                        <label key={store.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700">
                          <input type="checkbox" checked={checked} onChange={() => toggleStore(store.id)}
                            className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                          <Store className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <span className="min-w-0 flex-1 text-xs text-gray-700 dark:text-slate-300">
                            <span className="block truncate font-medium">{store.name}</span>
                            {store.address && <span className="block truncate text-[10px] text-gray-400">{store.address}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">Zone head (primary store)</label>
                <select value={primaryStoreId} onChange={e => setPrimaryStoreId(e.target.value)} className={inp}>
                  <option value="">Not set</option>
                  {(selectedStoreIds.length ? stores.filter(s => selectedStoreIds.includes(s.id)) : stores).map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                  Customers see this store's name, address and catalogue as the face of the zone.
                </p>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.lat.trim() || !form.lng.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Zone'}
              </button>
              <button onClick={() => setShowModal(false)} disabled={saving}
                className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


      {settingsZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm"
          onClick={savingZoneSettings ? undefined : () => setSettingsZone(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800"
            onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Zone Hours & Closure — {settingsZone.name}</h2>
              <button onClick={() => setSettingsZone(null)} disabled={savingZoneSettings}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 py-0.5">
                <div>
                  <label className="text-sm text-gray-700 dark:text-slate-300">Manually Closed</label>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Overrides the hours below.</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {hasClosureData && (
                    <button type="button" onClick={clearManualClosure}
                      className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 underline">
                      Clear
                    </button>
                  )}
                  <button type="button" role="switch" aria-checked={manualClosed}
                    onClick={() => setZoneValues(v => ({ ...v, store_open: manualClosed ? 'true' : 'false' }))}
                    className={'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ' + (manualClosed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}>
                    <span className={'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ' + (manualClosed ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Closed from</label>
                  <input type="datetime-local" value={zoneValues['store_closed_from'] || ''}
                    onChange={e => setZoneValues(v => ({ ...v, store_closed_from: e.target.value }))} className={inp} />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Reopens at</label>
                  <input type="datetime-local" value={zoneValues['store_closed_until'] || ''}
                    onChange={e => setZoneValues(v => ({ ...v, store_closed_until: e.target.value }))} className={inp} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Greeting (optional)</label>
                <input type="text" value={zoneValues['store_closed_greeting'] || ''}
                  onChange={e => setZoneValues(v => ({ ...v, store_closed_greeting: e.target.value.slice(0, 80) }))} className={inp} />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">Message (optional)</label>
                <textarea value={zoneValues['store_closed_message'] || ''}
                  onChange={e => setZoneValues(v => ({ ...v, store_closed_message: e.target.value.slice(0, 200) }))} rows={3} className={inp + ' resize-y'} />
              </div>

              <div className="space-y-2 border-t border-gray-100 dark:border-slate-700 pt-4">
                {DAYS.map(day => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-600 dark:text-slate-300 w-8">{DAY_LABELS[day]}</span>
                    <button type="button" onClick={() => updateZoneHours(day, 'closed', !zoneHours[day]?.closed)}
                      className={'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ' + (!zoneHours[day]?.closed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600')}>
                      <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ' + (!zoneHours[day]?.closed ? 'translate-x-4' : 'translate-x-0')} />
                    </button>
                    {!zoneHours[day]?.closed ? (
                      <>
                        <input type="time" value={zoneHours[day]?.open || ''} onChange={e => updateZoneHours(day, 'open', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                        <span className="text-xs text-gray-500">to</span>
                        <input type="time" value={zoneHours[day]?.close || ''} onChange={e => updateZoneHours(day, 'close', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                      </>
                    ) : (
                      <span className="text-xs text-red-400 font-medium">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button onClick={saveZoneSettings} disabled={savingZoneSettings || closureTimesMissing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50">
                {savingZoneSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingZoneSettings ? 'Saving...' : 'Save Zone Settings'}
              </button>
              <button onClick={() => setSettingsZone(null)} disabled={savingZoneSettings}
                className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">
                Cancel
              </button>
            </div>
            {closureTimesMissing && (
              <p className="mt-2 text-[11px] font-medium text-red-600 dark:text-red-400">
                A manual closure needs both a start and a reopen time.
              </p>
            )}
          </div>
        </div>
      )}

      {confirmToggle && (
        <ConfirmDialog
          title={confirmToggle.isActive ? 'Deactivate Zone' : 'Activate Zone'}
          message={confirmToggle.isActive
            ? `Deactivate "${confirmToggle.name}"? Customers will no longer see this zone.`
            : `Activate "${confirmToggle.name}"?`}
          confirmLabel={confirmToggle.isActive ? 'Deactivate' : 'Activate'}
          onConfirm={async () => {
            try {
              await zonesApi.update(confirmToggle.id, { isActive: !confirmToggle.isActive });
              await load();
            } catch (e: any) {
              window.alert(e?.response?.data?.error || 'Failed to update zone');
            }
            setConfirmToggle(null);
          }}
          onCancel={() => setConfirmToggle(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Zone"
          message={`Delete "${confirmDelete.name}"? Stores tagged to it will not be deleted.`}
          confirmLabel="Delete"
          onConfirm={async () => { await handleDelete(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
