import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { authApi } from '../services/api';
import { isPushSupported, requestNotificationPermission, subscribeToPush } from '../services/push';
import { useCustomerAuthStore } from '../store/customerAuthStore';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PROMPT_KEY = 'mart_push_prompt_at';

export default function PushOptInPrompt() {
  const isLoggedIn = useCustomerAuthStore((s) => s.isLoggedIn);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (!isPushSupported()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    const last = Number(localStorage.getItem(PROMPT_KEY) || 0);
    if (last && Date.now() - last < COOLDOWN_MS) return;
    const timer = window.setTimeout(() => setOpen(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  const accept = async () => {
    setBusy(true);
    try {
      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        await subscribeToPush();
        try { await authApi.updateMarketingConsent(true); } catch { /* best effort */ }
      }
    } finally {
      setBusy(false);
      setOpen(false);
      try { localStorage.setItem(PROMPT_KEY, String(Date.now())); } catch { /* noop */ }
    }
  };

  const decline = () => {
    setOpen(false);
    try { localStorage.setItem(PROMPT_KEY, String(Date.now())); } catch { /* noop */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[998] flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gokez-50 text-gokez-700 dark:bg-gokez-900/30 dark:text-gokez-400">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Stay updated</h2>
            <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
              Enable notifications for order updates and exclusive offers. You can turn them off anytime in Account.
            </p>
          </div>
          <button type="button" onClick={decline} aria-label="Close" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={decline} className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-slate-600 dark:text-slate-200">
            Not now
          </button>
          <button type="button" onClick={accept} disabled={busy} className="flex-1 rounded-xl bg-gokez-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Enabling...' : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  );
}
