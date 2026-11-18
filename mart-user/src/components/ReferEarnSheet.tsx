import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MessageCircle, X, Gift } from 'lucide-react';
import { referralApi, type ReferralCredit, type ReferralMeData, type ReferralRecord } from '../services/api';
import { requestErrorMessage } from '../utils/networkError';
import {
  availableReferralBalance,
  buildReferralLink,
  buildReferralShareMessage,
  buildWhatsAppReferralLink,
  normalizeReferralCode,
} from '../utils/referral';

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

export default function ReferEarnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<ReferralMeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [showDetails, setShowDetails] = useState(false);

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
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setNotice('Could not copy. Please select the text and copy it manually.');
    }
    window.setTimeout(() => setNotice(''), 2500);
  };

  if (!open) return null;

  const code = normalizeReferralCode(data?.code);
  const link = buildReferralLink(code, window.location.origin);
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
  const shareMessage = buildReferralShareMessage(code, link, reward);
  const whatsappLink = buildWhatsAppReferralLink(shareMessage);

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refer and Earn"
        onClick={event => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-800 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-ink dark:text-white">Refer & Earn</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Share Gokez Mart with friends and both of you earn rewards.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadError && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300" role="alert">
            {loadError}
            <button type="button" onClick={() => void refresh()} className="ml-2 font-bold underline">Retry</button>
          </div>
        )}

        {loading && !data && !loadError && (
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-slate-400">Loading your rewards…</p>
        )}

        {data && (
          <div className="mt-4 space-y-5">
            <section className="rounded-2xl bg-gokez-50 p-4 text-center dark:bg-gokez-900/20">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-gokez-700 shadow-sm dark:bg-slate-700 dark:text-gokez-300">
                <Gift className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-xl font-extrabold text-gokez-700 dark:text-gokez-300">Earn {rupees(reward)}</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">Use a code during registration to save {rupees(firstStageAmount)} on your first qualifying order. The rest unlocks after delivery.</p>
              <p className="mt-3 text-xs font-semibold text-gray-600 dark:text-slate-300">Total referral balance: {rupees(stats?.totalEarned)}</p>
              <div className="mt-3 rounded-xl border border-dashed border-gokez-300 bg-white px-3 py-3 dark:border-gokez-700 dark:bg-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Your referral code</p>
                <p className="mt-1 font-mono text-2xl font-extrabold tracking-[0.25em] text-ink dark:text-white">{code || '—'}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(code, 'Code copied')}
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-cream-200 bg-white text-[11px] font-bold text-ink transition-colors hover:border-gokez-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy Code
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(link, 'Link copied')}
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-cream-200 bg-white text-[11px] font-bold text-ink transition-colors hover:border-gokez-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy Link
                </button>
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#25D366] text-[11px] font-bold text-white transition-colors hover:bg-[#20bd5a]"
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
                </a>
              </div>
              {notice && <p className="mt-2 text-[11px] font-medium text-gokez-700 dark:text-gokez-300" role="status">{notice}</p>}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="rounded-xl bg-gokez-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-gokez-800"
                >
                  View referral details
                </button>
              </div>
            </section>

            {showDetails && (
              <>
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">How it works</p>
              <div className="grid gap-2 sm:grid-cols-2">
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
            </section>

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
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
