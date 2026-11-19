import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Calendar, CalendarClock, Edit, Eye, Loader2, MapPin, Megaphone, MousePointerClick, Plus, Send, TestTube2, Trash2, Upload, UserCheck, Users, X } from 'lucide-react';
import { productsApi, promotionsApi, type AudienceCohort, type Promotion, type PromotionAudienceCustomer, type PromotionAudienceCustomers, type PromotionInput, type PromotionPreview, type PromotionTestResult, type PromotionType, zonesApi } from '../services/api';
import PageSkeleton from '../components/PageSkeleton';

interface Zone { id: string; name: string; isActive?: boolean; }
interface AudienceScope { zoneIds: string[]; cohorts: AudienceCohort[]; }
interface ContentPreview { title: string; body: string; imageUrl: string | null; destinationUrl: string; }
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white';
const types: { value: PromotionType; label: string }[] = [
  { value: 'new_product', label: 'New product' }, { value: 'combo', label: 'Combo' }, { value: 'offer', label: 'Offer' },
  { value: 'back_in_stock', label: 'Back in stock' }, { value: 'we_miss_you', label: 'We miss you' }, { value: 'custom', label: 'Custom' },
];
const cohorts: { value: AudienceCohort; label: string; description: string }[] = [
  { value: 'recent_purchaser', label: 'Recent purchaser', description: 'Last delivery 3-<7 days ago' },
  { value: 'winback_7', label: 'Win-back: 7 days', description: 'Last delivery 7-<14 days ago' },
  { value: 'winback_15', label: 'Win-back: 15 days', description: 'Last delivery 14-<30 days ago' },
  { value: 'winback_30', label: 'Win-back: 30+ days', description: 'Last delivery 30+ days ago' },
  { value: 'first_order_followup', label: 'First-order follow-up', description: 'One delivery, at least 7 days ago' },
  { value: 'repeat_buyer', label: 'Repeat buyer', description: 'Three or more delivered orders, any recency' },
  { value: 'signed_in_no_order', label: 'Signed-in: no order yet', description: 'OTP-verified, zero delivered orders' },
  { value: 'signed_in_one_order', label: 'Signed-in: one order', description: 'OTP-verified, exactly one delivered order' },
  { value: 'signed_in_repeat_lapsed_7', label: 'Signed-in: 3+ orders, quiet 7+ days', description: 'OTP-verified, 3+ delivered, last delivery 7+ days ago' },
  { value: 'guest_0_1_delivered', label: 'Guest: 0-1 delivered', description: 'No login, zero or one delivered order' },
  { value: 'guest_2_plus_delivered', label: 'Guest: 2+ delivered', description: 'No login, two or more delivered orders' },
];
const initialForm: PromotionInput = { type: 'offer', title: '', body: '', destinationUrl: '/', zoneIds: [], audienceRules: { cohorts: [] }, scheduledAt: null };

function WhatsAppIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'history' | 'analytics'>('history');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromotionInput>(initialForm);
  const [audiencePreview, setAudiencePreview] = useState<PromotionPreview | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [contentPreview, setContentPreview] = useState<ContentPreview | null>(null);
  const [audienceCustomersOpen, setAudienceCustomersOpen] = useState(false);
  const [audienceCustomers, setAudienceCustomers] = useState<PromotionAudienceCustomers | null>(null);
  const [customerScope, setCustomerScope] = useState<AudienceScope | null>(null);
  const [customerCohort, setCustomerCohort] = useState<AudienceCohort | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<Promotion | null>(null);
  const [scheduleForm, setScheduleForm] = useState<{ zoneIds: string[]; scheduledAt: string | null }>({ zoneIds: [], scheduledAt: null });
  const [scheduleError, setScheduleError] = useState('');
  const [testResult, setTestResult] = useState<PromotionTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [originalForm, setOriginalForm] = useState<PromotionInput>(initialForm);
  const [error, setError] = useState('');

  const load = async () => {
    const [promotionResponse, zoneResponse] = await Promise.all([promotionsApi.getAll(), zonesApi.getAll()]);
    setPromotions(promotionResponse.data.data);
    setZones((zoneResponse.data.data || []).filter((zone: Zone) => zone.isActive !== false));
  };

  useEffect(() => { load().catch(() => setError('Could not load promotions')).finally(() => setLoading(false)); }, []);

  useEffect(() => {
    if (!composerOpen) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setAudienceLoading(true);
      try {
        const response = await promotionsApi.previewAudience({ zoneIds: form.zoneIds, audienceRules: form.audienceRules });
        if (!cancelled) setAudiencePreview(response.data.data);
      } catch {
        if (!cancelled) setAudiencePreview(null);
      } finally {
        if (!cancelled) setAudienceLoading(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [composerOpen, form.zoneIds, form.audienceRules]);

  const openNew = () => {
    setActiveTab('history');
    setComposerOpen(true);
    setEditing(null);
    setForm(initialForm);
    setOriginalForm(initialForm);
    setAudiencePreview(null);
    setError('');
  };
  const openEdit = (promotion: Promotion) => {
    setActiveTab('history');
    setComposerOpen(true);
    setEditing(promotion);
    const nextForm = { type: promotion.type, title: promotion.title, body: promotion.body, imageUrl: promotion.image_url, destinationUrl: promotion.destination_url, zoneIds: promotion.zone_ids || [], audienceRules: promotion.audience_rules || { cohorts: [] }, scheduledAt: formatPromotionScheduleForInput(promotion.scheduled_at) };
    setForm(nextForm);
    setOriginalForm(nextForm);
    setAudiencePreview(null);
    setError('');
  };
  const close = () => {
    setComposerOpen(false);
    setEditing(null);
    setForm(initialForm);
    setOriginalForm(initialForm);
    setAudiencePreview(null);
  };
  const save = async (): Promise<Promotion | null> => {
    setBusy(true);
    setError('');
    try {
      const response = editing ? await promotionsApi.update(editing.id, form) : await promotionsApi.create(form);
      const saved = response.data.data;
      setEditing(saved);
      setOriginalForm(form);
      await load();
      return saved;
    } catch (caught: unknown) {
      setError(message(caught, 'Could not save draft'));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const imageUrl = (await productsApi.uploadPhoto(file, undefined, undefined, 'banner')).data.data.url;
      setForm(current => ({ ...current, imageUrl }));
    } catch (caught: unknown) {
      setError(message(caught, 'Image upload failed'));
    } finally {
      setBusy(false);
    }
  };
  const action = async (promotion: Promotion, kind: 'test' | 'send' | 'delete') => {
    if (kind === 'send' && !window.confirm('Send this promotion now to its eligible audience? This cannot be undone.')) return;
    if (kind === 'delete' && !window.confirm('Delete this draft promotion?')) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'test') setTestResult((await promotionsApi.test(promotion.id)).data.data);
      if (kind === 'send') {
        const result = (await promotionsApi.send(promotion.id)).data.data;
        window.alert(`Send complete: ${result.sent} delivered to ${result.recipients} recipients; ${result.failed} failed.`);
        if (editing?.id === promotion.id) close();
      }
      if (kind === 'delete') {
        if (editing?.id === promotion.id) close();
        await promotionsApi.delete(promotion.id);
      }
      await load();
    } catch (caught: unknown) {
      setError(message(caught, 'Promotion action failed'));
    } finally {
      setBusy(false);
    }
  };
  const toggleZone = (zoneId: string) => setForm(current => ({ ...current, zoneIds: current.zoneIds?.includes(zoneId) ? current.zoneIds.filter(id => id !== zoneId) : [...(current.zoneIds || []), zoneId] }));
  const toggleCohort = (cohort: AudienceCohort) => setForm(current => {
    const selected = current.audienceRules?.cohorts || [];
    return { ...current, audienceRules: { cohorts: selected.includes(cohort) ? selected.filter(value => value !== cohort) : [...selected, cohort] } };
  });
  const cohortCount = (cohort: AudienceCohort) => audiencePreview?.cohorts?.find(item => item.cohort === cohort)?.count ?? null;
  const composerScope: AudienceScope = { zoneIds: form.zoneIds || [], cohorts: form.audienceRules?.cohorts || [] };

  const loadCustomers = async (scope: AudienceScope, cohort: AudienceCohort | null, offset: number) => {
    setAudienceCustomersOpen(true);
    setCustomerLoading(true);
    setCustomerError('');
    if (offset === 0) {
      setCustomerScope(scope);
      setCustomerCohort(cohort);
      setAudienceCustomers(null);
    }
    try {
      const response = await promotionsApi.audienceCustomers({ zoneIds: scope.zoneIds, audienceRules: { cohorts: scope.cohorts }, cohort, limit: 25, offset });
      const data = response.data.data;
      setAudienceCustomers(current => offset === 0 || !current ? data : { ...data, customers: [...current.customers, ...data.customers] });
    } catch (caught: unknown) {
      setCustomerError(message(caught, 'Could not load audience customers'));
    } finally {
      setCustomerLoading(false);
    }
  };
  const openAudience = (scope: AudienceScope, cohort: AudienceCohort | null = null) => { void loadCustomers(scope, cohort, 0); };
  const openSchedule = (promotion?: Promotion) => {
    setScheduleTarget(promotion || null);
    setScheduleForm({
      zoneIds: promotion ? promotion.zone_ids || [] : form.zoneIds || [],
      scheduledAt: promotion ? formatPromotionScheduleForInput(promotion.scheduled_at) : form.scheduledAt || null,
    });
    setScheduleError('');
    setScheduleOpen(true);
  };
  const toggleScheduleZone = (zoneId: string) => setScheduleForm(current => ({ ...current, zoneIds: current.zoneIds.includes(zoneId) ? current.zoneIds.filter(id => id !== zoneId) : [...current.zoneIds, zoneId] }));
  const saveSchedule = async () => {
    if (!scheduleForm.zoneIds.length) { setScheduleError('Select at least one zone to schedule this promotion.'); return; }
    if (!scheduleForm.scheduledAt) { setScheduleError('Choose a scheduled time.'); return; }
    setBusy(true);
    setScheduleError('');
    try {
      if (scheduleTarget) {
        await promotionsApi.update(scheduleTarget.id, { zoneIds: scheduleForm.zoneIds, scheduledAt: scheduleForm.scheduledAt });
      } else if (editing) {
        const saved = (await promotionsApi.update(editing.id, { ...form, zoneIds: scheduleForm.zoneIds, scheduledAt: scheduleForm.scheduledAt })).data.data;
        setEditing(saved);
      } else {
        const saved = (await promotionsApi.create({ ...form, zoneIds: scheduleForm.zoneIds, scheduledAt: scheduleForm.scheduledAt })).data.data;
        setEditing(saved);
      }
      setForm(current => ({ ...current, zoneIds: scheduleForm.zoneIds, scheduledAt: scheduleForm.scheduledAt }));
      setScheduleOpen(false);
      await load();
    } catch (caught: unknown) {
      setScheduleError(message(caught, 'Could not schedule promotion'));
    } finally {
      setBusy(false);
    }
  };

  const sentPromotions = promotions.filter(promotion => promotion.status === 'sent');
  const totals = sentPromotions.reduce((summary, promotion) => ({
    recipients: summary.recipients + Number(promotion.recipient_count || 0),
    delivered: summary.delivered + Number(promotion.delivery_count || promotion.deliveredCount || 0),
    failed: summary.failed + Number(promotion.fail_count || 0),
    clicks: summary.clicks + Number(promotion.clickCount || 0),
  }), { recipients: 0, delivered: 0, failed: 0, clicks: 0 });

  if (loading) return <PageSkeleton />;
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm text-gray-500 dark:text-slate-400">Zone-aware web push for opted-in customers.</p></div>
      <button onClick={openNew} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" /> New promotion</button>
    </div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
    <div role="tablist" aria-label="Promotion views" className="flex w-fit gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-800">
      <button id="history-tab" role="tab" aria-selected={activeTab === 'history'} aria-controls="history-panel" onClick={() => setActiveTab('history')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${activeTab === 'history' ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300' : 'text-gray-600 dark:text-slate-300'}`}>History</button>
      <button id="analytics-tab" role="tab" aria-selected={activeTab === 'analytics'} aria-controls="analytics-panel" onClick={() => setActiveTab('analytics')} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold ${activeTab === 'analytics' ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300' : 'text-gray-600 dark:text-slate-300'}`}><BarChart3 className="h-3.5 w-3.5" /> Analytics</button>
    </div>
    {activeTab === 'history' && <div id="history-panel" role="tabpanel" aria-labelledby="history-tab" className="space-y-3">
    {composerOpen && <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Draft promotion' : 'New promotion'}</h2><button aria-label="Close promotion composer" title="Close composer" onClick={close} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button></div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{types.map(type => <button key={type.value} onClick={() => setForm(current => ({ ...current, type: type.value }))} className={`rounded-lg border px-2 py-2 text-xs font-medium ${form.type === type.value ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'}`}>{type.label}</button>)}</div>
        <input value={form.title} maxLength={240} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} className={input} placeholder="Notification title" />
        <div className="flex flex-wrap gap-1">{['☀️','🌧️','☔','🎉','🛒','🔥','✨','🎁','📢','❤️'].map(emoji => <button key={emoji} type="button" onClick={() => setForm(current => ({ ...current, title: `${current.title}${current.title ? ' ' : ''}${emoji}`.trim() }))} className="rounded-lg border border-gray-200 px-2 py-1 text-sm dark:border-slate-600">{emoji}</button>)}</div>
        <textarea value={form.body} maxLength={240} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} className={`${input} min-h-20`} placeholder="Notification body" />
        <input value={form.destinationUrl} onChange={event => setForm(current => ({ ...current, destinationUrl: event.target.value }))} className={input} placeholder="Destination, e.g. /products" />
        <div className="grid gap-2 sm:grid-cols-2"><input value={form.imageUrl || ''} onChange={event => setForm(current => ({ ...current, imageUrl: event.target.value || null }))} className={input} placeholder="Image URL (optional)" /><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-slate-600 dark:text-slate-300"><Upload className="h-4 w-4" /> Upload image<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => event.target.files?.[0] && upload(event.target.files[0])} /></label></div>
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-700 dark:text-slate-200">Audience cohorts <span className="font-normal text-gray-500">Leave clear for all consented subscribers.</span></p><button onClick={() => openAudience(composerScope)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:border-slate-600 dark:text-slate-200"><Users className="h-3.5 w-3.5" /> Audience customers{audiencePreview ? ` (${audiencePreview.matchedCustomers})` : ''}</button></div>
          <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">Selected cohorts are ORed. Zones then narrow the result. Guest cohorts also need guest marketing consent and a linked push subscription.</p>
          <div className="grid gap-2 sm:grid-cols-2">{cohorts.map(cohort => {
            const count = cohortCount(cohort.value);
            return <div key={cohort.value} className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-slate-600">
              <input id={`cohort-${cohort.value}`} type="checkbox" className="mt-0.5" checked={form.audienceRules?.cohorts.includes(cohort.value) || false} onChange={() => toggleCohort(cohort.value)} />
              <div className="min-w-0 flex-1"><label htmlFor={`cohort-${cohort.value}`} className="block cursor-pointer font-semibold text-gray-800 dark:text-slate-100">{cohort.label}</label><span className="text-gray-500 dark:text-slate-400">{cohort.description}</span>{form.audienceRules?.cohorts.includes(cohort.value) && <span className="ml-2 whitespace-nowrap rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{audienceLoading ? '...' : count === null ? 'Unavailable' : `${count} customers`}</span>}</div>
              {form.audienceRules?.cohorts.includes(cohort.value) && <button title={`View ${cohort.label} customers`} aria-label={`View ${cohort.label} customers`} onClick={() => openAudience(composerScope, cohort.value)} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Eye className="h-3.5 w-3.5" /></button>}
            </div>;
          })}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-slate-300"><span className="flex items-center gap-1"><UserCheck className="h-4 w-4" /> {audienceLoading ? 'Calculating audience...' : `Audience: ${audiencePreview?.matchedCustomers ?? 0} customers · ${audiencePreview?.recipients ?? 0} eligible to receive`}</span>{audiencePreview && <button onClick={() => openAudience(composerScope)} className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">View customer details</button>}</div>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-700 dark:text-slate-200">Zones <span className="font-normal text-gray-500">Choose zones while scheduling.</span></p><button onClick={() => openSchedule()} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:border-slate-600 dark:text-slate-200"><CalendarClock className="h-3.5 w-3.5" /> Schedule</button></div>
          <div className="flex flex-wrap gap-2">{zones.map(zone => <label key={zone.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-slate-600"><input type="checkbox" checked={form.zoneIds?.includes(zone.id) || false} onChange={() => toggleZone(zone.id)} />{zone.name}</label>)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !form.title.trim() || !form.body.trim() || !form.destinationUrl.startsWith('/')} onClick={() => setContentPreview({ title: form.title, body: form.body, imageUrl: form.imageUrl || null, destinationUrl: form.destinationUrl })} className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"><Eye className="h-4 w-4" /> Preview</button>
          <button disabled={busy || !form.title.trim() || !form.body.trim() || !form.destinationUrl.startsWith('/') || JSON.stringify(form) === JSON.stringify(originalForm)} onClick={() => { void save(); }} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save draft' : 'Create draft'}</button>
          {editing?.status === 'draft' && <><button disabled={busy} onClick={() => action(editing, 'test')} className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600"><TestTube2 className="h-4 w-4" /> Test send</button><button disabled={busy} onClick={() => action(editing, 'send')} className="flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white"><Send className="h-4 w-4" /> Send now</button></>}
        </div>
      </div>
    </section>}
    {promotions.length === 0 ? <div className="border-y border-gray-200 py-8 text-center dark:border-slate-700"><Megaphone className="mx-auto h-5 w-5 text-gray-400" /><p className="mt-2 text-sm font-semibold text-gray-800 dark:text-white">No promotions yet</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Create a draft when you are ready to message eligible customers.</p><button onClick={openNew} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" /> New promotion</button></div> : <section className="space-y-2">{promotions.map(promotion => {
      const delivered = promotion.delivery_count || promotion.deliveredCount || 0;
      const clicks = promotion.clickCount || 0;
      const scope: AudienceScope = { zoneIds: promotion.zone_ids || [], cohorts: promotion.audience_rules?.cohorts || [] };
      const draftTargeting = `${promotion.zone_ids?.length ? `${promotion.zone_ids.length} selected zone${promotion.zone_ids.length === 1 ? '' : 's'}` : 'All zones'} · ${promotion.audience_rules?.cohorts.length ? promotion.audience_rules.cohorts.map(value => cohorts.find(cohort => cohort.value === value)?.label || value).join(', ') : 'All consented subscribers'}`;
      return <article key={promotion.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-bold text-gray-900 dark:text-white">{promotion.title}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${promotion.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : promotion.status === 'sending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>{promotion.status}</span></div><p className="mt-1 truncate text-xs text-gray-500 dark:text-slate-400">{promotion.body}</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{promotion.status === 'sent' ? `${promotion.recipient_count} recipients · ${delivered} accepted deliveries · ${promotion.fail_count} failures · ${clicks} clicks · ${rate(clicks, promotion.recipient_count)} click rate` : promotion.status === 'sending' ? 'Sending to the eligible audience...' : `${draftTargeting}${promotion.scheduled_at ? ` · Scheduled ${formatScheduleDisplay(promotion.scheduled_at)}` : ''}`}</p></div><div className="flex shrink-0 gap-1"><button title="Preview notification" aria-label="Preview notification" onClick={() => setContentPreview({ title: promotion.title, body: promotion.body, imageUrl: promotion.image_url, destinationUrl: promotion.destination_url })} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Eye className="h-4 w-4" /></button>{promotion.status === 'draft' && <><button title="Edit draft" aria-label="Edit draft" onClick={() => openEdit(promotion)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Edit className="h-4 w-4" /></button><button title="View audience customers" aria-label="View audience customers" onClick={() => openAudience(scope)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Users className="h-4 w-4" /></button><button title="Schedule draft" aria-label="Schedule draft" onClick={() => openSchedule(promotion)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><CalendarClock className="h-4 w-4" /></button><button title="Delete draft" aria-label="Delete draft" onClick={() => action(promotion, 'delete')} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></>}</div></article>;
    })}</section>}
    </div>}
    {activeTab === 'analytics' && <section id="analytics-panel" role="tabpanel" aria-labelledby="analytics-tab" className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><Metric label="Sent" value={sentPromotions.length} /><Metric label="Recipients" value={totals.recipients} /><Metric label="Accepted" value={totals.delivered} /><Metric label="Failed" value={totals.failed} /><Metric label="Clicks" value={totals.clicks} icon /><Metric label="Click rate" value={rate(totals.clicks, totals.recipients)} /></div><div className="overflow-x-auto border-y border-gray-200 dark:border-slate-700"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-gray-500 dark:text-slate-400"><tr><th className="px-3 py-2 font-semibold">Promotion</th><th className="px-3 py-2 font-semibold">Recipients</th><th className="px-3 py-2 font-semibold">Accepted</th><th className="px-3 py-2 font-semibold">Failed</th><th className="px-3 py-2 font-semibold">Clicks</th><th className="px-3 py-2 font-semibold">Click rate</th></tr></thead><tbody>{sentPromotions.map(promotion => <tr key={promotion.id} className="border-t border-gray-100 dark:border-slate-800"><td className="px-3 py-2 font-semibold text-gray-800 dark:text-slate-100">{promotion.title}</td><td className="px-3 py-2">{promotion.recipient_count}</td><td className="px-3 py-2">{promotion.delivery_count || promotion.deliveredCount || 0}</td><td className="px-3 py-2">{promotion.fail_count || 0}</td><td className="px-3 py-2">{promotion.clickCount || 0}</td><td className="px-3 py-2">{rate(promotion.clickCount || 0, promotion.recipient_count)}</td></tr>)}{sentPromotions.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 dark:text-slate-400">No sent promotions to analyse.</td></tr>}</tbody></table></div></section>}

    {contentPreview && <Modal title="Notification preview" onClose={() => setContentPreview(null)} footer={composerOpen ? <><button onClick={() => setContentPreview(null)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600">Close</button><button disabled={busy} onClick={async () => { const saved = await save(); if (saved) setContentPreview(null); }} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save draft'}</button></> : <button onClick={() => setContentPreview(null)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600">Close</button>}>
      <NotificationPreview {...contentPreview} />
    </Modal>}

    {audienceCustomersOpen && <Modal title={`Audience customers${customerCohort ? ` · ${cohorts.find(cohort => cohort.value === customerCohort)?.label || customerCohort}` : ''}`} onClose={() => setAudienceCustomersOpen(false)}>
      {customerError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{customerError}</p>}
      <p className="mb-3 text-xs text-gray-500 dark:text-slate-400">{audienceCustomers ? `${audienceCustomers.total} customer${audienceCustomers.total === 1 ? '' : 's'}${customerCohort ? ' in this cohort' : ''} in this audience.` : 'Loading customers...'}</p>
      <div className="space-y-2">{audienceCustomers?.customers.map(customer => <div key={customer.id} className="rounded-lg border border-gray-200 p-3 text-xs dark:border-slate-700"><div className="flex items-stretch gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-gray-900 dark:text-white">{customer.name || 'Unnamed customer'} · {customer.phone}</p></div><p className="mt-0.5 text-[10px] font-medium text-gray-500 dark:text-slate-400">{customer.isSignedIn ? 'Signed in' : 'Guest'} · {customer.deliveredOrders} delivered · {customer.eligible ? 'Eligible' : customer.exclusionReason || 'Not eligible'}</p><p className="mt-2 flex items-start gap-1.5 text-gray-600 dark:text-slate-300"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{customer.address || 'No address on file'}{customer.address2 ? `, ${customer.address2}` : ''}</span></p><p className="mt-1 flex items-center gap-1.5 text-gray-500 dark:text-slate-400"><Calendar className="h-3.5 w-3.5" /> {customer.lastDeliveredAt ? `Last delivered ${new Date(customer.lastDeliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No delivered orders'}</p></div><a href={whatsappHref(customer)} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center justify-center self-stretch aspect-square text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"><WhatsAppIcon className="h-5 w-5" /></a></div></div>)}</div>
      {audienceCustomers && audienceCustomers.customers.length < audienceCustomers.total && <button disabled={customerLoading} onClick={() => { if (customerScope) void loadCustomers(customerScope, customerCohort, audienceCustomers.customers.length); }} className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-slate-600">{customerLoading ? 'Loading...' : 'Load more'}</button>}
      {customerLoading && !audienceCustomers && <div className="flex items-center justify-center py-8 text-gray-500 dark:text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}
    </Modal>}

    {scheduleOpen && <Modal title={scheduleTarget ? 'Schedule promotion' : 'Schedule draft'} onClose={() => setScheduleOpen(false)} footer={<><button onClick={() => setScheduleOpen(false)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600">Cancel</button><button disabled={busy} onClick={saveSchedule} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save schedule'}</button></>}>
      <div className="space-y-4">
        {scheduleError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{scheduleError}</p>}
        <div><p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">Target zones</p><div className="flex flex-wrap gap-2">{zones.map(zone => <label key={zone.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-slate-600"><input type="checkbox" checked={scheduleForm.zoneIds.includes(zone.id)} onChange={() => toggleScheduleZone(zone.id)} />{zone.name}</label>)}</div></div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-slate-200">Scheduled time<input type="datetime-local" value={scheduleForm.scheduledAt || ''} onChange={event => setScheduleForm(current => ({ ...current, scheduledAt: event.target.value || null }))} className={`${input} mt-1`} /><span className="mt-1 block font-normal text-gray-500">Promotions may be scheduled between 09:00 and 20:59 Asia/Kolkata.</span></label>
      </div>
    </Modal>}

    {testResult && <Modal title="Test send results" onClose={() => setTestResult(null)} footer={<button onClick={() => setTestResult(null)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600">Close</button>}>
      <p className="mb-3 text-xs text-gray-500 dark:text-slate-400">{testResult.sent} sent, {testResult.failed} failed across {testResult.recipients} test customer{testResult.recipients === 1 ? '' : 's'}.</p>
      <div className="space-y-2">{testResult.targets.map(target => {
        const status = target.note || (target.sent === 0 ? 'Failed' : target.failed > 0 ? 'Partial' : 'Sent');
        const tone = status === 'Sent' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
        return <div key={target.phone} className="rounded-lg border border-gray-200 p-3 text-xs dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-gray-900 dark:text-white">{target.name || 'Test recipient'} · {target.phone}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{status}</span></div>{!target.note && <p className="mt-1 text-gray-500 dark:text-slate-400">{target.subscriptions} subscription{target.subscriptions === 1 ? '' : 's'} · {target.sent} sent · {target.failed} failed</p>}</div>;
      })}</div>
    </Modal>}
  </div>;
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-800" onClick={event => event.stopPropagation()}><div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2><button aria-label="Close dialog" title="Close" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button></div>{children}{footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}</div></div>;
}

function NotificationPreview({ title, body, imageUrl }: ContentPreview) {
  return <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900"><div className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">{imageUrl && <img src={imageUrl} alt="" className="mb-3 h-36 w-full rounded-lg object-cover" />}<p className="text-sm font-bold text-gray-900 dark:text-white">{title}</p><p className="mt-1 whitespace-pre-wrap text-xs text-gray-600 dark:text-slate-300">{body}</p></div></div>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon?: boolean }) {
  return <div className="border-l-2 border-emerald-500 pl-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className="mt-1 flex items-center gap-1 text-lg font-bold text-gray-900 dark:text-white">{icon && <MousePointerClick className="h-4 w-4 text-emerald-600" />}{value}</p></div>;
}

function rate(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '0.0%';
}

function formatPromotionScheduleForInput(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function formatScheduleDisplay(value: string): string {
  const local = formatPromotionScheduleForInput(value);
  return local ? `${local.replace('T', ' ')} IST` : value;
}

function whatsappHref(customer: PromotionAudienceCustomer): string {
  const digits = customer.phone.replace(/\D/g, '');
  const number = digits.length === 10 ? `91${digits}` : digits;
  const text = encodeURIComponent(`Hi ${customer.name || 'there'}, check out our latest offer!`);
  return `https://wa.me/${number}?text=${text}`;
}

function message(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { error?: string } } };
  return maybe.response?.data?.error || fallback;
}
