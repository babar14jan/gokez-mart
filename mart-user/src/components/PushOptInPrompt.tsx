import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import {
  enablePromotionalNotifications,
  isPushOptInDue,
  isPushSupported,
  PUSH_OPT_IN_REQUEST_EVENT,
  recordPushOptInPrompt,
  requestNotificationPermission,
  subscribeToPush,
  type PushOptInReason,
} from '../services/push';
import { PERMISSIONS_SEEN_KEY } from '../services/onboardingPermissions';
import { hasNativePushToken, isNativePush, requestNativePushPermission, syncNativePushAssociation } from '../services/nativePush';
import { useCustomerAuthStore } from '../store/customerAuthStore';

function canShowPushPrompt(): boolean {
  if (isNativePush()) return !hasNativePushToken();
  if (!isPushSupported()) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return false;
  return true;
}

function hasSeenPermissionsPage(): boolean {
  try {
    return localStorage.getItem(PERMISSIONS_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function PushOptInPrompt() {
  const isLoggedIn = useCustomerAuthStore((s) => s.isLoggedIn);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<PushOptInReason>('legacy');

  useEffect(() => {
    if (!isLoggedIn) return;
    if (hasSeenPermissionsPage()) return;
    if (!canShowPushPrompt()) return;
    if (!isPushOptInDue('legacy')) return;
    const timer = window.setTimeout(() => {
      setReason('legacy');
      setOpen(true);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [isLoggedIn]);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const requested = (event as CustomEvent<PushOptInReason>).detail;
      if (requested !== 'permissions-decline' && requested !== 'later-order') return;
      if (!canShowPushPrompt()) return;
      if (!isPushOptInDue(requested)) return;
      setReason(requested);
      setOpen(true);
    };
    window.addEventListener(PUSH_OPT_IN_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(PUSH_OPT_IN_REQUEST_EVENT, onRequest);
  }, []);

  const close = () => {
    setOpen(false);
    recordPushOptInPrompt(reason);
  };

  const accept = async () => {
    setBusy(true);
    try {
      let granted = false;
      if (isNativePush()) {
        granted = await requestNativePushPermission();
        if (granted) await syncNativePushAssociation();
      } else {
        const permission = await requestNotificationPermission();
        granted = permission === 'granted';
        if (granted) await subscribeToPush();
      }
      if (granted) {
        await enablePromotionalNotifications();
      }
    } finally {
      setBusy(false);
      close();
    }
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
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={close} className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-slate-600 dark:text-slate-200">
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
