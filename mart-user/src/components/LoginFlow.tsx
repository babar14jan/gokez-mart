import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Tag } from 'lucide-react';
import { authApi, campaignApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useFinePointer } from '../utils/useFinePointer';
import { useCustomerStore } from '../store/customerStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { getFunnelSessionId, track, trackCampaignTouch, trackOnce } from '../utils/track';
import { readTrackingTokens } from '../utils/guestTracking';
import { subscribeToPush } from '../services/push';

export interface LoginFlowProps {
  /** Optional: the page host has no overlay to dismiss. */
  onClose?: () => void;
  onSuccess?: () => void;
  pendingCheckout?: boolean;
  onGuest?: () => void;
  variant?: 'modal' | 'page';
  /**
   * The overlay has no other way out, so it needs the guest escape inline. A page
   * host that renders its own "Continue as guest" must switch this off, or the
   * customer sees the same action twice.
   */
  showGuestLink?: boolean;
  /**
   * Reports the visible step so a host that renders its OWN guest exit can emit
   * login_abandoned for the right step. AccountPage does exactly that, and without
   * this its button would silently drop the event the hub funnel counts.
   */
  onStepChange?: (step: Step) => void;
  /**
   * Opens a legal page (Terms/Privacy) from the consent line. The consent is part
   * of the flow so both hosts show it on the same step; a host that does not
   * supply this simply gets non-navigating buttons.
   */
  onNavigateLegal?: (path: string) => void;
  /**
   * The Account page draws the phone step's heading in its own green header, so
   * it switches this off to avoid showing the same "Log in or sign up" twice. The
   * overlay keeps it (default true).
   */
  showPhoneHeading?: boolean;
  /**
   * The Account page renders the OTP step's green app bar, so its back chevron
   * lives outside this component. It bumps this counter to ask the flow to return
   * to the phone step; a counter (not a boolean) so a second press fires again.
   * Ignored on any step but otp.
   */
  backSignal?: number;
}

export type Step = 'phone' | 'otp' | 'profile' | 'offer';

/**
 * The one and only customer login implementation.
 *
 * This used to live inside LoginModal. AccountPage had meanwhile grown its own
 * second copy of the same OTP logic, and the two had drifted: the account copy
 * fired no analytics at all, so every login started from /account was invisible
 * in the hub funnel, and it skipped the welcome-offer step entirely. Two copies
 * also meant two places to fix the next bug.
 *
 * The component renders only the steps -- the host owns its own chrome, which is
 * what lets one flow sit inside the checkout overlay and inside the Account page.
 * `variant` covers the two things that genuinely differ: the overlay can be
 * dismissed with Escape and cancels its own safe-area top padding, while the page
 * cancels its py-6 instead. Everything else -- steps, OTP, analytics and the guest
 * exit -- is identical.
 */
export default function LoginFlow({ onClose, onSuccess, pendingCheckout, onGuest, variant = 'modal', showGuestLink = true, onStepChange, onNavigateLegal, showPhoneHeading = true, backSignal }: LoginFlowProps) {
  const isModal = variant === 'modal';
  // See useFinePointer: auto-focusing a field on a phone opens the keyboard on
  // arrival and the browser scrolls to it, which is the page shake we are avoiding.
  const finePointer = useFinePointer();
  const restoredFlow = useLoginFlowStore.getState().getActiveOtpFlow();
  const [step, setStep] = useState<Step>(() => restoredFlow ? 'otp' : 'phone');

  // Held in a ref so an inline arrow from the host cannot re-fire this every
  // render; the effect should depend on the step changing, nothing else.
  const stepChangeRef = useRef(onStepChange);
  stepChangeRef.current = onStepChange;
  useEffect(() => { stepChangeRef.current?.(step); }, [step]);

  // Back chevron hosted by the Account page's green app bar: it is outside this
  // component, so it nudges the flow back to the phone step through this counter.
  useEffect(() => {
    if (!backSignal) return;
    setStep(prev => (prev === 'otp' ? 'phone' : prev));
    setOtp('');
    setError('');
  }, [backSignal]);
  const [phone, setPhone] = useState(() => restoredFlow?.phone || '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [welcomeOffer, setWelcomeOffer] = useState<any | null>(null);
  const [resendTimer, setResendTimer] = useState(() => restoredFlow ? Math.max(0, Math.ceil((restoredFlow.resendAvailableAt - Date.now()) / 1000)) : 0);
  const [newName, setNewName] = useState('');
  // A new customer's verified token, held until the mandatory name (and any
  // welcome offer) is done. We deliberately do NOT commit the login at OTP
  // verification: committing flips `isLoggedIn`, which unmounts this flow on the
  // Account page and would cut the profile/offer steps short.
  const stagedAuthRef = useRef<{ token: string; customer: any } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const { login } = useCustomerAuthStore();
  const { setPhone: savePhone, setName, addAddress } = useCustomerStore();
  const loginFlow = useLoginFlowStore();

  useEffect(() => {
    if (step !== 'otp') return;
    const updateTimer = () => {
      const activeFlow = useLoginFlowStore.getState().getActiveOtpFlow();
      if (!activeFlow) {
        setStep('phone');
        setOtp('');
        setResendTimer(0);
        setError('Your OTP has expired. Please request a new one.');
        return;
      }
      setResendTimer(Math.max(0, Math.ceil((activeFlow.resendAvailableAt - Date.now()) / 1000)));
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [step]);



  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit number'); return; }
    setLoading(true); setError('');
    try {
      await authApi.sendOtp(cleaned);
      track('otp_requested', { otpChannel: 'phone_call' });
      loginFlow.beginOtp(cleaned, !!pendingCheckout);
      setPhone(cleaned);
      setStep('otp');
      setResendTimer(30);
    } catch (err: any) {
      if (!err?.response) setError('No internet connection. Please try again.');
      else setError(err?.response?.data?.error || 'Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) { setError('Enter the 6-digit OTP'); return; }
    setLoading(true); setError('');
    try {
      track('otp_entered', { otpChannel: 'phone_call' });
      const res = await authApi.verifyOtp(phone.replace(/\D/g, ''), otp, getFunnelSessionId(), readTrackingTokens());
      track('login_verified');
      const { token, customer } = res.data.data;
      loginFlow.clear();
      savePhone(customer.phone);
      // The server already moved this device's guest push rows onto the customer
      // id (via trackingTokens above). Re-subscribe against the account so the
      // browser's current endpoint also lands on the member row. Best-effort.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        subscribeToPush().catch(() => {});
      }
      // Returning customer (already has a name) — commit straight away.
      if (customer.name) {
        login(token, customer);
        setName(customer.name);
        if (customer.address) addAddress({ label: 'Home', address: customer.address, isDefault: true });
        onSuccess?.();
        onClose?.();
      } else {
        // New customer: the name is mandatory. Stage the verified token instead
        // of logging in yet (see stagedAuthRef) and go to the full-page "Almost
        // there" capture. The welcome offer (if any) is fetched meanwhile and
        // plays after the name is saved — see handleSaveProfile.
        stagedAuthRef.current = { token, customer };
        campaignApi.getWelcome(0, '').then(r => {
          const offers = r.data.data || [];
          if (offers.length > 0) setWelcomeOffer(offers[0]);
        }).catch(() => { /* offer is optional; name capture still proceeds */ });
        setStep('profile');
      }
    } catch (err: any) {
      track('otp_verification_failed', {
        otpChannel: 'phone_call',
        reason: err?.response?.status === 401 ? 'incorrect' : 'request_failed',
      });
      if (!err?.response) setError('No internet connection. Please try again.');
      else setError(err?.response?.data?.error || 'Invalid OTP. Try again.');
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    setLoading(true); setError(''); setOtp('');
    try {
      await authApi.sendOtp(phone.replace(/\D/g, ''));
      loginFlow.markOtpResent();
      setResendTimer(30);
    } catch (err: any) {
      if (!err?.response) setError('No internet connection. Please try again.');
      else setError(err?.response?.data?.error || 'Failed to resend OTP.');
    } finally { setLoading(false); }
  };

  // Commits the staged new-customer login. Runs only once the mandatory name (and
  // the optional welcome offer) is finished, which is what keeps this flow mounted
  // through those steps.
  const finalizeLogin = () => {
    const staged = stagedAuthRef.current;
    if (staged) {
      const finalName = useCustomerAuthStore.getState().name || undefined;
      login(staged.token, { ...staged.customer, name: finalName });
      if (staged.customer.address) addAddress({ label: 'Home', address: staged.customer.address, isDefault: true });
      stagedAuthRef.current = null;
    }
    onSuccess?.();
    onClose?.();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedName = newName.trim().replace(/\s+/g, ' ');
    if (normalizedName.length < 2 || normalizedName.length > 80 || !/\p{L}/u.test(normalizedName)) {
      setError('Enter a valid name using at least 2 characters.');
      return;
    }
    setSavingProfile(true); setError('');
    try {
      await authApi.updateProfile({ name: normalizedName }, stagedAuthRef.current?.token);
      useCustomerAuthStore.getState().updateProfile({ name: normalizedName });
      setName(normalizedName);
      if (welcomeOffer) {
        // New customers with an active welcome campaign see it once, right after
        // giving their name.
        trackCampaignTouch(welcomeOffer.id);
        setStep('offer');
      } else {
        finalizeLogin();
      }
    } catch {
      setError('Failed to save. Please try again.');
    } finally { setSavingProfile(false); }
  };

  // "Login is optional": a shopper mid-login can drop out and still order as a
  // guest. Dropping the OTP flow here is intentional — no expired-flow nudge
  // should ever repin them to a login they decided to skip.
  const handleGuest = () => {
    // The X button used to be the only source of this event, so without moving
    // the track() call here the hub's journey-events panel would silently lose
    // login_abandoned the moment the cross was removed.
    if (step === 'phone' || step === 'otp') {
      track('login_abandoned', { step, reason: 'guest' });
    }
    loginFlow.clear();
    onGuest?.();
  };

  const handlePhoneBlur = () => {
    // iOS restores the visual viewport after blur, while Android first resizes
    // the layout viewport. Wait for either keyboard animation to finish before
    // restoring the page instead of leaving the login hero scrolled mid-page.
    window.setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }), 240);
  };

  /**
   * Keyboard exit for an aria-modal dialog. With the cross gone this is the only
   * non-pointer way out, and it routes through the guest path deliberately:
   * the sole caller always passes onGuest, which resumes checkout. The old X
   * called onClose, which cleared pendingCheckout without restoring checkout —
   * so dismissing that way dropped a shopper out of the checkout they were in.
   *
   * Overlay only: this listener is global, and the Account page is not a dialog,
   * so binding Escape there would hijack the key for the whole page.
   */
  useEffect(() => {
    if (!isModal || (step !== 'phone' && step !== 'otp')) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (onGuest) handleGuest(); else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onGuest, isModal]);

  const digits = phone.replace(/\D/g, '');
  const phoneValid = digits.length === 10;

  const ErrorNote = ({ id }: { id: string }) => error ? (
    <p id={id} role="alert" aria-live="polite"
      className="mb-3 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {error}
    </p>
  ) : null;

  const Spinner = () => <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />;

  // This is now the only way out of the login flow on every step, so it carries
  // the 44px WCAG 2.2 target floor the cross used to provide: py-2 on 13px text
  // is only ~34px tall.
  const GuestLink = () => (onGuest && showGuestLink) ? (
    <button type="button" onClick={handleGuest}
      className="flex min-h-[44px] w-full items-center justify-center py-2 text-center text-[13px] font-bold text-gokez-700 hover:text-gokez-800 dark:text-gokez-400 dark:hover:text-gokez-300 transition-colors focus-visible:outline-none focus-visible:underline">
      Continue as guest →
    </button>
  ) : null;

  const primaryBtn = (enabled = true) =>
    `flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[17px] font-bold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed dark:focus-visible:ring-offset-slate-800 ${enabled
      ? 'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-600'
      : 'bg-gray-200 text-gray-500 focus-visible:ring-gray-400 dark:bg-slate-700 dark:text-slate-400'}`;

  return (
    <>
          {step === 'offer' && welcomeOffer ? (
            <>
              <div className="text-center mb-5">
                <div className={`w-full h-24 rounded-2xl bg-gradient-to-br ${welcomeOffer.carousel_gradient || 'from-gokez-600 via-gokez-700 to-gokez-900'} flex flex-col items-center justify-center mb-4 relative overflow-hidden`}>
                  <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/10" />
                  {welcomeOffer.badge_text && <span className="text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full mb-1">{welcomeOffer.badge_text}</span>}
                  <p className="text-2xl font-black text-white drop-shadow">
                    {welcomeOffer.discount_type === 'flat' ? `₹${welcomeOffer.discount_value} OFF` :
                     welcomeOffer.discount_type === 'percent' ? `${welcomeOffer.discount_value}% OFF` : 'FREE DELIVERY'}
                  </p>
                </div>
                <h2 id="login-title" className="text-base font-bold text-gray-900 dark:text-white mb-1">{welcomeOffer.title} 🎉</h2>
                <p className="text-sm text-gray-500 dark:text-gray-500">{welcomeOffer.subtitle || 'Applied automatically at checkout'}</p>
                {welcomeOffer.coupon_code && (
                  <div className="mt-2 inline-flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold px-3 py-1.5 rounded-xl">
                    <Tag className="w-3.5 h-3.5" />
                    Code: <span className="font-mono">{welcomeOffer.coupon_code}</span>
                  </div>
                )}
              </div>
                <button onClick={finalizeLogin} className={primaryBtn()}>
                <ArrowRight className="h-4 w-4" aria-hidden="true" /> Start Shopping
              </button>
            </>
          ) : step === 'profile' ? (
            // Capturing the name is mandatory for a new customer, so this is a
            // self-contained full-page sheet with its own green app bar (no back
            // button and no guest exit). It renders above whatever hosted the
            // flow, so the account page and the checkout overlay behave the same.
            <div className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-900">
              <div className="relative shrink-0 bg-gradient-to-r from-[#09623a] to-[#087a43] pt-[env(safe-area-inset-top)] dark:from-[#18191a] dark:to-[#18191a]">
                <div className="h-14" />
              </div>

              <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-9">
                <h2 id="login-title" className="text-[clamp(22px,7vw,30px)] font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white">
                  Almost there.
                </h2>
                <p className="mt-2 max-w-[24rem] text-[14px] leading-snug text-slate-500 dark:text-slate-400">
                  Tell us your name so we know who to hand the order to
                </p>

                <form onSubmit={handleSaveProfile} className="mt-6 space-y-3">
                  <ErrorNote id="login-error" />
                  <label htmlFor="login-name" className="sr-only">Your full name</label>
                  <input id="login-name" name="name" type="text" value={newName} autoComplete="name"
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Your full name *"
                    aria-invalid={Boolean(error)}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-2xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-gokez-500 focus:ring-2 focus:ring-gokez-500/20 transition-all"
                    autoFocus={finePointer} />
                  <button type="submit" disabled={savingProfile || !newName.trim()} className={primaryBtn(Boolean(newName.trim()))}>
                    {savingProfile
                      ? <Spinner />
                      : <><ArrowRight className="h-4 w-4" aria-hidden="true" /> {pendingCheckout ? 'Continue to Checkout' : 'Continue'}</>
                    }
                  </button>
                </form>
              </div>
            </div>
          ) : step === 'phone' ? (
            <>
              {showPhoneHeading && (
                <div className="mb-5 text-center">
                  <h2 id="login-title" className="text-[19px] font-bold leading-tight text-slate-900 dark:text-white">
                    Log in or sign up
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
                    Enter your mobile number to continue
                  </p>
                </div>
              )}

              <form onSubmit={handleSendOtp} className="space-y-3">
                <ErrorNote id="login-error" />

                <label htmlFor="login-phone" className="sr-only">Mobile number</label>
                <div className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-slate-50 px-4 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-200 dark:border-slate-600 dark:bg-slate-700/60 dark:focus-within:border-slate-400 dark:focus-within:ring-slate-500/30">
                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <svg aria-hidden="true" viewBox="0 0 90 60" className="h-6 w-9 shrink-0 overflow-hidden rounded-[2px] border border-slate-300 shadow-sm">
                      <rect width="90" height="20" fill="#ff9933" />
                      <rect y="20" width="90" height="20" fill="#ffffff" />
                      <rect y="40" width="90" height="20" fill="#138808" />
                      <g stroke="#000080" strokeWidth="1.2" strokeLinecap="round">
                        <circle cx="45" cy="30" r="8" fill="none" />
                        <line x1="45" y1="22" x2="45" y2="29" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(15 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(30 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(45 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(60 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(75 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(90 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(105 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(120 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(135 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(150 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(165 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(180 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(195 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(210 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(225 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(240 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(255 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(270 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(285 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(300 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(315 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(330 45 30)" />
                        <line x1="45" y1="22" x2="45" y2="29" transform="rotate(345 45 30)" />
                        <circle cx="45" cy="30" r="1.4" fill="#000080" stroke="none" />
                      </g>
                    </svg>
                    <span>+91</span>
                  </span>
                  <span className="h-4 w-px bg-slate-300 dark:bg-slate-500" aria-hidden="true" />
                  <input
                    id="login-phone" name="phone" type="tel" value={phone} maxLength={10}
                    onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
                    onFocus={() => {
                      trackOnce('login_field_focused');
                    }}
                    onBlur={handlePhoneBlur}
                    placeholder="Enter mobile number"
                    inputMode="numeric" autoComplete="tel"
                    aria-invalid={Boolean(error)}
                    className="flex-1 bg-transparent py-2.5 text-[15px] font-medium tracking-wide text-slate-900 dark:text-white placeholder:text-gray-500 placeholder:font-normal placeholder:tracking-normal focus:outline-none"
                    autoFocus={finePointer} />
                </div>

                <button type="submit" disabled={loading || !phoneValid} className={primaryBtn(phoneValid)}>
                  {loading ? <Spinner /> : <>Continue with OTP</>}
                </button>
                <GuestLink />
              </form>

              <p className="!mt-1 text-center text-[11px] leading-snug text-gray-500 dark:text-slate-400">
                By continuing, you agree to our{' '}
                <button type="button" onClick={() => onNavigateLegal?.('/terms/')} className="font-normal text-current underline decoration-dotted underline-offset-2">Terms</button>{' '}
                and{' '}
                <button type="button" onClick={() => onNavigateLegal?.('/privacy/')} className="font-normal text-current underline decoration-dotted underline-offset-2">Privacy Policy</button>.
              </p>
            </>
          ) : (
            <>
              <div className="text-center">
                <h2 id="login-title" className="text-[19px] font-bold leading-tight text-slate-900 dark:text-white">
                  OTP Verification
                </h2>
                <p className="mx-auto mt-1 max-w-[22rem] text-center text-[11px] text-slate-500 dark:text-slate-400">
                  We'll call you with a 6-digit code
                </p>
                <div className="mt-2 flex flex-col items-center gap-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <p className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-slate-600 dark:text-slate-300">Sent to</span>
                    <span>{digits}</span>
                  </p>
                  <button type="button" onClick={() => { loginFlow.clear(); setStep('phone'); setOtp(''); setError(''); }}
                    className="-my-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-2 text-xs font-bold text-gokez-700 underline underline-offset-2 hover:text-gokez-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-500 dark:text-gokez-400">
                    Change number
                  </button>
                </div>
              </div>

              <form onSubmit={handleVerifyOtp} className="mt-3 space-y-2">
                <ErrorNote id="login-error" />
                <label htmlFor="login-otp" className="sr-only">6-digit verification code</label>
                <input
                  id="login-otp" name="otp" type="tel" value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder="6-digit OTP"
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  aria-invalid={Boolean(error)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-xl font-bold tracking-[0.45em] text-slate-900 dark:border-slate-600 dark:bg-slate-700/60 dark:text-white focus:outline-none focus:border-gokez-500 focus:ring-2 focus:ring-gokez-500/20 transition-all"
                  autoFocus={finePointer} />
                <button type="submit" disabled={loading || otp.length !== 6} className={primaryBtn(otp.length === 6)}>
                  {loading ? <Spinner /> : <>Verify</>}
                </button>
                <button type="button" onClick={handleResend} disabled={resendTimer > 0 || loading}
                  className="flex min-h-[44px] w-full items-center justify-center rounded-2xl py-2 text-sm font-bold text-gokez-700 transition-colors hover:text-gokez-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gokez-400 dark:hover:text-gokez-300">
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </button>
                <GuestLink />
              </form>
            </>
          )}

    </>
  );
}
