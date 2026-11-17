import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MessageCircle, X, Gift } from 'lucide-react';
import { referralApi, type ReferralMeData } from '../services/api';
import { requestErrorMessage } from '../utils/networkError';
import {
  availableReferralBalance,
  buildReferralLink,
  buildReferralShareMessage,
  buildWhatsAppReferralLink,
  normalizeReferralCode,
  REFERRAL_CREDIT_AMOUNT,
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

function rupees(value: number | string | null | undefined): string {
  const n = Number(value);
  return `₹${(Number.isFinite(n) ? n : 0).toFixed(0)}`;
}

export default function ReferEarnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<ReferralMeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState('');
  const [claimed, setClaimed] = useState(false);

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

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = normalizeReferralCode(codeInput);
    if (!code || claimBusy) return;
    setClaimBusy(true);
    setClaimError('');
    setClaimSuccess('');
    try {
      await referralApi.claim(code);
      setClaimed(true);
      setCodeInput('');
      setClaimSuccess('Referral code applied. Your rewards will appear once the order is delivered.');
      await refresh();
    } catch (err: any) {
      setClaimError(err?.response?.data?.error || requestErrorMessage(err, 'This code could not be applied. Check it and try again.'));
    } finally {
      setClaimBusy(false);
    }
  };

  if (!open) return null;

  const code = normalizeReferralCode(data?.code);
  const link = buildReferralLink(code, window.location.origin);
  const campaign = data?.campaign;
  const reward = Number(campaign?.refereeReward) > 0 ? Number(campaign?.refereeReward) : 100;
  const creditAmount = Number(campaign?.creditAmount) > 0 ? Number(campaign?.creditAmount) : REFERRAL_CREDIT_AMOUNT;
  const qualifyingMin = Number(campaign?.qualifyingOrderMin) || 0;
  const redemptionMin = Number(campaign?.redemptionMin) || 0;
  const expiryDays = Number(campaign?.expiryDays) || 0;
  const cap = Number(campaign?.maxReferralsPerReferrer) || 0;
  const stats = data?.stats;
  const successfulReferrals = Number(stats?.successfulReferrals) || 0;
  const pendingReferrals = Number(stats?.pendingReferrals) || 0;
  const credits = data?.credits || [];
  const referrals = data?.referrals || [];
  const available = data ? availableReferralBalance(data.credits) : 0;
  const wallet = [
    { label: 'Total rewards earned', value: rupees(stats?.totalEarned) },
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
              <p className="mt-3 text-xl font-extrabold text-gokez-700 dark:text-gokez-300">Earn ₹100</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">for every friend who places their first qualifying order.</p>
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
            </section>

            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">How it works</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                <li>Share your code or your link with a friend.</li>
                <li>They sign up with your code, or open your link and verify their number.</li>
                <li>Both of you get {rupees(creditAmount)} in rewards after their first qualifying order is successfully delivered.</li>
              </ol>
              {(qualifyingMin > 0 || redemptionMin > 0 || expiryDays > 0) && (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                  {qualifyingMin > 0 && `Qualifying order: ${rupees(qualifyingMin)} or more. `}
                  {redemptionMin > 0 && `Use rewards on orders of ${rupees(redemptionMin)} or more. `}
                  {expiryDays > 0 && `Credits expire ${expiryDays} days after they unlock. `}
                </p>
              )}
            </section>

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
                <p className="rounded-xl border border-cream-200 bg-white p-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">No credits yet. Share your code to start earning.</p>
              ) : (
                <div className="divide-y divide-cream-200 overflow-hidden rounded-xl border border-cream-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/40">
                  {credits.map(credit => (
                    <div key={credit.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink dark:text-white">{rupees(credit.amount)} reward</p>
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
                        <p className="text-xs font-semibold text-ink dark:text-white">Applied {dateLabel(referral.attributedAt)}</p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400">Rewarded {dateLabel(referral.rewardedAt)}</p>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold text-gray-600 dark:bg-slate-700 dark:text-slate-300">{statusLabel(referral.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {data.eligibleForCode && !claimed && (
              <section className="rounded-xl border border-cream-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-xs font-bold text-ink dark:text-white">Have a referral code?</p>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">Enter a friend's code to claim your reward.</p>
                <form onSubmit={handleClaim} className="mt-2 flex gap-2">
                  <input
                    id="referral-code-input"
                    type="text"
                    value={codeInput}
                    maxLength={6}
                    onChange={event => setCodeInput(event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6))}
                    placeholder="6-character code"
                    className="min-w-0 flex-1 rounded-xl border border-cream-200 bg-white px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-ink outline-none focus:border-gokez-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={claimBusy || normalizeReferralCode(codeInput).length !== 6}
                    className="min-h-11 flex-shrink-0 rounded-xl bg-gokez-700 px-4 text-xs font-bold text-white transition-colors hover:bg-gokez-800 disabled:opacity-50"
                  >
                    {claimBusy ? 'Applying…' : 'Apply'}
                  </button>
                </form>
                {claimError && <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" role="alert">{claimError}</p>}
                {claimSuccess && <p className="mt-2 text-xs font-medium text-gokez-700 dark:text-gokez-300" role="status">{claimSuccess}</p>}
              </section>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
