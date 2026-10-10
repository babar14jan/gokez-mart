import { useEffect, useRef } from 'react';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
// After an update is detected, apply it once the admin either goes to the
// background or stays inactive on this screen for a full minute — an actively
// used hub is never yanked out from under the user.
const QUIET_MS = 60 * 1000;

// A deploy can be noticed twice at almost the same moment — once by the version
// poll and once by the new service worker taking control. Reload only once.
let reloadRequested = false;
let updatePending = false;

export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);

  const requestReload = () => {
    if (reloadRequested) return;
    reloadRequested = true;
    window.location.reload();
  };

  // Stage an update and wait for a quiet moment (background or ~1 min idle).
  // The new deployment's chunks are already flooded into the service-worker
  // cache during `registration.update()` below, so the swap is served locally
  // and reads as a smooth transition instead of a white reload shutter.
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
    // Ask the browser to re-fetch sw.js now instead of waiting for its ~24h
    // interval, so the freshly deployed worker installs and precaches the new
    // chunks while the app is open — that makes the eventual swap instant.
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
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The worker ships with skipWaiting()/clients.claim(), so a new deploy can
  // take control of an already-open app. Stage the swap the same quiet way.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const onControllerChange = () => stageUpdate();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);
}