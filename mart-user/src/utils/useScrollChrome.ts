import { useEffect, useState, type RefObject } from 'react';

// Chrome geometry the thresholds depend on. Keep in sync with the header band
// (Navbar row 1 min-h-[44px]) and the bottom nav overlay.
const REST_BAND_PX = 96;   // near the top: chrome always shown, accumulator zeroed
const HIDE_AFTER_PX = 96;  // decisive downward travel before hiding
const SHOW_AFTER_PX = 64;  // MUST exceed the header band's height (44px row)
const BOTTOM_SLACK_PX = 2; // sub-pixel slack for the end-of-page test

/**
 * ONE scroll controller for the app chrome: the Navbar delivery row and the
 * bottom nav (both consume the returned boolean: deliveryHidden /
 * bottomNavHidden). They therefore always flip in the SAME React commit — two
 * listeners with their own accumulators (the old Navbar + AppShell pair)
 * drifted apart on enable-flag changes and re-ran their thresholds at
 * different scroll points, which read as a shake.
 *
 * Thresholds are tuned for resting stability and for zero scrollTop clamping:
 *  - y <= 96 (the header + carousel band on Home): the chrome is ALWAYS
 *    shown and the accumulator is zeroed, so small finger movements while
 *    resting there can never flip it.
 *  - near the END of the page the BOTTOM NAV comes back even while the header
 *    stays hidden: once the last row is on screen there is nothing left to
 *    uncover, and the nav is the control the customer is about to use. The nav
 *    is an overlay (transform), so revealing it cannot move the page. The
 *    delivery row is NOT forced back — it is in-flow, so returning it would
 *    shrink the scrollport by 44px and clamp the scroll. It comes back the
 *    normal way the moment the customer scrolls up.
 *  - hide needs ~96px of downward travel (direction-reset accumulator). Hiding
 *    only ever GROWS the scrollport (delivery row collapses, nav is a
 *    transform overlay), so max scrollTop grows too — it can never clamp.
 *  - show needs 64px of upward travel. Revealing the delivery row SHRINKS the
 *    scrollport by the band's 44px, i.e. max scrollTop drops by 44. Requiring
 *    more than 44px of continuous upward travel guarantees the current
 *    scrollTop already sits that far below the old maximum, so the browser
 *    never has to clamp — no jump near the bottom of a page. 64 > 44 with a
 *    margin, and still feels instant.
 *
 * The accumulator is per-direction: `acc` keeps adding while the scroll
 * direction holds and resets to the current delta when it reverses.
 *
 * `extraScrollEl` covers pages whose scroll owner is NOT `.app-scroll` — today
 * the Categories split pane, which fills the scroller exactly and scrolls its
 * product list internally. Both elements feed this ONE state, so the chrome
 * behaves identically on every page. The effect resets to "shown" whenever the
 * set of owners changes (page switch, pane mount/unmount), so a page never
 * inherits a hidden chrome from the previous page's scroll position.
 */
export interface ScrollChromeState {
  /** Travel-driven: hides the delivery row (in-flow) on downward scrolling. */
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
    if (!enabled) {
      setHidden(false);
      setAtEnd(false);
      return;
    }
    const elements = [scrollRef.current, extraScrollEl].filter(
      (el): el is HTMLDivElement => el !== null,
    );
    if (elements.length === 0) return;

    // Fresh page / fresh scroller set: always start visible.
    setHidden(false);
    setAtEnd(false);

    const state = new Map<
      HTMLElement,
      { last: number; acc: number; atEnd: boolean }
    >();
    const detach: Array<() => void> = [];

    for (const el of elements) {
      state.set(el, { last: el.scrollTop, acc: 0, atEnd: false });
      const onScroll = () => {
        const s = state.get(el);
        if (!s) return;
        const y = el.scrollTop;
        const delta = y - s.last;
        s.acc = Math.sign(delta) === Math.sign(s.acc) ? s.acc + delta : delta;
        const atBottom =
          y + el.clientHeight >= el.scrollHeight - BOTTOM_SLACK_PX;
        const leftTheEnd = s.atEnd && !atBottom && delta < 0;
        s.atEnd = atBottom;
        setAtEnd(atBottom);
        if (atBottom) {
          // End of the page: the nav shows through navHidden. Keep the header
          // hidden and zero the accumulator so resting here cannot flip it.
          s.acc = 0;
        } else if (y <= REST_BAND_PX) {
          // Near the top: always shown, accumulator zeroed.
          setHidden(false);
          s.acc = 0;
        } else if (leftTheEnd) {
          // Scrolling up out of the end is an unambiguous reveal: return both
          // immediately instead of making the nav blink off for 64px first.
          setHidden(false);
          s.acc = 0;
        } else if (s.acc > HIDE_AFTER_PX) {
          setHidden(true);
        } else if (s.acc < -SHOW_AFTER_PX) {
          setHidden(false);
        }
        s.last = y;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      detach.push(() => el.removeEventListener('scroll', onScroll));
    }

    return () => {
      for (const fn of detach) fn();
    };
  }, [enabled, scrollRef, extraScrollEl]);

  return { hidden, navHidden: hidden && !atEnd };
}
