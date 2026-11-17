import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert, X } from 'lucide-react';
import {
  referralAdminApi, apiErrorMessage, type ReferralFraudEntry,
} from '../services/referralAdminApi';
import {
  Pagination, EmptyState, StatusBadge, DetailDrawer, FieldRow, fmtDate, inputClass,
} from '../components/referralUi';

const PAGE_SIZE = 20;
const STATUSES = ['pending', 'qualified', 'rejected', 'capped', 'expired'];
const ACTIONS: Array<{ label: string; status: string; tone: string }> = [
  { label: 'Approve', status: 'qualified', tone: 'bg-emerald-500 hover:bg-emerald-600' },
  { label: 'Reject', status: 'rejected', tone: 'bg-red-500 hover:bg-red-600' },
  { label: 'Revert to pending', status: 'pending', tone: 'bg-amber-500 hover:bg-amber-600' },
];

function signalsOf(entry: ReferralFraudEntry): string[] {
  const value = entry.riskSignals ?? entry.risk_signals ?? entry.signals;
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${String(v)}`);
  return [];
}

export default function ReferralFraudPage() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ReferralFraudEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReferralFraudEntry | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The fraud endpoint ignores its status filter server-side, so narrow the
      // fetched page here; pagination still matches the visible list.
      const response = await referralAdminApi.getFraud({ limit: 500, offset: 0 });
      const all = response.items || [];
      const filtered = status ? all.filter(row => row.status === status) : all;
      setItems(filtered.slice(offset, offset + PAGE_SIZE));
      setTotal(filtered.length);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load the fraud queue.'));
      setItems([]);
      setTotal(0);
    } finally { setLoading(false); }
  }, [status, offset]);

  useEffect(() => { load(); }, [load]);

  const review = async (nextStatus: string) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await referralAdminApi.reviewFraud(selected.id, nextStatus, notes.trim() || `Reviewed as ${nextStatus}`);
      setNotice(`Referral ${selected.id.slice(0, 8)} marked ${nextStatus}.`);
      setSelected(null);
      setNotes('');
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save the fraud review.'));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Fraud Review Queue</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">Review flagged referrals and record the decision in the referral audit trail.</p>
      </div>

      <div className="page-card p-3 flex flex-wrap items-center gap-2">
        <select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}
          className={`${inputClass} w-auto text-xs py-2`}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-[11px] text-gray-500">{total.toLocaleString('en-IN')} referrals in view</span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      <div className="page-card">
        <div className="hidden lg:grid grid-cols-[1fr_1fr_0.8fr_0.9fr_0.9fr_auto] gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>Code / Referrer</div><div>Referred</div><div>Status</div><div>Attributed</div><div>Rewarded</div><div />
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : items.length === 0 ? (
          <EmptyState message="No referrals to review" hint="Adjust the status filter, or check back after new referrals are flagged." />
        ) : items.map(row => {
          const signals = signalsOf(row);
          return (
            <button key={row.id} onClick={() => { setSelected(row); setNotes(''); setNotice(''); }}
              className="w-full grid grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr_0.9fr_0.9fr_auto] gap-3 items-center px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/40 text-left">
              <div className="min-w-0">
                <p className="text-xs font-bold font-mono text-gray-900 dark:text-white">{row.code || '—'}</p>
                <p className="text-[10px] text-gray-500 truncate">{row.referrerPhone || '—'}</p>
              </div>
              <p className="text-[11px] text-gray-600 dark:text-slate-400 truncate">{row.referredPhone || '—'}</p>
              <StatusBadge status={row.status} />
              <p className="text-[11px] text-gray-500">{fmtDate(row.attributedAt, false)}</p>
              <p className="text-[11px] text-gray-500">{fmtDate(row.rewardedAt, false)}</p>
              <div className="flex items-center gap-1 justify-self-end col-span-2 lg:col-span-1">
                {signals.length > 0 && (
                  <span title={`${signals.length} signals`}>
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                  </span>
                )}
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Review →</span>
              </div>
            </button>
          );
        })}
        {!loading && total > 0 && <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-slate-400">
        The backend does not currently expose structured risk signals or a server-side status filter for this queue;
        statuses are narrowed from the fetched page. If signals are present they are shown in the review drawer.
      </p>

      {selected && (
        <DetailDrawer title="Fraud Review" subtitle={selected.id} onClose={() => setSelected(null)}>
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-1">
              <FieldRow label="Current status"><StatusBadge status={selected.status} /></FieldRow>
              <FieldRow label="Code">{selected.code || '—'}</FieldRow>
              <FieldRow label="Referrer">{selected.referrerPhone || '—'}</FieldRow>
              <FieldRow label="Referred customer">{selected.referredPhone || '—'}</FieldRow>
              <FieldRow label="Attributed">{fmtDate(selected.attributedAt)}</FieldRow>
              <FieldRow label="Rewarded">{fmtDate(selected.rewardedAt)}</FieldRow>
              <FieldRow label="Existing notes">{selected.notes || '—'}</FieldRow>
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Risk signals</p>
              {signalsOf(selected).length === 0 ? (
                <p className="text-xs text-gray-400">No risk signals were supplied by the backend for this referral.</p>
              ) : signalsOf(selected).map((signal, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-400 py-1 border-b border-gray-50 dark:border-slate-700/50 capitalize">
                  {signal.replace(/_/g, ' ')}
                </p>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Review notes</label>
              <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Record why this decision was made" className={inputClass} />
            </div>

            <div className="flex flex-wrap gap-2">
              {ACTIONS.map(action => (
                <button key={action.status} disabled={saving}
                  onClick={() => review(action.status)}
                  className={`flex-1 min-w-[110px] py-2.5 text-xs font-semibold text-white rounded-xl disabled:opacity-50 ${action.tone}`}>
                  {action.label}
                </button>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white py-1">
              <X className="w-3 h-3" /> Close
            </button>
          </div>
        </DetailDrawer>
      )}
    </div>
  );
}
