import { useCallback, useEffect, useState } from 'react';
import { referralApi, type ReferralCredit, type ReferralMeData, type ReferralRecord } from '../services/api';
import { requestErrorMessage } from '../utils/networkError';
import { availableReferralBalance, redeemableReferralBalance } from '../utils/referral';
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

function stageOneRewardCreditFor(referral: ReferralRecord | undefined, credits: ReferralCredit[]): ReferralCredit | undefined {
  return credits.find(credit => credit.benefitType === 'reward' && credit.referralId === referral?.id && credit.stageNumber === 1);
}

function historyLabel(referral: ReferralRecord, credits: ReferralCredit[]): string {
  if (referral.status === 'capped') return 'Limit reached';
  if (referral.status === 'expired' || referral.status === 'rejected') return statusLabel(referral.status);
  if (referral.role === 'referee') {
    const first = firstOrderCreditFor(referral, credits);
    const stageOne = stageOneRewardCreditFor(referral, credits);
    if (first?.status === 'redeemed' || stageOne?.status === 'redeemed') return referral.status === 'rewarded' ? 'Reward credited' : 'First benefit used';
    if (first?.status === 'reserved') return 'First order placed';
    if (stageOne?.status === 'available' || stageOne?.status === 'reserved') return 'First-order benefit added';
    return referral.status === 'rewarded' ? 'Reward credited' : 'Waiting for first order delivery';
  }
  if (referral.status === 'rewarded') return 'Delivered · Reward credited';
  return 'Waiting for delivery';
}

function rupees(value: number | string | null | undefined): string {
  const n = Number(value);
  const rounded = Number.isFinite(n) ? n : 0;
  return `₹${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

function expiryLabel(value: string | null | undefined): string {
  return value ? `Expires ${dateLabel(value)}` : 'No expiry';
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
  const redemptionMinimum = Number(data?.redemptionMinimum ?? campaign?.redemptionMinOrderAmount ?? data?.minimumOrderAmount) || 0;
  const expiryDays = Number(campaign?.expiryDays) || 0;
  const stats = data?.stats;
  const successfulReferrals = Number(stats?.successfulReferrals) || 0;
  const pendingReferrals = Number(stats?.pendingReferrals) || 0;
  const credits = data?.credits || [];
  const referrals = data?.referrals || [];
  const available = data ? availableReferralBalance(data.credits) : 0;
  const redeemable = data ? redeemableReferralBalance(data.credits) : 0;
  const orderedStages = [...stages].sort((a, b) => Number(a.stage) - Number(b.stage));
  const maxStageAmount = Math.max(0, ...orderedStages.map(stage => Number(stage.amount) || 0));
  const firstStageAmount = Math.max(0, Number(stages.find(stage => Number(stage.stage) === 1)?.amount) || 0);
  const remainingStageAmount = stages
    .filter(stage => Number(stage.stage) !== 1)
    .reduce((sum, stage) => sum + Math.max(0, Number(stage.amount) || 0), 0);
  const refereeReferral = referrals.find(referral => referral.role === 'referee');
  const firstOrderCredit = firstOrderCreditFor(refereeReferral, credits);
  const stageOneRewardCredit = stageOneRewardCreditFor(refereeReferral, credits);
  const remainingCredit = remainingCreditFor(refereeReferral, credits, orderedStages[1]?.stage);
  const firstBenefitStatus = firstOrderCredit?.status === 'reserved'
    ? 'Applied to your first order'
    : firstOrderCredit?.status === 'redeemed'
      ? 'Used on your first order'
      : firstOrderCredit?.status === 'expired'
        ? 'Expired before use'
        : stageOneRewardCredit?.status === 'redeemed'
          ? 'Stage 1 used'
          : stageOneRewardCredit?.status === 'available'
            ? 'Stage 1 reward ready'
            : 'Ready for your first order — no referral minimum';
  const laterRewardStatus = remainingCredit?.status === 'redeemed'
    ? 'Used on a later order'
    : remainingCredit?.status === 'reserved'
      ? 'Applied to your next order'
      : remainingCredit?.status === 'expired'
        ? 'Expired before use'
        : remainingCredit?.status === 'available'
          ? 'Ready for your next order'
          : 'Opens after your first order is delivered';
  const firstOrderCompleted = (firstOrderCredit?.status === 'redeemed' || stageOneRewardCredit?.status === 'redeemed')
    && Boolean(remainingCredit && (remainingCredit.status === 'available' || remainingCredit.status === 'redeemed'));
  const wallet = [
    { label: 'Total earned so far', value: rupees(stats?.totalEarned) },
    { label: 'Unlocked total', value: rupees(stats?.available ?? available) },
    { label: 'Redeemable now', value: rupees(stats?.redeemableNow ?? redeemable) },
    { label: 'Used', value: rupees(stats?.used) },
    { label: 'Pending', value: rupees(stats?.pending), pending: true },
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
      <PageHeader title="Refer & Earn" onBack={() => window.history.back()} />
      <div className="mx-auto max-w-2xl px-4 py-5 pb-10 sm:px-6 sm:py-7">
        {data && (
          <div className="mt-3 space-y-3">
            <section className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">How it works</p>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">
                <li>
                  Share your code. A friend who enters it at signup gets {rupees(reward)} in referral rewards: {rupees(firstStageAmount)} for their first order (no referral minimum) and {rupees(remainingStageAmount)} on later orders{redemptionMinimum > 0 ? ` with ${rupees(redemptionMinimum)} product subtotal` : ''}.
                </li>
                <li>After your friend’s first order is delivered, you get {rupees(reward)} in referral rewards.</li>
                <li>You can use up to {rupees(maxStageAmount)} in one order{redemptionMinimum > 0 ? ` on a minimum order of ${rupees(redemptionMinimum)}` : ''}.</li>
                <li>
                  {expiryDays > 0 ? `Credits expire ${expiryDays} days after they unlock.` : 'Credits do not expire.'}
                </li>
                <li>Invite as many friends as you like — sharing your code has no limit; campaign reward limits still apply.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your progress</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-xl border border-cream-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/40">
                    <p className="text-[11px] text-gray-500 dark:text-slate-400">Successful referrals</p>
                    <p className="mt-1 text-lg font-extrabold text-ink dark:text-white">{successfulReferrals}</p>
                  </div>
                  <div className="rounded-xl border border-cream-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/40">
                    <p className="text-[11px] text-gray-500 dark:text-slate-400">Pending referrals</p>
                    <p className="mt-1 text-lg font-extrabold text-ink dark:text-white">{pendingReferrals}</p>
                  </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                    Successful means the friend’s first order was delivered. Pending means we are waiting for that delivery.
                  </p>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Rewards wallet</p>
                  <div className="grid grid-cols-2 gap-1.5">
                  {wallet.map(item => (
                    <div key={item.label} className="rounded-xl border border-cream-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-[11px] text-gray-500 dark:text-slate-400">{item.label}</p>
                      <p className="mt-1 text-sm font-extrabold text-ink dark:text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                  Total earned so far includes pending rewards. Unlocked total counts rewards issued and not used yet; Redeemable now is what you can use at checkout today.
                </p>
                {refereeReferral && (
                  <div className="mt-2 rounded-xl border border-gokez-100 bg-white p-3 dark:border-gokez-900/40 dark:bg-slate-900/40">
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your referral benefit</p>
                    <p className="text-sm font-extrabold text-ink dark:text-white">Total reward: {rupees(reward)}</p>
                    <div className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">
                      <p>{rupees(firstStageAmount)} – {firstBenefitStatus}</p>
                      {remainingStageAmount > 0 && <p>{rupees(remainingStageAmount)} – {laterRewardStatus}</p>}
                    </div>
                    <p className="mt-2 rounded-xl bg-gokez-50 p-2.5 text-[11px] leading-relaxed text-gokez-700 dark:bg-gokez-900/20 dark:text-gokez-300">
                      Rewards open in stage order. You can use {rupees(stats?.redeemableNow ?? redeemable)} right now; the rest opens after earlier stages. One reward per order — no coupon stacking.
                    </p>
                    {firstOrderCompleted && remainingStageAmount > 0 && (
                      <p className="mt-2 rounded-xl bg-gokez-50 p-2.5 text-[11px] font-semibold leading-relaxed text-gokez-700 dark:bg-gokez-900/20 dark:text-gokez-300" role="status">
                        Your first order is delivered. Your {rupees(firstStageAmount)} first-order benefit is complete and {rupees(remainingStageAmount)} is ready for a later eligible order.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your credits</p>
              {credits.length === 0 ? (
                <p className="rounded-xl border border-cream-200 bg-white p-2.5 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">No rewards yet. Share your code — your first-order discount and later rewards will appear here.</p>
              ) : (
                <div className="divide-y divide-cream-200 overflow-hidden rounded-xl border border-cream-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/40">
                  {credits.map(credit => (
                    <div key={credit.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink dark:text-white">
                          {credit.benefitType === 'first_order'
                            ? `First order · ${rupees(credit.amount)} off · No referral minimum`
                            : `${credit.stageNumber ? `Stage ${credit.stageNumber} · ` : ''}${rupees(credit.amount)} reward`}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">
                          {expiryLabel(credit.expiresAt)}
                          {credit.status === 'available' && credit.redeemableNow === false ? ' · Unlocks after earlier stages' : ''}
                          {credit.status === 'available' && credit.redeemableNow === true ? ' · Redeemable now' : ''}
                        </p>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-gokez-50 px-2.5 py-1 text-[10px] font-bold text-gokez-700 dark:bg-gokez-900/30 dark:text-gokez-300">{statusLabel(credit.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Referral history</p>
              {referrals.length === 0 ? (
                <p className="rounded-xl border border-cream-200 bg-white p-2.5 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">No referrals yet.</p>
              ) : (
                <div className="divide-y divide-cream-200 overflow-hidden rounded-xl border border-cream-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/40">
                  {referrals.map(referral => (
                    <div key={referral.id} className="flex items-center justify-between gap-2 px-3 py-2">
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
