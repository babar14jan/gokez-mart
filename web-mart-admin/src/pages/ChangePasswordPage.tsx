import { useState } from 'react';
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';

const inp = (extra = '') => `w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 text-gray-900 dark:text-white placeholder:text-gray-400 transition-all pr-11 ${extra}`;

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPass.length < 8) { setError('New password must be at least 8 characters'); return; }
    if (newPass !== confirm) { setError('Passwords do not match'); return; }
    setSaving(true);
    try {
      await api.put('/admin/change-password', { currentPassword: current, newPassword: newPass });
      setSaved(true);
      setCurrent(''); setNewPass(''); setConfirm('');
      setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to change password');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-lg">

      <div className="page-card">
        <div className="page-card-header">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-gray-400 dark:text-slate-500" />
            <p className="page-card-title">Update Password</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-3 py-2.5 rounded-xl">{error}</div>}
          {saved && <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm px-3 py-2.5 rounded-xl">Password changed successfully ✓</div>}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Current Password</label>
            <div className="relative">
              <input type={showCurrent ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)}
                className={inp()} placeholder="Enter current password" required />
              <button type="button" onClick={() => setShowCurrent(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-slate-400">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">New Password</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)}
                className={inp()} placeholder="Min. 8 characters" required />
              <button type="button" onClick={() => setShowNew(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-slate-400">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">Confirm New Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 text-gray-900 dark:text-white placeholder:text-gray-400 transition-all ${confirm && confirm !== newPass ? 'border-red-300 dark:border-red-700' : confirm && confirm === newPass ? 'border-emerald-300 dark:border-emerald-700' : 'border-gray-200 dark:border-slate-600'}`}
              placeholder="Re-enter new password" required />
            {confirm && confirm === newPass && <p className="text-[11px] text-emerald-600 mt-1 font-medium">✓ Passwords match</p>}
          </div>

          <button type="submit" disabled={saving || !current || !newPass || !confirm}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white text-sm font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-50 transition-colors">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating...</> : <><KeyRound className="w-4 h-4" /> Change Password</>}
          </button>
        </form>
      </div>
    </div>
  );
}
