import type { ReactNode, RefObject, TouchEventHandler } from 'react';

interface AppShellProps {
  /** Extra classes for the frame — page background colour varies by view. */
  className?: string;
  scrollRef?: RefObject<HTMLDivElement>;
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchMove?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
  onTouchCancel?: TouchEventHandler<HTMLDivElement>;
  /**
   * Header band rendered ABOVE the scroll area, as a fixed flex child of the
   * frame (e.g. Navbar + StoreStatusStrip). It never scrolls with the page.
   * Collapsing it only grows the scrollport (never clamps scrollTop); the
   * reverse is handled in useScrollChrome, which requires more upward travel
   * than the band's height before revealing. Because the band owns the top of
   * the frame, any in-page element that must "stay under the header" simply
   * uses `sticky top-0` inside `.app-scroll` — no magic offsets.
   */
  header?: ReactNode;
  /**
   * Frame-level overlays that must sit above the scroll area regardless of
   * route (login modal, toasts, refresh spinner). Fixed modals/sheets opened
   * from a page can also be passed as children — `.app-scroll` has no
   * transform, so `position: fixed` descendants escape it and anchor to the
   * viewport either way.
   */
  overlay?: ReactNode;
  /** Floating cart — a fixed bar; keep it out of the scroll flow. */
  floatingCart?: ReactNode;
  /** Overlay bottom navigation, pinned to the bottom edge of the frame. */
  bottomNav?: ReactNode;
  /**
   * Hides the bottom nav with a transform (useScrollChrome's navHidden: the
   * header's travel state, except it returns at the end of a page). The nav is
   * an overlay and the scroller reserves its height with constant padding, so
   * toggling this never changes layout, content height, or scrollTop — no
   * clamp, no shake.
   */
  bottomNavHidden?: boolean;
  /** Page content, rendered inside the single scroll area. */
  children: ReactNode;
}

/**
 * Single frame shared by every customer-facing page.
 *
 * Layout contract (see `.app-shell` / `.app-scroll` in index.css):
 *  - the frame is `position: fixed; inset: 0`, i.e. exactly the visible
 *    viewport and out of document flow, so the document can never scroll and
 *    carry the shell (or the nav) up with it;
 *  - `.app-scroll` is the ONLY scroll container;
 *  - the header band sits ABOVE the scroller as a fixed flex child, so it
 *    never scrolls away and in-page sticky elements pin at `top-0` directly
 *    beneath it;
 *  - the bottom nav is an absolutely positioned overlay pinned to the bottom of
 *    the frame: layout-pinned (cannot drift like position:fixed on iOS,
 *    WebKit bug 297779) but hidden with a transform, so hiding it never
 *    resizes the scroller or clamps scrollTop;
 *  - the floating cart is `position: fixed` and lives outside the scroller.
 *
 * Because the frame and the header/overlay slots are shared, which page is
 * mounted never changes how the nav, cart, or viewport-level chrome is placed.
 */
export default function AppShell({
  className = '',
  scrollRef,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  header,
  overlay,
  floatingCart,
  bottomNav,
  bottomNavHidden = false,
  children,
}: AppShellProps) {
  return (
    <div className={`app-shell dark:bg-slate-900 font-sans ${className}`}>
      {overlay}

      {/* Fixed header band — OUTSIDE the scroller (see header prop doc). */}
      {header}

      <div
        className="app-scroll"
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {children}
      </div>

      {floatingCart}

      {bottomNav && (
        <div
          className={`app-bottom-nav${bottomNavHidden ? ' nav-hidden' : ''}`}
          aria-hidden={bottomNavHidden || undefined}
        >
          {bottomNav}
        </div>
      )}

      {/* iOS 26 Safari derives the bottom browser-bar tint from the
          background-color of a fixed element that touches that edge — the
          theme-color meta is ignored. The bottom strip pins that edge to the
          shared nav colour (brand green / dark), matching the top bar. The
          TOP edge needs no strip: the header band (Navbar) already sits at the
          top of the frame with a green background that covers the safe-area
          inset, so Safari samples the header itself and the status bar matches
          exactly — no seam, and nothing overlays the header content. index.css
          shows the remaining strip only on iOS (display:none elsewhere), so
          Android and desktop are untouched. aria-hidden + pointer-events:none:
          pure paint. */}
      <div className="app-tint-bottom" aria-hidden="true" />
    </div>
  );
}
