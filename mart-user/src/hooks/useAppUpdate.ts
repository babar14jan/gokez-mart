import { useEffect, useRef } from 'react';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { useUpdateStore } from '../store/updateStore';
import { markSplashSwapPending, clearSplashSwapPending, hideSplash } from '../utils/splash';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
// After an update is detected, apply it once the customer either goes to the
// background (dropdown to another app / lock / tab switch) or stays inactive
// on this screen for a full minute. An active customer is never interrupted.
const QUIET_MS = 60 * 1000;
// How long the launch splash may be held for a swap that is not going through.
// A swap that cannot happen (offline) must not leave the customer staring at
// a splash forever, so the hold is bounded and the app is shown regardless.
const SWAP_HOLD_MS = 10 * 1000;

// A deploy can be noticed twice at almost the same moment — once by the version
// poll and once by the new service worker taking control. Reload only once.
let reloadRequested = false;
let updatePending = false;

// Deploy mode, refreshed from /update-policy.json on every poll. This is the
// single runtime switch for how a new build reaches running clients:
//   silent (default) — apply on the next open / when the app goes to background.
//   force            — reload the running app immediately, even mid-session, so
//                      an open tab or installed PWA never has to be closed.
let updateMode: 'silent' | 'force' = 'silent';

// The build this bundle was produced from. Stamped in at build time (see the
// version plugin in vite.config.ts) and the same id the server writes to
// /version.json.
//
// This is what makes a cold launch work. Before, the app only compared two
// polls of the server's version, so the very first poll of a session could
// never be a change: an installed PWA opened after a deploy was shown the
// stale app until the second poll, minutes later. Comparing against the
// build the app is actually running detects that on the first check.
const MY_BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

/**
 * Guard against a reload loop.
 *
 * The stale check compares the build the app is running with the build the
 * server says it is serving. If those two can never agree — a half-finished
 * deploy where the new code is live but /version.json is not, a CDN serving a
 * stale version.json, a version endpoint that answers with something else
 * entirely — then every reload finds the app stale again and reloads again.
 * Left alone that is an infinite loop, which is far worse than running a
 * slightly old build.
 *
 * So a swap away from a given build is attempted at most once per session.
 * The marker is keyed by the build being left behind, so the build that
 * replaces it is free to swap again if it too turns out to be stale.
 */
const SWAP_GUARD_KEY = 'mart-build-swap';

/** True when this build has already been swapped away from in this session. */
function alreadySwapped(): boolean {
  try {
    return sessionStorage.getItem(SWAP_GUARD_KEY) === MY_BUILD;
  } catch {
    // No storage (private mode, blocked cookies): assume it is fine. A blocked
    // sessionStorage only means the guard does not apply.
    return false;
  }
}

/** Record that this build has been swapped away from. */
function markSwapped(): void {
  try {
    sessionStorage.setItem(SWAP_GUARD_KEY, MY_BUILD);
  } catch {
    /* noop */
  }
}

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
    // A reload while offline cannot be served by the network and, on iOS, can
    // land on a blank screen or the browser's own offline page. Wait for the
    // connection to return, then swap.
    if (!navigator.onLine) {
      window.addEventListener('online', () => requestReload(), { once: true });
      return;
    }
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

  // Force mode must land the *new* build, not just reload into the same cached
  // one. Ask the browser to install the new worker first, wait for it to
  // actually activate (it ships with skipWaiting, so it takes over as soon as
  // it is ready), and only then reload — the reload is then served from the
  // new worker's cache and lands on the new build.
  //
  // The timer is only a fallback for the case where the worker does not
  // change at all, or the activation event never arrives.
  const forceSwap = () => {
    if (reloadRequested) return;
    let swapped = false;
    // Hold the launch splash over the swap, so the customer never sees the
    // stale app between the old and the new build.
    markSplashSwapPending();
    useUpdateStore.getState().set({ swapPending: true });
    const swap = () => {
      if (swapped) return;
      swapped = true;
      requestReload();
    };
    // The hold is bounded: a swap that cannot happen (the device is offline)
    // must not leave the customer looking at a splash instead of the app.
    window.setTimeout(() => {
      clearSplashSwapPending();
      useUpdateStore.getState().set({ swapPending: false });
      // Nothing swapped, so let the splash come down and show what we have.
      if (!swapped) hideSplash();
    }, SWAP_HOLD_MS);
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(async (reg) => {
          if (!reg) { swap(); return; }
          try { await reg.update(); } catch { /* fall through to the fallback */ }
          const worker = reg.installing || reg.waiting;
          if (!worker) {
            // The worker did not change, so there is nothing to wait for.
            swap();
            return;
          }
          if (worker.state === 'activated') { swap(); return; }
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'redundant') swap();
          });
        }).catch(() => swap());
      } else {
        swap();
      }
    } catch {
      swap();
    }
    // Never leave the customer on a stale build: if the new worker does not
    // arrive, reload anyway.
    window.setTimeout(swap, 4000);
  };

  const check = async () => {
    // Read the deploy mode first, so the reload decision below uses the mode of
    // the build the edge is actually serving. Any failure keeps the last known
    // mode (default silent), so a missing policy can never force a reload.
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
      const seen = currentVersion.current;

      // Is the build this app is running the build the server is serving? This
      // is the check that matters on a cold launch: the very first poll of a
      // session can never be a *change* in the server's version, because there
      // is no previous value to compare against — but the running build can
      // still be older than what the server serves.
      const stale = Boolean(MY_BUILD) && Boolean(v) && v !== MY_BUILD;

      // Report the state so the launch splash knows whether it may come down.
      useUpdateStore.getState().set({ checked: true, stale, mode: updateMode });

      // A new deploy shows up two ways: the server's version changed since the
      // last poll, or this build is not the one being served.
      const changed = stale || (!first && seen !== v);
      if (!changed) return;

      // Never loop. If this build has already been swapped away from once, it
      // is left alone even though the server still reports something else --
      // a slightly old app is much better than an app that reloads forever.
      if (alreadySwapped()) {
        useUpdateStore.getState().set({ checked: true, stale: false, mode: updateMode, swapPending: false });
        return;
      }
      markSwapped();

      // Record the new id so a later poll cannot trigger the same swap twice.
      currentVersion.current = v;
      // force = land the new build now; silent = wait for a quiet moment.
      if (updateMode === 'force') forceSwap();
      else stageUpdate();
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
    const onControllerChange = () => {
      // A swap can be noticed here too; honor the same deploy mode.
      if (updateMode === 'force') requestReload();
      else stageUpdate();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    if (!isOtpFlowActive && deferredForOtp.current) requestReload();
  }, [isOtpFlowActive]);
}