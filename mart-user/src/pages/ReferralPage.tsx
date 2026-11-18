import { useCallback, useEffect, useState } from 'react';
import { referralApi, type ReferralCredit, type ReferralMeData, type ReferralRecord } from '../services/api';
import { requestErrorMessage } from '../utils/networkError';
import { availableReferralBalance } from '../utils/referral';
import PageHeader from '../components/PageHeader';

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusLabel(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.replace(/_/g, ' ').slice(1) : '—';
}

function firstOrderCreditFor(referral: ReferralRecord | undefined, credits: ReferralCredit[]): ReferralCredit | undefined {
  return credits.find(credit => credit.benefitType === 'first_order' && credit.referralId === referral?.id);
}

function remainingCreditFor(referral: ReferralRecord | undefined, credits: ReferralCredit[], stage?: number): ReferralCredit | undefined {
  return credits.find(credit => credit.benefitType === 'reward' && credit.referralId === referral?.id && credit.stageNumber === stage);
}

function historyLabel(referral: ReferralRecord, credits: ReferralCredit[]): string {
  if (referral.status === 'capped') return 'Limit reached';
  if (referral.status === 'expired' || referral.status === 'rejected') return statusLabel(referral.status);
  if (referral.role === 'referee') {
    const first = firstOrderCreditFor(referral, credits);
    if (first?.status === 'redeemed') return referral.status === 'rewarded' ? 'Reward credited' : 'First ₹25 redeemed';
    if (first?.status === 'reserved') return 'First order placed';
    return 'Pending first order';
  }
  if (referral.status === 'rewarded') return 'Successfully delivered · Reward credited';
  return 'Pending delivery';
}

function rupees(value: number | string | null | undefined): string {
  const n = Number(value);
  const rounded = Number.isFinite(n) ? n : 0;
  return `₹${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

export default function ReferralPage() {
  const [data, setData] = useState<ReferralMeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await referralApi.getMe();
      setData(response.data.data);
    } catch (err) {
      setLoadError(requestErrorMessage(err, 'We could not load your referral rewards. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const campaign = data?.campaign;
  const reward = Number(campaign?.totalRewardAmount) || 0;
  const stages = Array.isArray(campaign?.rewardStages) ? campaign.rewardStages : [];
  const stageText = stages.map(stage => `Stage ${stage.stage}: ${rupees(stage.amount)}`).join(' · ');
  const minimumOrderAmount = Number(data?.minimumOrderAmount) || 0;
  const expiryDays = Number(campaign?.expiryDays) || 0;
  const cap = Number(campaign?.maxReferralsPerReferrer) || 0;
  const stats = data?.stats;
  const successfulReferrals = Number(stats?.successfulReferrals) || 0;
  const pendingReferrals = Number(stats?.pendingReferrals) || 0;
  const credits = data?.credits || [];
  const referrals = data?.referrals || [];
  const available = data ? availableReferralBalance(data.credits) : 0;
  const firstStageAmount = Number(stages[0]?.amount) || reward;
  const remainingStageAmount = Math.max(0, Math.round((reward - firstStageAmount) * 100) / 100);
  const refereeReferral = referrals.find(referral => referral.role === 'referee');
  const firstOrderCredit = firstOrderCreditFor(refereeReferral, credits);
  const remainingCredit = remainingCreditFor(refereeReferral, credits, stages[1]?.stage);
  const firstOrderStatus = firstOrderCredit?.status === 'reserved'
    ? 'Applied to your first order'
    : firstOrderCredit?.status === 'redeemed'
      ? 'Used on first order'
      : firstOrderCredit?.status === 'expired'
        ? 'Expired'
        : 'Ready for your first order';
  const remainingStatus = remainingCredit?.status === 'redeemed'
    ? 'Used on a later order'
    : remainingCredit?.status === 'reserved'
      ? 'Applied to an order'
      : remainingCredit?.status === 'expired'
        ? 'Expired'
        : remainingCredit?.status === 'available'
          ? 'Unlocked for next order'
          : 'Pending after first-order delivery';
  const firstOrderCompleted = firstOrderCredit?.status === 'redeemed' && remainingCredit?.status === 'available';
  const wallet = [
    { label: 'Total referral reward earned', value: rupees(stats?.totalEarned) },
    { label: 'Available to use', value: rupees(stats?.available ?? available) },
    { label: 'Used', value: rupees(stats?.used) },
    { label: 'Expired', value: rupees(stats?.expired) },
    { label: 'Pending', value: rupees(stats?.pending), pending: true },
    { label: 'Reversed', value: rupees(stats?.reversed) },
  ];

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] dark:bg-slate-900">
        <PageHeader title="Refer & Earn" onBack={() => window.history.back()} />
        <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
          <p className="text-center text-sm text-gray-500 dark:text-slate-400">Loading your rewards…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#f7f8fa] dark:bg-slate-900">
        <PageHeader title="Refer & Earn" onBack={() => window.history.back()} />
        <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300" role="alert">
            {loadError}
            <button type="button" onClick={() => void refresh()} className="ml-2 font-bold underline">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] dark:bg-slate-900">
      <PageHeader title="Refer & Earn" subtitle="Share Gokez Mart with friends and both of you earn rewards." onBack={() => window.history.back()} />
      <div className="mx-auto max-w-2xl px-4 py-5 pb-10 sm:px-6 sm:py-7">
        {data && (
          <div className="mt-4 space-y-5">
            <details className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">How it works</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-gokez-100 bg-gokez-50/70 p-3 dark:border-gokez-900/40 dark:bg-gokez-900/15">
                  <p className="text-xs font-bold text-gokez-700 dark:text-gokez-300">1 · Use code</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">A new customer enters a friend’s code during registration. Only one code can be used per customer.</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 dark:border-amber-900/40 dark:bg-amber-900/15">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300">2 · First order</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">Apply the referral benefit at checkout on the first qualifying order. {rupees(firstStageAmount)} is reserved for that order.</p>
                </div>
                <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 sm:col-span-2 dark:border-sky-900/40 dark:bg-sky-900/15">
                  <p className="text-xs font-bold text-sky-700 dark:text-sky-300">3 · Unlock</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">After successful delivery, the first stage is consumed and {rupees(remainingStageAmount)} becomes available for the next eligible order. One reward per order; no coupon stacking.</p>
                </div>
              </div>
              {(stageText || minimumOrderAmount > 0 || expiryDays > 0) && (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                  {stageText && `${stageText}${stages.length > 1 ? '. Use earlier stages first.' : '.'} `}
                  {minimumOrderAmount > 0 && `Eligible orders: ${rupees(minimumOrderAmount)} product subtotal or more. `}
                  {expiryDays > 0 && `Credits expire ${expiryDays} days after they unlock. `}
                </p>
              )}
            </details>

            {refereeReferral && (
              <section className="rounded-2xl border border-gokez-100 bg-white p-4 dark:border-gokez-900/40 dark:bg-slate-900/40">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your referral benefit</p>
                <p className="text-sm font-extrabold text-ink dark:text-white">Total referral reward: {rupees(reward)}</p>
                <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">
                  <p>{rupees(firstStageAmount)} – {firstOrderStatus}</p>
                  {remainingStageAmount > 0 && <p>{rupees(remainingStageAmount)} – {remainingStatus}</p>}
                </div>
                {firstOrderCompleted && remainingStageAmount > 0 && (
                  <p className="mt-3 rounded-xl bg-gokez-50 p-3 text-[11px] font-semibold leading-relaxed text-gokez-700 dark:bg-gokez-900/20 dark:text-gokez-300" role="status">
                    Congratulations! Your {rupees(firstStageAmount)} first-order referral discount has been used successfully. Another {rupees(remainingStageAmount)} reward is now available for your next eligible order.
                  </p>
                )}
              </section>
            )}

            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your progress</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">Successful referrals</p>
                  <p className="mt-1 text-lg font-extrabold text-ink dark:text-white">{successfulReferrals}{cap > 0 ? ` / ${cap}` : ''}</p>
                </div>
                <div className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">Pending referrals</p>
                  <p className="mt-1 text-lg font-extrabold text-ink dark:text-white">{pendingReferrals}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                {cap > 0 ? `You can earn from up to ${cap} referred customers.` : 'There is no limit on referrals.'} Pending referrals are still being verified.
              </p>
            </section>

            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Rewards wallet</p>
              <div className="grid grid-cols-2 gap-2">
                {wallet.map(item => (
                  <div key={item.label} className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
                    <p className="text-[11px] text-gray-500 dark:text-slate-400">{item.label}</p>
                    <p className={`mt-1 text-sm font-extrabold ${item.pending ? 'text-amber-600 dark:text-amber-400' : 'text-ink dark:text-white'}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400" role="status">Pending rewards are not spendable until the referral order is successfully delivered.</p>
            </section>

            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your credits</p>
              {credits.length === 0 ? (
                <p className="rounded-xl border border-cream-200 bg-white p-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">No credits yet. Share your code; unlocked rewards appear here and can be used at checkout.</p>
              ) : (
                <div className="divide-y divide-cream-200 overflow-hidden rounded-xl border border-cream-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/40">
                  {credits.map(credit => (
                    <div key={credit.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink dark:text-white">
                          {credit.benefitType === 'first_order'
                            ? `First order · ${rupees(credit.amount)} discount`
                            : `${credit.stageNumber ? `Stage ${credit.stageNumber} · ` : ''}${rupees(credit.amount)} reward`}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">Expires {dateLabel(credit.expiresAt)}</p>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-gokez-50 px-2.5 py-1 text-[10px] font-bold text-gokez-700 dark:bg-gokez-900/30 dark:text-gokez-300">{statusLabel(credit.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Referral history</p>
              {referrals.length === 0 ? (
                <p className="rounded-xl border border-cream-200 bg-white p-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">No referrals yet.</p>
              ) : (
                <div className="divide-y divide-cream-200 overflow-hidden rounded-xl border border-cream-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/40">
                  {referrals.map(referral => (
                    <div key={referral.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink dark:text-white">
                          {referral.role === 'referee' ? 'Used a referral code' : 'Referred a friend'} · {dateLabel(referral.attributedAt)}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">{historyLabel(referral, credits)}</p>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold text-gray-600 dark:bg-slate-700 dark:text-slate-300">{statusLabel(referral.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
