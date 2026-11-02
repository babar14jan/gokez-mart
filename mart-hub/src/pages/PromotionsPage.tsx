import { useEffect, useState } from 'react';
import { BarChart3, Loader2, Megaphone, MousePointerClick, Plus, Send, TestTube2, Trash2, Upload, Users, X } from 'lucide-react';
import { productsApi, promotionsApi, type AudienceCohort, type Promotion, type PromotionInput, type PromotionPreview, type PromotionType, zonesApi } from '../services/api';
import PageSkeleton from '../components/PageSkeleton';

interface Zone { id: string; name: string; isActive?: boolean; }
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
  { value: 'repeat_buyer', label: 'Repeat buyer', description: 'Three or more delivered orders' },
];
const initialForm: PromotionInput = { type: 'offer', title: '', body: '', destinationUrl: '/', zoneIds: [], audienceRules: { cohorts: [] }, scheduledAt: null };

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'history' | 'analytics'>('history');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromotionInput>(initialForm);
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [promotionResponse, zoneResponse] = await Promise.all([promotionsApi.getAll(), zonesApi.getAll()]);
    setPromotions(promotionResponse.data.data);
    setZones((zoneResponse.data.data || []).filter((zone: Zone) => zone.isActive !== false));
  };

  useEffect(() => { load().catch(() => setError('Could not load promotions')).finally(() => setLoading(false)); }, []);
  const openNew = () => { setActiveTab('history'); setComposerOpen(true); setEditing(null); setForm(initialForm); setPreview(null); setError(''); };
  const openEdit = (promotion: Promotion) => {
    setActiveTab('history'); setComposerOpen(true);
    setEditing(promotion);
    setForm({ type: promotion.type, title: promotion.title, body: promotion.body, imageUrl: promotion.image_url, destinationUrl: promotion.destination_url, zoneIds: promotion.zone_ids || [], audienceRules: promotion.audience_rules || { cohorts: [] }, scheduledAt: formatPromotionScheduleForInput(promotion.scheduled_at) });
    setPreview(null); setError('');
  };
  const close = () => { setComposerOpen(false); setEditing(null); setForm(initialForm); setPreview(null); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      const response = editing ? await promotionsApi.update(editing.id, form) : await promotionsApi.create(form);
      const saved = response.data.data;
      setEditing(saved);
      setPreview((await promotionsApi.preview(saved.id)).data.data);
      await load();
    } catch (caught: unknown) { setError(message(caught, 'Could not save draft')); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setError('');
    try {
      const imageUrl = (await productsApi.uploadPhoto(file)).data.data.url;
      setForm(current => ({ ...current, imageUrl }));
    }
    catch (caught: unknown) { setError(message(caught, 'Image upload failed')); }
    finally { setBusy(false); }
  };
  const action = async (promotion: Promotion, kind: 'preview' | 'test' | 'send' | 'delete') => {
    if (kind === 'send' && !window.confirm(`Send this promotion now to its eligible audience? This cannot be undone.`)) return;
    if (kind === 'delete' && !window.confirm('Delete this draft promotion?')) return;
    setBusy(true); setError('');
    try {
      if (kind === 'preview') { setPreview((await promotionsApi.preview(promotion.id)).data.data); openEdit(promotion); }
      if (kind === 'test') { const result = (await promotionsApi.test(promotion.id)).data.data; window.alert(`Test send complete: ${result.sent} delivered, ${result.failed} failed.`); }
      if (kind === 'send') { const result = (await promotionsApi.send(promotion.id)).data.data; window.alert(`Send complete: ${result.sent} delivered to ${result.recipients} recipients; ${result.failed} failed.`); close(); }
      if (kind === 'delete') {
        close();
        await promotionsApi.delete(promotion.id);
      }
      await load();
    } catch (caught: unknown) { setError(message(caught, 'Promotion action failed')); }
    finally { setBusy(false); }
  };
  const toggleZone = (zoneId: string) => setForm(current => ({ ...current, zoneIds: current.zoneIds?.includes(zoneId) ? current.zoneIds.filter(id => id !== zoneId) : [...(current.zoneIds || []), zoneId] }));
  const toggleCohort = (cohort: AudienceCohort) => setForm(current => {
    const selected = current.audienceRules?.cohorts || [];
    return { ...current, audienceRules: { cohorts: selected.includes(cohort) ? selected.filter(value => value !== cohort) : [...selected, cohort] } };
  });

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
        <textarea value={form.body} maxLength={240} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} className={`${input} min-h-20`} placeholder="Notification body" />
        <input value={form.destinationUrl} onChange={event => setForm(current => ({ ...current, destinationUrl: event.target.value }))} className={input} placeholder="Destination, e.g. /products" />
        <div className="grid gap-2 sm:grid-cols-2"><input value={form.imageUrl || ''} onChange={event => setForm(current => ({ ...current, imageUrl: event.target.value || null }))} className={input} placeholder="Image URL (optional)" /><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-slate-600 dark:text-slate-300"><Upload className="h-4 w-4" /> Upload image<input type="file" accept="image/*" className="hidden" onChange={event => event.target.files?.[0] && upload(event.target.files[0])} /></label></div>
        <div><p className="mb-1 text-xs font-semibold text-gray-700 dark:text-slate-200">Audience cohorts <span className="font-normal text-gray-500">Leave clear for all consented subscribers.</span></p><p className="mb-2 text-xs text-gray-500 dark:text-slate-400">Selected cohorts are ORed. Zones then narrow the result.</p><div className="grid gap-2 sm:grid-cols-2">{cohorts.map(cohort => <label key={cohort.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-slate-600"><input type="checkbox" className="mt-0.5" checked={form.audienceRules?.cohorts.includes(cohort.value) || false} onChange={() => toggleCohort(cohort.value)} /><span><span className="block font-semibold text-gray-800 dark:text-slate-100">{cohort.label}</span><span className="text-gray-500 dark:text-slate-400">{cohort.description}</span></span></label>)}</div></div>
        <div><p className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">Zones <span className="font-normal text-gray-500">Leave clear for all zones</span></p><div className="flex flex-wrap gap-2">{zones.map(zone => <label key={zone.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-slate-600"><input type="checkbox" checked={form.zoneIds?.includes(zone.id) || false} onChange={() => toggleZone(zone.id)} />{zone.name}</label>)}</div></div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-slate-200">Scheduled time <span className="font-normal text-gray-500">Leave blank to send manually.</span><input type="datetime-local" value={form.scheduledAt || ''} onChange={event => setForm(current => ({ ...current, scheduledAt: event.target.value || null }))} className={`${input} mt-1`} /><span className="mt-1 block font-normal text-gray-500">Promotions may be scheduled or sent from 09:00 to 20:59 Asia/Kolkata.</span></label>
        {preview && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><div className="flex items-center gap-2"><Users className="h-4 w-4" /> Eligible audience: {preview.recipients} customers, {preview.subscriptions} subscribed devices.</div><p className="mt-2 text-emerald-700 dark:text-emerald-300">Sequential filters: consent, subscription, targeting, promotion sent in 7 days, active order, recent delivery, recent cancellation or failure, late delivery.</p><div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4"><span>No consent: {preview.exclusions.notConsented}</span><span>No subscription: {preview.exclusions.noSubscription}</span><span>Target mismatch: {preview.exclusions.cohortMismatch}</span><span>Promotion in 7 days: {preview.exclusions.sentPromotionLast7d}</span><span>Active order: {preview.exclusions.activeOrder}</span><span>Recent delivery: {preview.exclusions.recentDelivery}</span><span>Recent cancellation/failure: {preview.exclusions.recentCancellationOrFailure}</span><span>Late delivery: {preview.exclusions.lateDeliverySuppression}</span></div></div>}
        <div className="flex flex-wrap gap-2"><button disabled={busy || !form.title.trim() || !form.body.trim() || !form.destinationUrl.startsWith('/')} onClick={save} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save draft' : 'Create draft'}</button>{editing?.status === 'draft' && <><button disabled={busy} onClick={() => action(editing, 'test')} className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-slate-600"><TestTube2 className="h-4 w-4" /> Test send</button><button disabled={busy} onClick={() => action(editing, 'send')} className="flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white"><Send className="h-4 w-4" /> Send now</button></>}</div>
      </div>
    </section>}
    {promotions.length === 0 ? <div className="border-y border-gray-200 py-8 text-center dark:border-slate-700"><Megaphone className="mx-auto h-5 w-5 text-gray-400" /><p className="mt-2 text-sm font-semibold text-gray-800 dark:text-white">No promotions yet</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Create a draft when you are ready to message eligible customers.</p><button onClick={openNew} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" /> New promotion</button></div> : <section className="space-y-2">{promotions.map(promotion => {
      const delivered = promotion.delivery_count || promotion.deliveredCount || 0;
      const clicks = promotion.clickCount || 0;
      const draftTargeting = `${promotion.zone_ids?.length ? `${promotion.zone_ids.length} selected zone${promotion.zone_ids.length === 1 ? '' : 's'}` : 'All zones'} · ${promotion.audience_rules?.cohorts.length ? promotion.audience_rules.cohorts.map(value => cohorts.find(cohort => cohort.value === value)?.label || value).join(', ') : 'All consented subscribers'}`;
      return <article key={promotion.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-bold text-gray-900 dark:text-white">{promotion.title}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${promotion.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : promotion.status === 'sending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>{promotion.status}</span></div><p className="mt-1 truncate text-xs text-gray-500 dark:text-slate-400">{promotion.body}</p><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{promotion.status === 'sent' ? `${promotion.recipient_count} recipients · ${delivered} accepted deliveries · ${promotion.fail_count} failures · ${clicks} clicks · ${rate(clicks, promotion.recipient_count)} click rate` : promotion.status === 'sending' ? 'Sending to the eligible audience...' : draftTargeting}</p></div>{promotion.status === 'draft' && <div className="flex shrink-0 gap-1"><button title="Edit draft" aria-label="Edit draft" onClick={() => openEdit(promotion)} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Megaphone className="h-4 w-4" /></button><button title="Preview audience" aria-label="Preview audience" onClick={() => action(promotion, 'preview')} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><Users className="h-4 w-4" /></button><button title="Delete draft" aria-label="Delete draft" onClick={() => action(promotion, 'delete')} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></div>}</article>;
    })}</section>}
    </div>}
    {activeTab === 'analytics' && <section id="analytics-panel" role="tabpanel" aria-labelledby="analytics-tab" className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><Metric label="Sent" value={sentPromotions.length} /><Metric label="Recipients" value={totals.recipients} /><Metric label="Accepted" value={totals.delivered} /><Metric label="Failed" value={totals.failed} /><Metric label="Clicks" value={totals.clicks} icon /><Metric label="Click rate" value={rate(totals.clicks, totals.recipients)} /></div><div className="overflow-x-auto border-y border-gray-200 dark:border-slate-700"><table className="w-full min-w-[700px] text-left text-xs"><thead className="text-gray-500 dark:text-slate-400"><tr><th className="px-3 py-2 font-semibold">Promotion</th><th className="px-3 py-2 font-semibold">Recipients</th><th className="px-3 py-2 font-semibold">Accepted</th><th className="px-3 py-2 font-semibold">Failed</th><th className="px-3 py-2 font-semibold">Clicks</th><th className="px-3 py-2 font-semibold">Click rate</th></tr></thead><tbody>{sentPromotions.map(promotion => <tr key={promotion.id} className="border-t border-gray-100 dark:border-slate-800"><td className="px-3 py-2 font-semibold text-gray-800 dark:text-slate-100">{promotion.title}</td><td className="px-3 py-2">{promotion.recipient_count}</td><td className="px-3 py-2">{promotion.delivery_count || promotion.deliveredCount || 0}</td><td className="px-3 py-2">{promotion.fail_count || 0}</td><td className="px-3 py-2">{promotion.clickCount || 0}</td><td className="px-3 py-2">{rate(promotion.clickCount || 0, promotion.recipient_count)}</td></tr>)}{sentPromotions.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 dark:text-slate-400">No sent promotions to analyse.</td></tr>}</tbody></table></div></section>}
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon?: boolean }) {
  return <div className="border-l-2 border-emerald-500 pl-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p><p className="mt-1 flex items-center gap-1 text-lg font-bold text-gray-900 dark:text-white">{icon && <MousePointerClick className="h-4 w-4 text-emerald-600" />}{value}</p></div>;
}

function rate(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '0.0%';
}

export function formatPromotionScheduleForInput(value: string | null): string | null {
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

function message(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { error?: string } } };
  return maybe.response?.data?.error || fallback;
}