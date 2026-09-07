import { useState, useEffect } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';

const inp = 'w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400';

export default function DeleteAccountPage() {
  const { logout } = useCustomerAuthStore();
  const [existing, setExisting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    authApi.getDeletionStatus().then(r => setExisting(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async () => {
    if (!confirm) return;
    setSubmitting(true); setError('');
    try {
      await authApi.requestDeletion(reason.trim() || undefined);
      setSubmitted(true);
      setTimeout(() => { logout(); }, 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit request.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.history.back()} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900 dark:text-white">Delete My Account</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 pb-24 space-y-4">

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : submitted ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-6 text-center">
            <p className="text-2xl mb-3">✓</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Request Submitted</p>
            <p className="text-xs text-gray-400 dark:text-slate-500">Your account deletion request has been submitted. We will process it within 30 days. You will be signed out shortly.</p>
          </div>
        ) : existing?.status === 'pending' ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-2xl p-4">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-1">Request Already Submitted</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">Your deletion request is pending review. We will process it within 30 days.</p>
            <p className="text-[10px] text-amber-500 mt-2">Submitted: {new Date(existing.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        ) : (
          <>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-700 dark:text-red-400 mb-1">This action is permanent</p>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc list-inside">
                  <li>Your account and personal data will be permanently deleted</li>
                  <li>Your order history will be anonymised</li>
                  <li>This cannot be undone</li>
                </ul>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Reason (optional)</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} className={`${inp} resize-none`} rows={3} placeholder="Tell us why you're leaving (optional)" />
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-0.5 w-4 h-4 accent-red-500 flex-shrink-0" />
                <span className="text-xs text-gray-600 dark:text-slate-400">I understand this will permanently delete my account and all associated data.</span>
              </label>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button onClick={handleSubmit} disabled={submitting || !confirm}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : 'Request Account Deletion'}
              </button>
            </div>

            <p className="text-[10px] text-gray-400 dark:text-slate-500 text-center px-4">
              Under the DPDP Act 2023, you have the right to request deletion of your personal data. We will process your request within 30 days.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
