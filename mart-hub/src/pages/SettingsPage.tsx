import { useEffect, useState } from 'react';
import { Loader2, Save, Upload, MapPin, Plus, Trash2, Pencil, X } from 'lucide-react';
import { settingsApi, productsApi, zonesApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';

interface Setting { key: string; value: string; label: string; }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const GROUPS = [
  { title: 'Store',              keys: ['store_name', 'store_address', 'delivery_area', 'estimated_delivery', 'store_open'] },
  { title: 'Delivery & Pricing', keys: ['delivery_charge', 'free_delivery_above', 'min_order_amount'] },
  { title: 'Customer Support Contact', keys: ['whatsapp_number', 'support_name', 'support_phone'] },
  { title: 'Payment Methods',    keys: ['cod_enabled', 'upi_enabled', 'upi_id', 'upi_phone', 'upi_qr_enabled', 'phonepay_qr_url'] },
];

const BOOLEAN_KEYS = new Set(['store_open', 'cod_enabled', 'upi_enabled', 'upi_qr_enabled']);

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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [addingZone, setAddingZone] = useState(false);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [savingZone, setSavingZone] = useState(false);

  const loadZones = async () => { const zr = await zonesApi.getAll(getActiveStoreId()); setZones(zr.data.data || []); };

  useEffect(() => {
    Promise.all([settingsApi.getAll(getActiveStoreId()), zonesApi.getAll(getActiveStoreId())]).then(([r, zr]) => {
      setZones(zr.data.data || []);
      const map: Record<string, Setting> = {};
      const vals: Record<string, string> = {};
      for (const s of (r.data.data || [])) { map[s.key] = s; vals[s.key] = s.value; }
      setSettings(map);
      setValues(vals);
      if (vals.phonepay_qr_url) setQrPreview(vals.phonepay_qr_url);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      let updatedValues = { ...values };
      if (qrFile) {
        const res = await productsApi.uploadPhoto(qrFile);
        updatedValues.phonepay_qr_url = res.data.data.url;
        setValues(v => ({ ...v, phonepay_qr_url: res.data.data.url }));
      }
      await settingsApi.update(updatedValues, getActiveStoreId());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert(`Failed to save: ${err?.response?.data?.error || err?.message}`);
    } finally { setSaving(false); }
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

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> {saved ? 'Saved ✓' : 'Save Changes'}</>}
        </button>
      </div>

      {GROUPS.map(group => (
        <div key={group.title} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-700">
            <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{group.title}</h2>
          </div>
          <div className="p-4 space-y-4">
            {group.keys.map(key => {
              const setting = settings[key];
              if (!setting) return null;

              // UPI QR upload
              if (key === 'phonepay_qr_url') {
                const qrEnabled = values['upi_qr_enabled'] === 'true';
                if (!qrEnabled) return null;
                return (
                  <div key={key} className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">UPI QR Code</label>
                    <div className="flex items-center gap-3">
                      {qrPreview ? (
                        <img src={qrPreview} alt="UPI QR" className="w-20 h-20 rounded-xl object-contain border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700" />
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-gray-100 dark:bg-slate-700 border border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center">
                          <span className="text-xs text-gray-400 dark:text-slate-500">No QR</span>
                        </div>
                      )}
                      <label className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">
                        <Upload className="w-3.5 h-3.5" /> {qrPreview ? 'Change QR' : 'Upload QR'}
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setQrFile(f); setQrPreview(URL.createObjectURL(f)); } }} />
                      </label>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">Upload any UPI QR code (PhonePe, GPay, Paytm, etc.)</p>
                  </div>
                );
              }

              if (BOOLEAN_KEYS.has(key)) {
                const label = key === 'upi_qr_enabled' ? 'Accept UPI QR Payments' : setting.label;
                return (
                  <div key={key} className="flex items-center justify-between py-0.5">
                    <label className="text-sm text-gray-700 dark:text-slate-300">{label}</label>
                    <Toggle checked={values[key] === 'true'} onChange={() => setValues(v => ({ ...v, [key]: v[key] === 'true' ? 'false' : 'true' }))} />
                  </div>
                );
              }

              return (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">{setting.label}</label>
                  <input type="text" value={values[key] || ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} className={inp} placeholder={setting.label} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Delivery Zones */}
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
          <div className="text-center py-8 text-gray-400 dark:text-slate-500">
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
                    <p className="text-xs text-gray-400 dark:text-slate-500">{zone.radiusKm}km radius · {zone.lat}, {zone.lng}</p>
                  </div>
                  <Toggle
                    checked={zone.isActive}
                    onChange={async () => { await zonesApi.update(zone.id, { isActive: !zone.isActive }); await loadZones(); }}
                  />
                  <button onClick={() => { setEditingZone({ ...zone, lat: String(zone.lat), lng: String(zone.lng), radiusKm: String(zone.radiusKm) }); setAddingZone(false); }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={async () => { if (!window.confirm('Delete zone ' + zone.name + '?')) return; await zonesApi.delete(zone.id); await loadZones(); }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
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
