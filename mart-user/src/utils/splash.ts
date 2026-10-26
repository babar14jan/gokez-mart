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
 * decides for itself. The only waits involved are the hand-off animation
 * (FADE_MS) and, on the normal path, the splash's own entrance animation.
 */

/** Matches the .is-leaving opacity transition in index.html. */
const FADE_MS = 220;

/** A little slack on top of the fade so the transition always completes. */
const REMOVE_DELAY_MS = FADE_MS + 40;

/**
 * Put the page canvas back to the app's own colours.
 *
 * While the splash is up the canvas is the brand green, so the strip below
 * the iOS home indicator is green rather than white. The splash overlay does
 * not reach that strip, so the canvas is what shows there. It has to go back
 * to the app's own background the moment the splash does, or the loaded page
 * would sit on a green canvas.
 */
function releaseCanvas(): void {
  document.documentElement.classList.remove('splash-active');
  const isDark = document.documentElement.classList.contains('dark');
  const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent)
    || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    isDark ? '#18191a' : mobile ? '#087a43' : '#ffffff',
  );
}

/**
 * How long the splash is guaranteed to stay up.
 *
 * This is a deliberate brand moment, not a loading hack: the app is already
 * live and interactive behind the overlay while it is up. Its job is to give
 * the launch a finished, deliberate feel and to cover the boot-time work —
 * the catalogue, settings and home sections are fetched as the app mounts, and
 * the stamp-based poll then keeps them warm without re-downloading everything
 * on every visit. A cold start on a slow connection is slower than this, and
 * then the splash simply stays up until the data is really there, so the
 * customer never sees a half-built screen.
 *
 * It is a floor, not a fixed delay: the splash comes down the moment the app
 * is ready AND this window has passed, so a fast start is never held longer
 * than it has to be.
 */
export const MIN_SPLASH_MS = 2000;

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

/**
 * The splash's entrance animation length, in milliseconds.
 *
 * Read from the `--app-splash-reveal` custom property so the CSS and this
 * module cannot disagree. The splash must stay up for at least this long, or
 * the removal would cut the logo's fade-in short and freeze it mid-animation.
 */
export function splashRevealMs(): number {
  if (typeof window === 'undefined') return 800;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--app-splash-reveal')
    .trim()
    .replace(/ms$/, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 800;
}
