import type { ReactNode, Ref, TouchEventHandler } from 'react';

interface AppShellProps {
  /** Extra classes for the frame — page background colour varies by view. */
  className?: string;
  scrollRef?: Ref<HTMLDivElement>;
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchMove?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
  onTouchCancel?: TouchEventHandler<HTMLDivElement>;
  /** Header chrome rendered at the top of the scroll area (e.g. Navbar). */
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
  /** In-flow bottom navigation, pinned as the last flex child of the frame. */
  bottomNav?: ReactNode;
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
 *  - the bottom nav is a normal flex sibling AFTER the scroller, so it is
 *    pinned by layout and cannot drift the way a `position: fixed` bar does on
 *    iOS Safari/standalone PWA (WebKit bug 297779). Because it sits outside the
 *    scroller it also reserves its own height for free;
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
  children,
}: AppShellProps) {
  return (
    <div className={`app-shell dark:bg-slate-900 font-sans ${className}`}>
      {overlay}

      <div
        className="app-scroll"
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {header}
        {children}
      </div>

      {floatingCart}
      {bottomNav}
    </div>
  );
}
