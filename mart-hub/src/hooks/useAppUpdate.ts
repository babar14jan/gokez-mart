import { useEffect, useRef } from 'react';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

// A deploy can be noticed twice at almost the same moment — once by the version
// poll and once by the new service worker taking control. Reload only once.
let reloadRequested = false;
let updatePending = false;

let updateMode: 'silent' | 'force' = 'silent';

// Defined by the Vite version plugin. Comparing it with /version.json catches
// an old PWA on its very first poll after a deployment.
const MY_BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
const SWAP_GUARD_KEY = 'gokez-hub-build-swap';

function alreadySwapped(): boolean {
  try {
    return sessionStorage.getItem(SWAP_GUARD_KEY) === MY_BUILD;
  } catch {
    return false;
  }
}

function markSwapped(): void {
  try {
    sessionStorage.setItem(SWAP_GUARD_KEY, MY_BUILD);
  } catch {
    /* noop */
  }
}

export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);

  const requestReload = () => {
    if (reloadRequested) return;
    // A reload while offline cannot be served by the network and, on iOS, can
    // land on a blank screen or the browser's own offline page. Wait for the
    // connection to return, then swap.
    if (!navigator.onLine) {
      window.addEventListener('online', () => requestReload(), { once: true });
      return;
    }
    reloadRequested = true;
    // Deliberately retain local/session storage, cookies, and IndexedDB so the
    // authenticated Hub session survives the forced navigation.
    window.location.reload();
  };

  // Stage a silent update until the app goes to the background.
  // The new deployment's chunks are already flooded into the service-worker
  // cache during `registration.update()` below, so the swap is served locally
  // and reads as a smooth transition instead of a white reload shutter.
  const stageUpdate = () => {
    if (reloadRequested || updatePending) return;
    updatePending = true;

    const onHidden = () => { if (document.visibilityState === 'hidden') requestReload(); };
    document.addEventListener('visibilitychange', onHidden);
  };

  // Let the new worker precache and activate before navigating. The fallback
  // still reloads when no worker change is observable, while the per-build
  // session marker above prevents a bad edge deploy from creating a loop.
  const forceSwap = () => {
    if (reloadRequested) return;
    let swapped = false;
    const swap = () => {
      if (swapped) return;
      swapped = true;
      requestReload();
    };
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(async registration => {
          if (!registration) { swap(); return; }
          try { await registration.update(); } catch { /* use fallback */ }
          const worker = registration.installing || registration.waiting;
          if (!worker || worker.state === 'activated') { swap(); return; }
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'redundant') swap();
          });
        }).catch(swap);
      } else {
        swap();
      }
    } catch {
      swap();
    }
    window.setTimeout(swap, 4000);
  };

  const check = async () => {
    try {
      const policyRes = await fetch(`/update-policy.json?t=${Date.now()}`, { cache: 'no-store' });
      if (policyRes.ok) {
        const policy = await policyRes.json();
        updateMode = policy?.mode === 'force' ? 'force' : 'silent';
      }
    } catch {}
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      const first = currentVersion.current === null;
      const stale = Boolean(MY_BUILD) && Boolean(v) && v !== MY_BUILD;
      const changed = stale || (!first && currentVersion.current !== v);
      if (!changed) {
        currentVersion.current = v;
        return;
      }
      if (alreadySwapped()) return;
      markSwapped();
      currentVersion.current = v;
      if (updateMode === 'force') forceSwap();
      else stageUpdate();
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
  // take control of an already-open app. Stage the swap until it is hidden.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    const onControllerChange = () => {
      if (updateMode === 'force') forceSwap();
      else stageUpdate();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);
}