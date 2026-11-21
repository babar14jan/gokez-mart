import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { subscribeAdminToPush } from '../services/push';
import HubLogoImage from '../components/HubLogoImage';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [error, setError] = useState('');
  // A phone keyboard springs open on mount when a field is auto-focused, which
  // scrolls the whole login card out of view. Only focus on mouse/trackpad.
  const [autoFocusEnabled] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches),
  );
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setLoadingTime(0);
    const timer = setInterval(() => setLoadingTime(t => t + 1), 1000);
    try {
      const res = await authApi.login(username, password);
      const d = res.data.data;
      login(d.token, { id: d.id, username: d.username, name: d.name || d.username, email: d.email, phone: d.phone, role: d.role, storeId: d.storeId, canAccessDailySales: d.canAccessDailySales });
      subscribeAdminToPush().catch(() => {});
      navigate('/');
    } catch (err: any) {
      const status = err?.response?.status;
      const isTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
      if (status === 401) setError('Invalid username or password.');
      else if (status === 429) setError('Too many attempts. Please wait a few minutes and try again.');
      else if (isTimeout) setError('Server is taking too long — please try again.');
      else if (!err?.response) setError('Cannot reach server. Check your internet connection and try again.');
      else setError('Something went wrong. Please try again.');
    } finally { clearInterval(timer); setLoading(false); }
  };

  return (
    <div className="auth-viewport flex min-h-screen flex-col bg-gray-50 dark:bg-slate-900">

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200/80 dark:border-slate-700/80 shadow-sm">
        <div className="mx-auto flex min-h-[3.5rem] max-w-5xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
          <HubLogoImage className="h-10 w-auto object-contain" />
          <a href="/hub" className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
            ← Home
          </a>
        </div>
      </header>

      {/* Centered content */}
      <div className="flex flex-1 items-center justify-center px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="mb-8 flex flex-col items-center">
            <div className="flex items-end justify-center gap-1.5">
              <HubLogoImage className="h-9 sm:h-10 w-auto object-contain" />
              <picture className="leading-none align-bottom translate-y-1">
                <source srcSet="/mart_hub_brand_logo.webp" type="image/webp" />
                <img
                  src="/mart_hub_brand_logo.png"
                  alt="Gokez Hub brand"
                  className="h-9 sm:h-10 w-auto object-contain"
                />
              </picture>
            </div>
            <p className="mt-3 text-xs font-bold uppercase text-gray-900 dark:text-white tracking-tight leading-tight text-center">
              Your Store <span className="text-sm align-middle">&bull;</span> Now Online
            </p>
          </div>

          {/* Form card */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl mb-5">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  required autoFocus={autoFocusEnabled} placeholder="Enter your username"
                  className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} required placeholder="Enter your password"
                    className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all" />
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-600 dark:hover:text-slate-200">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-600 disabled:opacity-50">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {loadingTime > 5 ? 'Server waking up...' : 'Signing in...'}</> : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Footer links */}
          <p className="text-center text-xs text-gray-500 dark:text-slate-400 mt-4">
            By signing in, you agree to our{' '}
            <a href="https://gokez.com/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-600 dark:text-slate-300 hover:underline">Terms of Use</a>
          </p>

          <div className="mt-5 text-center">
            <p className="text-xs text-gray-500 dark:text-slate-400">Want to bring your store online?</p>
            <a href="/apply" className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400">
              Apply to become a store partner →
            </a>
          </div>

          <p className="text-center text-xs text-gray-500 dark:text-slate-400 mt-4">
            &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
          </p>
        </div>
      </div>
    </div>
  );
}
