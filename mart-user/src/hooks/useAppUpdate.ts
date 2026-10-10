import { useEffect, useRef } from 'react';
import { useLoginFlowStore } from '../store/loginFlowStore';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
// After an update is detected, apply it once the customer either goes to the
// background (dropdown to another app / lock / tab switch) or stays inactive
// on this screen for a full minute. An active customer is never interrupted.
const QUIET_MS = 60 * 1000;

// A deploy can be noticed twice at almost the same moment — once by the version
// poll and once by the new service worker taking control. Reload only once.
let reloadRequested = false;
let updatePending = false;

// Reload the page the moment the app is no longer the thing the customer is
// looking at. Everything needed to render the new version is already flooded
// into the service worker cache during `registration.update()` below, so the
// swap is served locally and reads as a fast, smooth transition instead of the
// white "app is reopening" shutter a network-bound reload produces.
export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);
  const deferredForOtp = useRef(false);
  const otpPhone = useLoginFlowStore(state => state.phone);
  const otpExpiresAt = useLoginFlowStore(state => state.expiresAt);
  const isOtpFlowActive = Boolean(otpPhone && otpExpiresAt && otpExpiresAt > Date.now());

  const requestReload = () => {
    if (reloadRequested) return;
    // Never cut off an in-progress OTP — the customer would lose the code they
    // are typing. Defer until the flow ends (see the effect below).
    if (useLoginFlowStore.getState().getActiveOtpFlow()) {
      deferredForOtp.current = true;
      return;
    }
    reloadRequested = true;
    window.location.reload();
  };

  // Stage an update: don't reload now, wait for a quiet moment. Interaction
  // keeps the idle timer reset so browsing/checkout is never interrupted.
  const stageUpdate = () => {
    if (reloadRequested || updatePending) return;
    updatePending = true;

    let idle: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => requestReload(), QUIET_MS);
    };
    armIdle();
    const onActivity = () => { if (!reloadRequested) armIdle(); };
    const onHidden = () => { if (document.visibilityState === 'hidden') requestReload(); };
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onHidden);
  };

  const check = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (currentVersion.current === null) {
        currentVersion.current = v;
      } else if (currentVersion.current !== v) {
        stageUpdate();
      }
    } catch {}
    // Browsers only re-check sw.js on their own roughly once a day. Ask now so
    // the freshly deployed worker installs and precaches the new chunks while
    // the app is open — that is what makes the eventual swap instant.
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
    // take control of an already-open app. Stage the swap the same quiet way.
    // Skip the very first load, where the app starts uncontrolled and there is
    // nothing to refresh.
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const onControllerChange = () => stageUpdate();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    if (!isOtpFlowActive && deferredForOtp.current) requestReload();
  }, [isOtpFlowActive]);
}