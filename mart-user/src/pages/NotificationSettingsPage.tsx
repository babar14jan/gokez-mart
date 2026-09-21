import { useState, useEffect } from 'react';
import { Bell, Megaphone } from 'lucide-react';
import { authApi } from '../services/api';
import {
  getNotificationPermission, requestNotificationPermission,
  subscribeToPush, unsubscribeFromPush,
} from '../services/push';

export default function NotificationSettingsPage() {
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [notifSubscribed, setNotifSubscribed] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    authApi.getMarketingConsent().then(r => setMarketingConsent(r.data.data.granted)).catch(() => {});
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg =>
          reg.pushManager.getSubscription().then(sub => setNotifSubscribed(!!sub))
        ).catch(() => {});
      }
    } catch {}
  }, []);

  const toggleMarketing = async () => {
    const next = !marketingConsent;
    setMarketingConsent(next);
    try { await authApi.updateMarketingConsent(next); }
    catch { setMarketingConsent(!next); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.history.back()} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900 dark:text-white">Notifications</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 space-y-4 pb-36">

        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1">Order Updates</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Bell className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">Order Notifications</span>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">
                {notifPermission === 'granted' ? (notifSubscribed ? 'On — rider dispatch & delivery alerts' : 'Permission granted — tap to enable') :
                 notifPermission === 'denied'  ? 'Blocked — enable in browser settings' :
                 notifPermission === 'unsupported' ? 'Not supported on this browser' :
                 'Get notified when rider is on the way & delivered'}
              </p>
            </div>
            {notifPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notifPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : notifPermission === 'granted' ? (
              <button
                onClick={async () => {
                  if (notifSubscribed) { await unsubscribeFromPush(); setNotifSubscribed(false); }
                  else { const ok = await subscribeToPush(); setNotifSubscribed(ok); }
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  notifSubscribed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'
                }`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  notifSubscribed ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            ) : (
              <button
                onClick={async () => {
                  const p = await requestNotificationPermission();
                  setNotifPermission(p);
                  if (p === 'granted') { const ok = await subscribeToPush(); setNotifSubscribed(ok); }
                }}
                className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 dark:bg-slate-600 transition-colors focus:outline-none">
                <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow translate-x-0 transition duration-200" />
              </button>
            )}
          </div>
        </div>

        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1">Marketing</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Megaphone className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-200">Promotional Notifications</p>
              <p className="text-[10px] text-gray-500 dark:text-slate-400">Offers, deals and new arrivals</p>
            </div>
            <button onClick={toggleMarketing} role="switch" aria-checked={marketingConsent}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${marketingConsent ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${marketingConsent ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <p className="text-[11px] text-gray-500 dark:text-slate-400 px-1 leading-relaxed">
          Order updates are essential to fulfilling your orders. Marketing consent is optional and can be withdrawn anytime.
        </p>
      </div>
    </div>
  );
}
