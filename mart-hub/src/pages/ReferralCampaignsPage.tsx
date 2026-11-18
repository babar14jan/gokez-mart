import { useEffect, useState } from 'react';
import { Plus, Pencil, Play, Pause, X, Loader2, History, Gift } from 'lucide-react';
import {
  referralAdminApi, campaignToForm, campaignFormToPayload, num,
  stageTotal, stagesMatchTotal, rebalanceStageAmounts, changeStageCount,
  type ReferralCampaign, type ReferralCampaignForm, type ReferralCampaignHistoryEntry, type CampaignAction,
} from '../services/referralAdminApi';
import { StatusBadge, PanelHeader, fmtDate, fmtMoney, inputClass } from '../components/referralUi';
import ConfirmDialog from '../components/ConfirmDialog';
import PageSkeleton from '../components/PageSkeleton';

const IGNORED_DIFF_KEYS = new Set(['id', 'version', 'created_by', 'created_at', 'updated_at', 'campaign_id']);

function diffEntries(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(key => {
    if (IGNORED_DIFF_KEYS.has(key)) return false;
    return JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]);
  }).map(key => ({
    key,
    before: before?.[key],
    after: after?.[key],
  }));
}

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
};

const stageSummary = (campaign: ReferralCampaign): string => {
  const stages = Array.isArray(campaign.reward_stages) ? campaign.reward_stages : [];
  if (!stages.length) return '—';
  return stages.map(stage => `Stage ${num(stage.stage)}: ${fmtMoney(stage.amount)}`).join(' · ');
};

function ToggleRow({ label, hint, checked, onChange, disabled = false }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2 border-b border-gray-50 dark:border-slate-700/60 last:border-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-xs font-semibold text-gray-700 dark:text-slate-300">{label}</span>
        {hint && <span className="block text-[10px] text-gray-500 dark:text-slate-400">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="w-4 h-4 accent-emerald-500 flex-shrink-0" />
    </label>
  );
}

export default function ReferralCampaignsPage({ embedded = false }: { embedded?: boolean }) {
  const [campaigns, setCampaigns] = useState<ReferralCampaign[]>([]);
  const [history, setHistory] = useState<ReferralCampaignHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ReferralCampaign | null>(null);
  const [form, setForm] = useState<ReferralCampaignForm>(campaignToForm(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionConfirm, setActionConfirm] = useState<{ campaign: ReferralCampaign; action: CampaignAction } | null>(null);

  const load = async () => {
    try {
      const [list, log] = await Promise.all([
        referralAdminApi.getCampaigns({ limit: 100 }),
        referralAdminApi.getCampaignHistory({ limit: 100 }),
      ]);
      setCampaigns(list.items || []);
      setHistory(log.items || []);
    } catch {
      setError('Could not load referral campaigns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const active = campaigns.find(c => c.status === 'active');

  const openCreate = () => {
    setEditing(null);
    // A new version starts from the live configuration so changing one term
    // does not silently reset the other reward rules.
    setForm(campaignToForm(active || null));
    setError('');
    setShowModal(true);
  };

  const openEdit = (campaign: ReferralCampaign) => {
    setEditing(campaign);
    setForm(campaignToForm(campaign));
    setError('');
    setShowModal(true);
  };

  const setField = <K extends keyof ReferralCampaignForm>(key: K, value: ReferralCampaignForm[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const setTotalRewardAmount = (value: string) => setForm(current => ({
    ...current,
    totalRewardAmount: value,
    stageAmounts: rebalanceStageAmounts(current.stageAmounts, value),
  }));

  const setStageCount = (count: number) => setForm(current => ({
    ...current,
    stageAmounts: changeStageCount(current.stageAmounts, current.totalRewardAmount, count),
  }));

  const setStageAmount = (index: number, value: string) => setForm(current => ({
    ...current,
    stageAmounts: current.stageAmounts.map((amount, position) => position === index ? value : amount),
  }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Campaign name is required'); return; }
    if (editing && !form.reason.trim()) { setError('A reason is required for an audit-tracked edit'); return; }
    if (!stagesMatchTotal(form.stageAmounts, form.totalRewardAmount)) {
      setError('Stage amounts must be greater than zero and add up to the total reward amount');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = campaignFormToPayload(form);
      if (editing) await referralAdminApi.updateCampaign(editing.id, payload);
      else await referralAdminApi.createCampaign(payload);
      setShowModal(false);
      await load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error || 'Could not save the campaign.');
    } finally { setSaving(false); }
  };

  const handleAction = async () => {
    if (!actionConfirm) return;
    try {
      await referralAdminApi.campaignAction(actionConfirm.campaign.id, actionConfirm.action);
      setActionConfirm(null);
      await load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error || 'Could not change campaign status.');
      setActionConfirm(null);
    }
  };

  const stagesBalanced = stagesMatchTotal(form.stageAmounts, form.totalRewardAmount);
  const unassigned = Math.round((num(form.totalRewardAmount) - stageTotal(form.stageAmounts)) * 100) / 100;
  const minimumOrderAmount = Number(active?.min_order_amount || 0) || 0;

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PanelHeader embedded={embedded} title="Referral Campaigns"
        subtitle={`${campaigns.length} version${campaigns.length !== 1 ? 's' : ''} · edits create a new audited version`}
        actions={<button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl shadow-sm">
          <Plus className="w-3.5 h-3.5" /> New version
        </button>} />
      {error && !showModal && <p className="text-xs text-red-500">{error}</p>}

      {active && (
        <div className="page-card border-emerald-200 dark:border-emerald-800/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Gift className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-bold text-gray-900 dark:text-white">{active.name}</p>
                <StatusBadge status={active.status} />
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">v{active.version}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                {fmtMoney(active.total_reward_amount)} per customer · {stageSummary(active)} · Eligible orders: {fmtMoney(minimumOrderAmount)}
              </p>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-slate-400">
              {active.starts_at ? `From ${fmtDate(active.starts_at, false)}` : 'No start date'}
              {' · '}{active.ends_at ? `Until ${fmtDate(active.ends_at, false)}` : 'No end date'}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {[
              ['Total per customer', fmtMoney(active.total_reward_amount)],
              ['Stages', String(Array.isArray(active.reward_stages) ? active.reward_stages.length : 0)],
              ['Minimum order eligible', fmtMoney(minimumOrderAmount)],
              ['Referral cap', String(num(active.max_referrals_per_referrer))],
              ['Expiry', active.expiry_days === null ? 'Never' : `${active.expiry_days} days`],
              ['Value basis', String(active.value_basis || '—')],
              ['Unlock trigger', String(active.unlock_trigger || '—')],
              ['Budget', active.budget === null ? 'Unlimited' : fmtMoney(active.budget)],
              ['Fraud review', active.fraud_review_enabled ? 'On' : 'Off'],
              ['Stacking', active.stacking_enabled ? 'On' : 'Off'],
              ['Cash withdrawal', active.cash_withdrawal ? 'On' : 'Off'],
              ['Transfers', active.transfer_enabled ? 'On' : 'Off'],
              ['Code length', String(num(active.code_length) || 6)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                <p className="text-xs font-bold text-gray-900 dark:text-white capitalize">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="page-card">
        <div className="page-card-header"><p className="page-card-title">Campaign Versions</p></div>
        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>Name</div><div>Status</div><div>Rewards</div><div>Created</div><div className="text-right">Actions</div>
        </div>
        {campaigns.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No referral campaigns yet.</p>
        ) : campaigns.map(c => (
          <div key={c.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 items-center px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/40">
            <div className="col-span-2 sm:col-span-1 min-w-0">
              <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{c.name} <span className="text-gray-400 font-normal">v{c.version}</span></p>
              <p className="text-[10px] text-gray-500">{c.createdByName || '—'}</p>
            </div>
            <StatusBadge status={c.status} />
            <p className="text-xs text-gray-600 dark:text-slate-400">{fmtMoney(c.total_reward_amount)}</p>
            <p className="text-[10px] text-gray-500">{fmtDate(c.created_at, false)}</p>
            <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
              <button onClick={() => openEdit(c)} title="Edit" className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                <Pencil className="w-4 h-4" />
              </button>
              {c.status !== 'active' ? (
                <button onClick={() => setActionConfirm({ campaign: c, action: 'activate' })} title="Activate"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  <Play className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => setActionConfirm({ campaign: c, action: 'pause' })} title="Pause"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                  <Pause className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <p className="page-card-title flex items-center gap-2"><History className="w-4 h-4 text-gray-500" /> Version History</p>
          <span className="text-[10px] text-gray-500">{history.length} audit entries</span>
        </div>
        {history.length === 0 ? (
          <p className="py-10 text-center text-xs text-gray-400">No campaign changes recorded.</p>
        ) : history.map(entry => {
          const diffs = diffEntries(entry.before, entry.after);
          return (
            <div key={entry.id} className="px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-900 dark:text-white capitalize">{entry.action.replace(/_/g, ' ')}</p>
                <p className="text-[10px] text-gray-500">{fmtDate(entry.createdAt)}</p>
              </div>
              {entry.reason && <p className="text-[10px] text-gray-500 mt-0.5">Reason: {entry.reason}</p>}
              {diffs.length === 0 ? (
                <p className="text-[10px] text-gray-400 mt-1">No field changes recorded.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {diffs.map(diff => (
                    <li key={diff.key} className="text-[11px] text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700/50 rounded-lg px-3 py-1.5">
                      <span className="font-semibold">{diff.key}</span>{': '}
                      <span className="text-gray-400 line-through">{displayValue(diff.before)}</span>
                      {' → '}
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{displayValue(diff.after)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{editing ? 'Edit Campaign Version' : 'New Campaign Version'}</p>
                <p className="text-[10px] text-gray-500">{editing ? `Editing v${editing.version} · saving bumps the version` : 'Prefilled from the active campaign'}</p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100">
                <X className="w-4 h-4 text-red-500" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Campaign name *</label>
                <input className={inputClass} value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Referral & Earn" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Total reward per customer (₹) *</label>
                  <input type="number" min="0.01" step="0.01" className={inputClass} value={form.totalRewardAmount}
                    onChange={e => setTotalRewardAmount(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Redemption stages *</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setStageCount(form.stageAmounts.length - 1)}
                      disabled={form.stageAmounts.length <= 1}
                      className="w-8 h-8 rounded-lg border border-gray-200 dark:border-slate-600 text-sm font-bold text-gray-600 dark:text-slate-300 disabled:opacity-40">
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-gray-900 dark:text-white">
                      {form.stageAmounts.length}
                    </span>
                    <button type="button" onClick={() => setStageCount(form.stageAmounts.length + 1)}
                      disabled={form.stageAmounts.length >= 10}
                      className="w-8 h-8 rounded-lg border border-gray-200 dark:border-slate-600 text-sm font-bold text-gray-600 dark:text-slate-300 disabled:opacity-40">
                      +
                    </button>
                    <span className="text-[10px] text-gray-400">Add or remove; amounts stay balanced.</span>
                  </div>
                </div>
              </div>
              <div className={`grid gap-3 ${form.stageAmounts.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                {form.stageAmounts.map((amount, index) => (
                  <div key={index}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stage {index + 1} amount (₹)</label>
                    <input type="number" min="0.01" step="0.01" className={inputClass} value={amount}
                      onChange={e => setStageAmount(index, e.target.value)} />
                  </div>
                ))}
              </div>
              <p className={`text-[11px] ${stagesBalanced
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-500'}`}>
                Stage total: {fmtMoney(stageTotal(form.stageAmounts))} · Total reward: {fmtMoney(form.totalRewardAmount)}
                {stagesBalanced
                  ? ' · Balanced'
                  : ` · ${unassigned > 0 ? `${fmtMoney(unassigned)} left to assign` : `${fmtMoney(Math.abs(unassigned))} over total`}`}
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Expiry days</label>
                  <input type="number" className={inputClass} value={form.expiryDays} onChange={e => setField('expiryDays', e.target.value)} placeholder="blank = never" />
                  <p className="text-[10px] text-gray-400 mt-1">Leave blank for credits that never expire.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Max referrals per referrer</label>
                  <input type="number" className={inputClass} value={form.maxReferralsPerReferrer} onChange={e => setField('maxReferralsPerReferrer', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Budget (₹)</label>
                  <input type="number" className={inputClass} value={form.budget} onChange={e => setField('budget', e.target.value)} placeholder="blank = unlimited" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Value basis</label>
                  <select className={inputClass} value={form.valueBasis} onChange={e => setField('valueBasis', e.target.value)}>
                    <option value="item_subtotal">Item subtotal</option>
                    <option value="grand_total">Grand total (includes delivery)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Unlock trigger</label>
                  <input className={inputClass} value={form.unlockTrigger} onChange={e => setField('unlockTrigger', e.target.value)} />
                  <p className="text-[10px] text-gray-400 mt-1">The current backend issues rewards only when this is <code>delivered</code>.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Starts at</label>
                  <input type="datetime-local" className={inputClass} value={form.startsAt} onChange={e => setField('startsAt', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ends at</label>
                  <input type="datetime-local" className={inputClass} value={form.endsAt} onChange={e => setField('endsAt', e.target.value)} />
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-1">
                <ToggleRow label="Stacking" hint="Referral rewards are always exclusive" checked={false} onChange={() => {}} disabled />

                <ToggleRow label="Cash withdrawal" checked={form.cashWithdrawal} onChange={v => setField('cashWithdrawal', v)} />
                <ToggleRow label="Transfers" checked={form.transferEnabled} onChange={v => setField('transferEnabled', v)} />
                <ToggleRow label="Fraud review" hint="Add referrals to the fraud review queue" checked={form.fraudReviewEnabled} onChange={v => setField('fraudReviewEnabled', v)} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Code length</label>
                  <input readOnly value="6" className={`${inputClass} bg-gray-100 dark:bg-slate-700 cursor-not-allowed`} />
                  <p className="text-[10px] text-gray-400 mt-1">Fixed at 6 characters.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reason {editing ? '*' : '(audit)'}</label>
                  <input className={inputClass} value={form.reason} onChange={e => setField('reason', e.target.value)} placeholder="Why this change was made" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving…' : 'Save version'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionConfirm && (
        <ConfirmDialog
          title={actionConfirm.action === 'activate' ? 'Activate campaign' : 'Pause campaign'}
          message={`${actionConfirm.action === 'activate' ? 'Activate' : 'Pause'} “${actionConfirm.campaign.name}” v${actionConfirm.campaign.version}? This changes which rewards new referrals receive.`}
          confirmLabel={actionConfirm.action === 'activate' ? 'Activate' : 'Pause'}
          danger={actionConfirm.action === 'pause'}
          onConfirm={handleAction}
          onCancel={() => setActionConfirm(null)}
        />
      )}
    </div>
  );
}
