import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { subscribeAdminToPush } from '../services/push';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await authApi.login(username, password);
      const d = res.data.data;
      login(d.token, { username: d.username, name: d.name || d.username, email: d.email, phone: d.phone, role: d.role, storeId: d.storeId });
      subscribeAdminToPush().catch(() => {});
      navigate('/');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setError('Invalid username or password');
      } else if (!err?.response) {
        setError('Unable to connect. Please check your internet connection.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <img src="/mart_hub_brand_logo.png" alt="Gokez Mart" className="h-12 w-auto object-contain mb-2" />
          <p className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Admin Portal</p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-6">

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Username</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                required autoFocus placeholder="Enter your username"
                className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  required placeholder="Enter your password"
                  className="w-full px-4 py-3 pr-11 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-slate-500 mt-4">
          By signing in, you agree to our{' '}
          <a href="https://gokez.com/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-600 dark:text-slate-300 hover:underline">Terms of Use</a>
        </p>
        <p className="text-center text-xs text-gray-400 dark:text-slate-500 mt-1">
          &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
        </p>
      </div>
    </div>
  );
}
