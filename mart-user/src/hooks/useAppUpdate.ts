import { useEffect, useRef } from 'react';
import { useLoginFlowStore } from '../store/loginFlowStore';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

// A deploy can be noticed twice at almost the same moment — once by the version
// poll and once by the new service worker taking control. Reload only once.
let reloadRequested = false;

export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);
  const pendingReload = useRef(false);
  const otpPhone = useLoginFlowStore(state => state.phone);
  const otpExpiresAt = useLoginFlowStore(state => state.expiresAt);
  const isOtpFlowActive = Boolean(otpPhone && otpExpiresAt && otpExpiresAt > Date.now());

  const reload = () => {
    // Never cut off an in-progress OTP — the customer would lose the code they
    // are typing. Defer until the flow ends (see the effect below).
    if (useLoginFlowStore.getState().getActiveOtpFlow()) {
      pendingReload.current = true;
      return;
    }
    if (reloadRequested) return;
    reloadRequested = true;
    window.location.reload();
  };

  const check = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (currentVersion.current === null) {
        currentVersion.current = v;
      } else if (currentVersion.current !== v) {
        reload();
      }
    } catch {}
    // Browsers only re-check sw.js on their own roughly once a day. Ask now so
    // the freshly deployed worker installs while the app is open.
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        registration?.update().catch(() => {});
      }
    } catch {}
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    // Re-check when user brings app to foreground — critical for iOS PWA
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    // The worker ships with skipWaiting()/clients.claim(), so a new deploy can
    // take control of an already-open app. Reload so the running code matches the
    // new controller. Skip the very first load, where the app starts uncontrolled
    // and there is nothing to refresh.
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const onControllerChange = () => reload();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    if (!isOtpFlowActive && pendingReload.current) window.location.reload();
  }, [isOtpFlowActive]);
}
