/**
 * The launch splash (the static overlay in index.html).
 *
 * The overlay is part of the document, not React, so it can be on screen
 * before the app bundle is even parsed. This module is the single place that
 * takes it down again, so the fade-out cannot drift between the normal path
 * (the app finished loading) and the failure path (the network check failed
 * and the offline overlay needs the screen).
 *
 * The splash is always removed by an explicit call, never by a timer that
 * decides for itself. The app waits for this minimum window AND for the first
 * screen to be ready, so the catalog/images can load behind the animation and
 * the overlay still never outlives the load.
 */

/** No fade: once the hold and the load are done, the overlay goes straight away. */
const FADE_MS = 0;

/** Remove on the next tick so .is-leaving can release pointer events first. */
const REMOVE_DELAY_MS = FADE_MS;

/**
 * Short brand moment while the first screen loads. Data fetching runs behind
 * the splash; a slower load keeps it up longer, but a fast one is not held for
 * the full 6s GIF.
 */
export const MIN_SPLASH_MS = 3000;

/**
 * Drop the launch-only canvas flag.
 *
 * The theme colour is owned by App.tsx now: it knows the active route and sets
 * the login page's light green. Touching the meta tag here would overwrite that
 * when the splash comes down three seconds into an open on the login screen.
 */
function releaseCanvas(): void {
  document.documentElement.classList.remove('splash-active');
}

/**
 * Hold the splash while a build swap is in flight.
 *
 * The launch splash is the one thing on screen that does not belong to the
 * build being swapped out, so it is the natural cover for the swap: the
 * customer sees the splash, the new worker activates underneath it, and the
 * reload lands on the new build with the splash still up. Without the hold
 * the customer would see the stale app, then the splash again, then the new
 * app -- two launches for one open.
 *
 * The hold is bounded (see SWAP_HOLD_MS in useAppUpdate): a swap that cannot
 * happen, because the device is offline, must not leave the customer looking
 * at a splash forever.
 */
export function markSplashSwapPending(): void {
  document.getElementById('app-splash')?.setAttribute('data-swapping', '1');
}

/** Release the hold. The splash comes down on the next dismissal attempt. */
export function clearSplashSwapPending(): void {
  document.getElementById('app-splash')?.removeAttribute('data-swapping');
}

/**
 * Dissolve the splash and remove it from the DOM.
 *
 * Safe to call when the splash is already gone, and safe to call twice: the
 * second call finds the element mid-fade and just removes it.
 *
 * While a swap is pending the splash is left alone: it is the cover for the
 * swap, and taking it away would expose the stale app for a moment.
 */
export function hideSplash(): void {
  const splash = document.getElementById('app-splash');
  if (!splash) { releaseCanvas(); return; }
  if (splash.getAttribute('data-swapping') === '1') return;
  if (splash.dataset.hiding === '1') {
    window.setTimeout(() => { splash.remove(); releaseCanvas(); }, REMOVE_DELAY_MS);
    return;
  }
  splash.dataset.hiding = '1';
  splash.classList.add('is-leaving');
  window.setTimeout(() => { splash.remove(); releaseCanvas(); }, REMOVE_DELAY_MS);
}
