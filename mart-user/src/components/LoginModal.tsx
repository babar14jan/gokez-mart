import { useState } from 'react';
import { X, RefreshCw, ShieldCheck } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { subscribeToPush } from '../services/push';
import { useCustomerStore } from '../store/customerStore';

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 'phone' | 'otp';

export default function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(0);

  const { login } = useCustomerAuthStore();
  const { setPhone: savePhone, setName, addAddress } = useCustomerStore();

  const startResendTimer = () => {
    setResendTimer(30);
    const t = setInterval(() => {
      setResendTimer(s => { if (s <= 1) { clearInterval(t); return 0; } return s - 1; });
    }, 1000);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit number'); return; }
    setLoading(true); setError('');
    try {
      await authApi.sendOtp(cleaned);
      setStep('otp');
      startResendTimer();
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
      const res = await authApi.verifyOtp(phone.replace(/\D/g, ''), otp);
      const { token, customer } = res.data.data;

      // Login to auth store (90-day JWT)
      login(token, customer);
      savePhone(customer.phone);
      if (customer.name) setName(customer.name);
      if (customer.address) addAddress({ label: 'Home', address: customer.address, isDefault: true });
      // Only subscribe if permission already granted (don't ask here)
      if (Notification.permission === 'granted') subscribeToPush().catch(() => {});
      onSuccess?.();
      onClose();
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
      startResendTimer();
    } catch (err: any) {
      if (!err?.response) setError('No internet connection. Please try again.');
      else setError(err?.response?.data?.error || 'Failed to resend OTP.');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl p-6">

        <div className="flex items-center justify-end mb-5">
          <button onClick={onClose} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'phone' ? (
          <>
            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-1 text-center">Welcome to GokezMart 👋</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5 text-center">
              Enter your mobile number to continue
            </p>
            {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2 rounded-xl mb-4">{error}</div>}
            <form onSubmit={handleSendOtp} className="space-y-3">
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-2xl px-4 py-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
                <span className="text-sm font-semibold text-gray-500 dark:text-slate-400 flex-shrink-0">+91</span>
                <div className="w-px h-4 bg-gray-300 dark:bg-slate-500" />
                <input
                  type="tel" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
                  placeholder="10-digit mobile number"
                  className="flex-1 bg-transparent text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none"
                  autoFocus inputMode="numeric"
                />
              </div>
              <button type="submit" disabled={loading || phone.replace(/\D/g,'').length !== 10}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm">
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Send OTP</>}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Enter OTP</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
              Sent to <span className="font-semibold text-gray-700 dark:text-slate-300">+91 {phone}</span>
              <button onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                className="ml-2 text-emerald-600 text-xs font-semibold hover:underline">Change</button>
            </p>
            {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2 rounded-xl mb-4">{error}</div>}
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <input
                type="tel" value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
                placeholder="6-digit OTP"
                className="w-full text-center text-2xl font-bold tracking-[0.5em] bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-2xl px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                autoFocus inputMode="numeric" maxLength={6}
              />
              <button type="submit" disabled={loading || otp.length !== 6}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm">
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Verify & Sign In</>}
              </button>
              <button type="button" onClick={handleResend} disabled={resendTimer > 0 || loading}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-emerald-600 disabled:opacity-50 transition-colors py-1">
                <RefreshCw className="w-3.5 h-3.5" />
                {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
              </button>
            </form>
          </>
        )}

        <div className="flex items-center justify-center gap-1.5 mt-4 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-full w-fit mx-auto">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Your data is secure. We never share your information.</span>
        </div>
        <p className="text-center text-[10px] text-gray-400 dark:text-slate-500 mt-3">
          By continuing, you agree to our{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer"
            className="font-semibold text-gray-600 dark:text-slate-300 hover:underline">
            Terms
          </a>
          {' '}&amp;{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer"
            className="font-semibold text-gray-600 dark:text-slate-300 hover:underline">
            Privacy Policy
          </a>
        </p>
        <p className="text-center text-[10px] text-gray-400 dark:text-slate-500 mt-1">
          &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
        </p>
      </div>
    </div>
  );
}
