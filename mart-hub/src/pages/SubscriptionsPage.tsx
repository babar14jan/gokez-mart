import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Pencil, Store, X } from 'lucide-react';
import { subscriptionsApi } from '../services/api';

type SubscriptionStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'cancelled';

interface Subscription {
  storeId: string;
  storeName: string;
  storeIsActive: boolean;
  storeIsLive: boolean;
  monthlyFee: number;
  planName: string | null;
  amount: number | null;
  status: SubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  paymentReference: string | null;
  notes: string | null;
}

const statusStyle: Record<SubscriptionStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  suspended: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

const formatDate = (value: string | null) => value
  ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : 'Not set';

const dateInput = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ planName: 'Standard', amount: '0', status: 'pending' as SubscriptionStatus, startsAt: '', endsAt: '', paymentReference: '', notes: '' });

  const load = async () => {
    try {
      const response = await subscriptionsApi.getAll();
      setSubscriptions(response.data.data || []);
    } catch {
      setError('Could not load subscriptions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEditor = (subscription: Subscription) => {
    setEditing(subscription);
    setError('');
    const defaultStart = new Date().toISOString().slice(0, 10);
    const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setForm({
      planName: subscription.planName || 'Standard',
      amount: String(subscription.amount ?? subscription.monthlyFee ?? 0),
      status: subscription.status,
      startsAt: dateInput(subscription.startsAt) || defaultStart,
      endsAt: dateInput(subscription.endsAt) || defaultEnd,
      paymentReference: subscription.paymentReference || '',
      notes: subscription.notes || '',
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!form.planName.trim() || Number(form.amount) < 0 || Number.isNaN(Number(form.amount))) {
      setError('Enter a plan name and a valid non-negative fee.'); return;
    }
    if (form.status === 'active' && (!form.startsAt || !form.endsAt)) {
      setError('Active subscriptions require a start and end date.'); return;
    }
    setSaving(true); setError('');
    try {
      await subscriptionsApi.update(editing.storeId, {
        planName: form.planName.trim(), amount: Number(form.amount), status: form.status,
        startsAt: form.startsAt || null, endsAt: form.endsAt || null,
        paymentReference: form.paymentReference.trim() || undefined, notes: form.notes.trim() || undefined,
      });
      setEditing(null);
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not save this subscription.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Store Subscriptions</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Control platform access, validity and renewal details. Customer order payments are not managed here.</p>
      </div>

      {error && !editing && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      <div className="space-y-3">
        {subscriptions.map(subscription => (
          <section key={subscription.storeId} className="border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20"><Store className="h-5 w-5 text-emerald-600" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-white">{subscription.storeName}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusStyle[subscription.status]}`}>{subscription.status}</span>
                  {subscription.storeIsLive && <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Live</span>}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{subscription.planName || 'Subscription awaiting setup'} · ₹{subscription.amount ?? subscription.monthlyFee}/month</p>
              </div>
              <button onClick={() => openEditor(subscription)} className="flex h-10 w-10 flex-none items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20" title="Manage subscription">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-xs dark:border-slate-700 sm:grid-cols-3">
              <div><p className="text-gray-500 dark:text-slate-400">Starts</p><p className="mt-0.5 font-semibold text-gray-800 dark:text-slate-200">{formatDate(subscription.startsAt)}</p></div>
              <div><p className="text-gray-500 dark:text-slate-400">Valid through</p><p className="mt-0.5 font-semibold text-gray-800 dark:text-slate-200">{formatDate(subscription.endsAt)}</p></div>
              <div className="col-span-2 sm:col-span-1"><p className="text-gray-500 dark:text-slate-400">Reference</p><p className="mt-0.5 break-words font-semibold text-gray-800 dark:text-slate-200">{subscription.paymentReference || 'Not recorded'}</p></div>
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-xl dark:bg-slate-800 sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-slate-700">
              <div><h2 className="font-bold text-gray-900 dark:text-white">Manage subscription</h2><p className="text-xs text-gray-500 dark:text-slate-400">{editing.storeName}</p></div>
              <button onClick={() => setEditing(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700" title="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Plan name<input value={form.planName} onChange={event => setForm(value => ({ ...value, planName: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Monthly fee (₹)<input type="number" min="0" value={form.amount} onChange={event => setForm(value => ({ ...value, amount: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Status<select value={form.status} onChange={event => setForm(value => ({ ...value, status: event.target.value as SubscriptionStatus }))} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Payment reference<input value={form.paymentReference} onChange={event => setForm(value => ({ ...value, paymentReference: event.target.value }))} placeholder="Receipt, UTR or note" className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Start date<input type="date" value={form.startsAt} onChange={event => setForm(value => ({ ...value, startsAt: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-slate-300">Valid through<input type="date" value={form.endsAt} onChange={event => setForm(value => ({ ...value, endsAt: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
              </div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">Internal note<textarea value={form.notes} onChange={event => setForm(value => ({ ...value, notes: event.target.value }))} rows={3} className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
            </div>
            <div className="flex gap-3 border-t border-gray-100 px-5 py-4 dark:border-slate-700"><button onClick={() => setEditing(null)} className="flex-1 rounded-lg bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">Cancel</button><button disabled={saving} onClick={save} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Save subscription</button></div>
          </div>
        </div>
      )}
    </div>
  );
}