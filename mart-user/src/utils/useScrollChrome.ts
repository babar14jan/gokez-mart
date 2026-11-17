import { useEffect, useState, type RefObject } from 'react';

// Chrome geometry. Keep in sync with the header band (Navbar row 1
// min-h-[44px]) and the bottom nav overlay.
const BAND_PX = 44;         // the delivery row's height, in px
const REST_BAND_PX = 96;    // no collapse at all until the header band + hero
                            // have scrolled past (band collapses from there)
const EXPAND_DAMPING = 3;   // px of upward travel needed per px of re-expansion
const BOTTOM_SLACK_PX = 2;  // sub-pixel slack for the end-of-page test
// The end-of-page flag drives the nav on its own, so it gets an anti-flutter
// guard: bobbing on the last pixel must not blink the bar.
const FLIP_COOLDOWN_MS = 250;

/**
 * ONE scroll controller for the app chrome: the Navbar delivery row and the
 * bottom nav (both consume the returned flags: deliveryHidden /
 * bottomNavHidden).
 *
 * The delivery row is IN FLOW above the scroller, so collapsing it moves every
 * pixel of page content up by the same amount. Animating that over time read as
 * a bump: a product card in the middle of the screen slid 44px on its own,
 * decoupled from the finger. So the collapse is no longer time-driven — the
 * header's height is written per scroll event as `--band-collapse` (0..44px),
 * which means it leaves and returns EXACTLY in step with the scroll:
 *
 *  - the first 96px of scroll (header band + the Home hero) never collapse it;
 *    past that, scrolling down adds 1px of collapse per px of travel, so the
 *    band leaves as fast as the finger moves;
 *  - scrolling up re-expands at 1/3 speed (EXPAND_DAMPING), i.e. a softer,
 *    damped return — it cannot feel like a snap, and the damped ratio also
 *    keeps the scrollTop clamp near the bottom of a page down to a fraction of
 *    a pixel per event (re-expanding shrinks the scrollport). The collapse
 *    always finishes inside that travel, so the band is fully open at the top.
 *
 * The nav is an overlay (transform + opacity, no layout), so it is still driven
 * by a boolean: hidden once the band is fully collapsed, shown again once it is
 * fully expanded. That hysteresis (two opposite ends of a 44px range) is what
 * makes a repeated flip impossible, so no time cooldown is needed for it.
 * Near the END of a page the nav comes back even while the header stays hidden:
 * once the last row is on screen there is nothing left to uncover, and the nav
 * is the control the customer is about to use.
 *
 * `extraScrollEl` covers pages whose scroll owner is NOT `.app-scroll` — today
 * the Categories split pane, which fills the scroller exactly and scrolls its
 * product list internally. Both elements feed this ONE state, so the chrome
 * behaves identically on every page. The effect resets to "shown" whenever the
 * set of owners changes (page switch, pane mount/unmount), so a page never
 * inherits a hidden chrome from the previous page's scroll position.
 */
export interface ScrollChromeState {
  /** True once the delivery row is fully collapsed (Navbar collapse class). */
  hidden: boolean;
  /** Same, but forced OFF at the end of the page (the nav is an overlay). */
  navHidden: boolean;
}

export function useScrollChrome(
  scrollRef: RefObject<HTMLDivElement>,
  enabled: boolean,
  extraScrollEl: HTMLElement | null = null,
): ScrollChromeState {
  const [hidden, setHidden] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    // The band's height is published as a custom property on the frame, so the
    // header can read it without a React render on every scroll frame.
    const shell = scrollRef.current?.closest<HTMLElement>('.app-shell') ?? null;

    if (!enabled) {
      setHidden(false);
      setAtEnd(false);
      shell?.style.removeProperty('--band-collapse');
      return;
    }
    const elements = [scrollRef.current, extraScrollEl].filter(
      (el): el is HTMLDivElement => el !== null,
    );
    if (elements.length === 0) return;

    // Fresh page / fresh scroller set: always start visible.
    setHidden(false);
    setAtEnd(false);

    // Local shadows of the state, so the logic does not depend on a re-render
    // having landed yet.
    let shown = true;
    const flip = (next: boolean) => {
      if (next === shown) return;
      shown = next;
      setHidden(next);
    };
    let endState = false;
    let lastEndAt = 0;
    const setEnd = (next: boolean, force = false) => {
      if (next === endState) return;
      if (!force && performance.now() - lastEndAt < FLIP_COOLDOWN_MS) return;
      endState = next;
      lastEndAt = performance.now();
      setAtEnd(next);
    };
    // Shared across scroll owners: only one element scrolls at a time.
    let band = 0;
    let applied = -1;
    const commitBand = () => {
      const rounded = Math.round(band * 4) / 4;
      if (rounded === applied) return;
      applied = rounded;
      shell?.style.setProperty('--band-collapse', `${rounded}px`);
    };

    const state = new Map<
      HTMLElement,
      { last: number; atEnd: boolean }
    >();
    const detach: Array<() => void> = [];

    for (const el of elements) {
      state.set(el, { last: el.scrollTop, atEnd: false });
      const onScroll = () => {
        const s = state.get(el);
        if (!s) return;
        const y = el.scrollTop;
        const delta = y - s.last;
        const atBottom =
          y + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK_PX;
        const leftTheEnd = s.atEnd && !atBottom && delta < 0;
        s.atEnd = atBottom;

        if (atBottom) {
          setEnd(true);
        } else if (y <= 0) {
          // Top of the page: always fully open. (The damped expansion has
          // already brought it to 0 by here, so this is a safety net, not the
          // thing that closes the gap.)
          flip(false);
          setEnd(false, true);
          band = 0;
        } else if (leftTheEnd) {
          // Scrolling up out of the end is an unambiguous reveal: return both
          // immediately instead of making the nav blink off first.
          flip(false);
          setEnd(false, true);
          if (delta < 0) band = Math.max(0, band + delta / EXPAND_DAMPING);
        } else {
          setEnd(false);
          if (delta > 0) {
            // Collapsing starts only past the hero band, but re-expansion
            // (below) runs everywhere, so the two directions join up smoothly.
            if (y > REST_BAND_PX) band = Math.min(BAND_PX, band + delta);
          } else if (delta < 0) {
            band = Math.max(0, band + delta / EXPAND_DAMPING);
          }
          // Flips only at the two opposite ends of the range: stable.
          if (band >= BAND_PX) flip(true);
          else if (band <= 0) flip(false);
        }

        commitBand();
        s.last = y;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      detach.push(() => el.removeEventListener('scroll', onScroll));
    }

    return () => {
      for (const fn of detach) fn();
      shell?.style.removeProperty('--band-collapse');
    };
  }, [enabled, scrollRef, extraScrollEl]);

  return { hidden, navHidden: hidden && !atEnd };
}
