import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ArrowRight, Tag, PhoneCall } from 'lucide-react';
import { authApi, campaignApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useFinePointer } from '../utils/useFinePointer';
import { subscribeToPush } from '../services/push';
import { useCustomerStore } from '../store/customerStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { getFunnelSessionId, track, trackCampaignTouch, trackOnce } from '../utils/track';

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
  /** Keeps a page host mounted after OTP verification until the required name saves. */
  onProfileRequired?: () => void;
  /**
   * Reports the visible step so a host that renders its OWN guest exit can emit
   * login_abandoned for the right step. AccountPage does exactly that, and without
   * this its button would silently drop the event the hub funnel counts.
   */
  onStepChange?: (step: Step) => void;
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
 * cancels its py-6 instead. Everything else -- steps, OTP, analytics, the guest
 * exit and the login art -- is identical.
 */
export default function LoginFlow({ onClose, onSuccess, pendingCheckout, onGuest, variant = 'modal', showGuestLink = true, onProfileRequired, onStepChange }: LoginFlowProps) {
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
  const [phone, setPhone] = useState(() => restoredFlow?.phone || '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [welcomeOffer, setWelcomeOffer] = useState<any | null>(null);
  const [resendTimer, setResendTimer] = useState(() => restoredFlow ? Math.max(0, Math.ceil((restoredFlow.resendAvailableAt - Date.now()) / 1000)) : 0);
  const [newName, setNewName] = useState('');
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
      const res = await authApi.verifyOtp(phone.replace(/\D/g, ''), otp, getFunnelSessionId());
      track('login_verified');
      const { token, customer } = res.data.data;
      loginFlow.clear();
      login(token, customer);
      savePhone(customer.phone);
      if (customer.name) setName(customer.name);
      if (customer.address) addAddress({ label: 'Home', address: customer.address, isDefault: true });
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') subscribeToPush().catch(() => {}); } catch {}
      // If returning customer (has name) — check for offers then done
      if (customer.name) {
        // Check for eligible campaigns
        campaignApi.getEligible(0, '').then(r => {
          const offers = r.data.data || [];
          if (offers.length > 0) {
            trackCampaignTouch(offers[0].id);
            setWelcomeOffer(offers[0]);
            setStep('offer');
          } else {
            onSuccess?.();
            onClose?.();
          }
        }).catch(() => { onSuccess?.(); onClose?.(); });
      } else {
        onProfileRequired?.();
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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedName = newName.trim().replace(/\s+/g, ' ');
    if (normalizedName.length < 2 || normalizedName.length > 80 || !/\p{L}/u.test(normalizedName)) {
      setError('Enter a valid name using at least 2 characters.');
      return;
    }
    setSavingProfile(true); setError('');
    try {
      await authApi.updateProfile({ name: normalizedName });
      useCustomerAuthStore.getState().updateProfile({ name: normalizedName });
      setName(normalizedName);
      onSuccess?.();
      onClose?.();
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
    document.documentElement.classList.remove('login-field-focused');

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
    if (!isModal || step === 'profile') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (onGuest) handleGuest(); else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onGuest, isModal]);

  const digits = phone.replace(/\D/g, '');
  const maskedPhone = digits.length > 4 ? `${'•'.repeat(6)}${digits.slice(-4)}` : digits;
  const phoneValid = digits.length === 10;

  // One size for both steps. The phone step used an 80px logo while the OTP
  // step used 48px for the same asset, and stacked a 56px icon tile underneath
  // it: 76px of decoration for one brand mark, which is what pushed the panel
  // past a 667px viewport. Smaller and consistent costs nothing visually.
  const BrandMark = () => (
    <div className="flex flex-col items-center">
      <img src="/mart_brand_new.png" alt="Gokez Mart"
        className="h-16 w-auto object-contain dark:hidden" />
      <img src="/mart_brand_dark.png" alt="Gokez Mart"
        className="h-16 w-auto object-contain hidden dark:block" />
      <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">
        Shop Local <span className="align-middle">&bull;</span> Support Local
      </p>
    </div>
  );

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
      className="flex min-h-[44px] w-full items-center justify-center py-2 text-center text-[13px] font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors focus-visible:outline-none focus-visible:underline">
      Continue as guest
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
                <div className={`w-full h-24 rounded-2xl bg-gradient-to-br ${welcomeOffer.carousel_gradient || 'from-violet-500 via-purple-600 to-indigo-600'} flex flex-col items-center justify-center mb-4 relative overflow-hidden`}>
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
                <button onClick={() => { onSuccess?.(); onClose?.(); }} className={primaryBtn()}>
                <ArrowRight className="h-4 w-4" aria-hidden="true" /> Start Shopping
              </button>
            </>
          ) : step === 'profile' ? (
            <>
              <div className="text-center mb-5">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl" aria-hidden="true">👋</span>
                </div>
                <h2 id="login-title" className="text-base font-bold text-gray-900 dark:text-white mb-1">Almost there!</h2>
                <p className="text-sm text-gray-500 dark:text-gray-500">Tell us your name so we can personalise your experience</p>
              </div>
              <ErrorNote id="login-error" />
              <form onSubmit={handleSaveProfile} className="space-y-3">
                <label htmlFor="login-name" className="sr-only">Your full name</label>
                <input id="login-name" name="name" type="text" value={newName} autoComplete="name"
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Your full name *"
                  aria-invalid={Boolean(error)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-2xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  autoFocus={finePointer} />
                <button type="submit" disabled={savingProfile || !newName.trim()} className={primaryBtn(Boolean(newName.trim()))}>
                  {savingProfile
                    ? <Spinner />
                    : <><ArrowRight className="h-4 w-4" aria-hidden="true" /> {pendingCheckout ? 'Continue to Checkout' : 'Continue'}</>
                  }
                </button>
              </form>
            </>
          ) : step === 'phone' ? (
            <>
              {/* One login visual for the whole app. The overlay used to show a
                    separate illustration from the Account page, so the same login
                    looked like two different screens; the page's Guest_page.webp is
                    now the only one, supplied by the flow for both hosts.

                    Never cropped: sized by its own intrinsic ratio (936x913) rather
                    than a capped-height object-cover box, which used to cut about a
                    third of it off on a phone. The host scrolls, so all of it shows.

                    Flush to the host edges at EVERY width, which is why there is no
                    inset/rounded "framed" variant on desktop. Two things that bit
                    here, both worth keeping in mind before editing:

                    1. `max-w-none` is load-bearing. Tailwind's preflight sets
                       `img { max-width: 100% }`, which clamps the bleed width back
                       to the container's content box no matter how wide `width`
                       says. Combined with -mx-5 that left a 40px gap down the right
                       and a flush left edge. This was the real cause; the `w-full`
                       clash below was only the secondary one.

                    2. `w-full` must NOT appear alongside the bleed width. Both set
                       `width`, so the one emitted later in the stylesheet wins the
                       cascade regardless of class order in the attribute -- and
                       Tailwind happened to emit `.w-full` after it. Only one width
                       rule per breakpoint, never two.

                    3. The bleed is arithmetically tied to each host's own padding:
                       px-5 (2.5rem) for the Account page at all widths, but the
                       overlay switches to px-7 (3.5rem) from sm up. Change either
                       host's padding and these two numbers have to move with it.
                       Both hosts clip (overflow-hidden) so the flush art takes the
                       card/dialog corner radius instead of needing its own. */}
              <img src="/Guest_page.webp" alt="Welcome to Gokez Mart"
                width={936} height={913} decoding="async"
                className={`login-art mb-4 block h-auto max-w-none -mx-5 w-[calc(100%_+_2.5rem)] rounded-none ${
                  isModal
                    ? '-mt-[max(1rem,env(safe-area-inset-top))] sm:-mx-7 sm:w-[calc(100%_+_3.5rem)]'
                    : '-mt-6'}`} />

              <form onSubmit={handleSendOtp} className="mt-6 space-y-3">
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
                      document.documentElement.classList.add('login-field-focused');
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
            </>
          ) : (
            <>
              <div className="rounded-3xl bg-gradient-to-b from-amber-100 via-lime-50 to-emerald-50 px-5 pb-3 pt-3 dark:from-amber-950/40 dark:via-slate-800 dark:to-emerald-950/30">
                <BrandMark />

                <h2 id="login-title" className="mt-3 text-center text-[19px] font-bold leading-tight text-slate-900 dark:text-white">
                  Enter the verification code
                </h2>
                <p className="mx-auto mt-1 flex max-w-[19rem] items-center justify-center gap-1.5 text-center text-[13px] text-gray-600 dark:text-slate-300">
                  <PhoneCall className="h-3.5 w-3.5 flex-shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span>We'll send you a 6-digit code via call</span>
                </p>
                <p className="mt-0.5 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  SMS OTP Coming soon
                </p>
                <p className="mt-1.5 text-center text-sm text-slate-700 dark:text-slate-200">
                  +91 {maskedPhone}
                  <button type="button" onClick={() => { loginFlow.clear(); setStep('phone'); setOtp(''); setError(''); }}
                    className="-my-2 ml-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-2 text-xs font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400">
                    Edit
                  </button>
                </p>
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
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-xl font-bold tracking-[0.45em] text-slate-900 dark:border-slate-600 dark:bg-slate-700/60 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  autoFocus={finePointer} />
                <button type="submit" disabled={loading || otp.length !== 6} className={primaryBtn(otp.length === 6)}>
                  {loading ? <Spinner /> : <>Verify &amp; Sign In</>}
                </button>
                <button type="button" onClick={handleResend} disabled={resendTimer > 0 || loading}
                  className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl py-2 text-sm text-gray-500 transition-colors hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </button>
                <GuestLink />
              </form>
            </>
          )}

    </>
  );
}
