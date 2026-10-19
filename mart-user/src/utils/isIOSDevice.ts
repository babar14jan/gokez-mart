/**
 * True on iPhones, iPods, and iPads — including iPadOS 13+, which disguises
 * itself as a Mac ("MacIntel") in the user agent to request desktop sites;
 * a real Mac has no multi-touch screen, so maxTouchPoints disambiguates.
 *
 * Used to hide UI whose behaviour iOS Safari gets wrong and that would
 * otherwise show customers incorrect information (e.g. the checkout
 * suggestions rail, where iOS fails to repaint the sticky "To pay" bar after
 * a card's ADD tap — the cart updates but the painted total goes stale until
 * the next touch).
 */
let cached: boolean | null = null;

export function isIOSDevice(): boolean {
  if (cached !== null) return cached;
  if (typeof navigator === 'undefined') { cached = false; return cached; }
  const ua = navigator.userAgent || '';
  cached = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  return cached;
}
