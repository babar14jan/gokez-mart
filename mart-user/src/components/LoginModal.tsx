import { useEffect, useState } from 'react';
import { X, RefreshCw, ShieldCheck, ArrowRight, Tag, PhoneCall } from 'lucide-react';
import { authApi, campaignApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { subscribeToPush } from '../services/push';
import { useCustomerStore } from '../store/customerStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { getFunnelSessionId, track, trackCampaignTouch, trackOnce } from '../utils/track';
import ConfirmDialog from './ConfirmDialog';

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  pendingCheckout?: boolean;
  onGuest?: () => void;
}

type Step = 'phone' | 'otp' | 'profile' | 'offer';

export default function LoginModal({ onClose, onSuccess, pendingCheckout, onGuest }: LoginModalProps) {
  const restoredFlow = useLoginFlowStore.getState().getActiveOtpFlow();
  const [step, setStep] = useState<Step>(() => restoredFlow ? 'otp' : 'phone');
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

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleConfirmCancel = () => {
    loginFlow.clear();
    setShowCancelConfirm(false);
    onClose();
  };

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

  const handleClose = () => {
    if (step === 'phone' || step === 'otp') {
      track('login_abandoned', { step, reason: 'closed' });
    }
    if (step === 'otp') {
      setShowCancelConfirm(true);
      return;
    }
    loginFlow.clear();
    onClose();
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit number'); return; }
    setLoading(true); setError('');
    try {
      await authApi.sendOtp(cleaned);
      track('otp_requested');
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
            onClose();
          }
        }).catch(() => { onSuccess?.(); onClose(); });
      } else {
        // New customer — collect name + address
        setStep('profile');
      }
    } catch (err: any) {
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
    if (!newName.trim()) { setError('Please enter your name'); return; }
    setSavingProfile(true); setError('');
    try {
      await authApi.updateProfile({ name: newName.trim() });
      useCustomerAuthStore.getState().updateProfile({ name: newName.trim() });
      setName(newName.trim());
      onSuccess?.();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally { setSavingProfile(false); }
  };

  // "Login is optional": a shopper mid-login can drop out and still order as a
  // guest. Dropping the OTP flow here is intentional — no expired-flow nudge
  // should ever repin them to a login they decided to skip.
  const handleGuest = () => {
    loginFlow.clear();
    onGuest?.();
  };

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

  const GuestLink = () => onGuest ? (
    <button type="button" onClick={handleGuest}
      className="w-full py-2 text-center text-[13px] font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors focus-visible:outline-none focus-visible:underline">
      Continue as guest
    </button>
  ) : null;

  const primaryBtn =
    'flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-3 text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-800';

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="relative flex w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-800 min-h-[100dvh] sm:min-h-0 sm:rounded-3xl">

        <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-7">

          <div className="flex justify-end">
            <button type="button" onClick={handleClose}
              aria-label={step === 'otp' ? 'Cancel login' : 'Close login'}
              className="-mr-2 grid h-11 w-11 place-items-center rounded-2xl text-gray-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-slate-400 dark:hover:bg-slate-700">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

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
              <button onClick={() => { onSuccess?.(); onClose(); }} className={primaryBtn}>
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
                  autoFocus />
                <button type="submit" disabled={savingProfile || !newName.trim()} className={primaryBtn}>
                  {savingProfile
                    ? <Spinner />
                    : <><ArrowRight className="h-4 w-4" aria-hidden="true" /> {pendingCheckout ? 'Continue to Checkout' : 'Continue'}</>
                  }
                </button>
                <button type="button" onClick={() => { onSuccess?.(); onClose(); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-600 dark:text-slate-300 py-1 transition-colors">
                  Skip for now
                </button>
                <GuestLink />
              </form>
            </>
          ) : step === 'phone' ? (
            <>
              <div className="rounded-3xl bg-gradient-to-b from-emerald-50 via-lime-50 to-amber-100 px-5 pb-3 pt-3 dark:from-emerald-950/30 dark:via-slate-800 dark:to-amber-950/40">
                <BrandMark />

                <h2 id="login-title" className="mt-3 text-center text-[19px] font-bold leading-tight text-slate-900 dark:text-white">
                  Enter your mobile number
                </h2>
                <p className="mx-auto mt-1 text-center text-[13px] text-gray-600 dark:text-slate-300 whitespace-nowrap">
                  We'll use it to keep your orders and account secure.
                </p>
              </div>

              <form onSubmit={handleSendOtp} className="mt-3 space-y-2.5">
                <ErrorNote id="login-error" />

                <label htmlFor="login-phone" className="sr-only">Mobile number</label>
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-700/60">
                  <span className="text-sm font-semibold text-gray-500 dark:text-slate-400">+91</span>
                  <span className="h-4 w-px bg-slate-300 dark:bg-slate-500" aria-hidden="true" />
                  <input
                    id="login-phone" name="phone" type="tel" value={phone} maxLength={10}
                    onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
                    onFocus={() => trackOnce('login_field_focused')}
                    placeholder="10-digit mobile number"
                    inputMode="numeric" autoComplete="tel"
                    aria-invalid={Boolean(error)}
                    className="flex-1 bg-transparent py-2.5 text-[15px] font-medium tracking-wide text-slate-900 dark:text-white placeholder:text-gray-500 placeholder:font-normal placeholder:tracking-normal focus:outline-none"
                    autoFocus />
                </div>

                <button type="submit" disabled={loading || !phoneValid} className={primaryBtn}>
                  {loading ? <Spinner /> : <>Continue with OTP</>}
                </button>
                <GuestLink />
              </form>

              <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/20 text-center">
                <p className="flex items-center justify-center gap-1.5 text-[12px] font-bold leading-snug text-slate-800 dark:text-slate-100">
                  <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  Your number is private.
                </p>
                <p className="mt-0.5 pl-5 text-[12px] leading-snug text-gray-500 dark:text-slate-400 text-center">
                  We never share it. No spam, only order and account updates.
                </p>
              </div>
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
                  autoFocus />
                <button type="submit" disabled={loading || otp.length !== 6} className={primaryBtn}>
                  {loading ? <Spinner /> : <>Verify &amp; Sign In</>}
                </button>
                <button type="button" onClick={handleResend} disabled={resendTimer > 0 || loading}
                  className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl py-2 text-sm text-gray-500 transition-colors hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </button>
              </form>
            </>
          )}

          {(step === 'phone' || step === 'otp') && (
            <div className="mt-auto pt-3 text-center">
              <p className="text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                By continuing, you agree to our{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-slate-700 underline underline-offset-2 hover:text-emerald-700 dark:text-slate-300">
                  Terms
                </a>
                {' '}&amp;{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-slate-700 underline underline-offset-2 hover:text-emerald-700 dark:text-slate-300">
                  Privacy Policy
                </a>
              </p>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
                &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
              </p>
            </div>
          )}
        </div>
      </div>

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel login?"
          message="You'll need to request a new OTP to sign in."
          confirmLabel="Cancel login"
          cancelLabel="Keep trying"
          danger
          onConfirm={handleConfirmCancel}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
    </div>
  );
}
