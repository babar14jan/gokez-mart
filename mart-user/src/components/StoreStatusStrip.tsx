import type { StoreOpenState } from '../services/api';

/**
 * Slim closed-store notice, rendered directly below the header on every page.
 *
 * Deliberately not a banner that pushes content around or a modal that blocks
 * browsing. A customer outside opening hours is still a customer: they can look
 * at the catalogue, plan a basket and check out, so the notice only has to
 * explain the delay before promising a time. Overstating it -- blocking pages or
 * implying the store is gone -- would cost sales for no operational gain.
 */
export default function StoreStatusStrip({ openState }: { openState?: StoreOpenState }) {
  // Absent state means the request has not landed yet. Showing "closed" during
  // that gap would flash an alarming strip on every page load.
  if (!openState || openState.isOpen) return null;

  // A manual closure has no reopening time to quote, so it must not claim one.
  const when = openState.closedReason === 'manual'
    ? 'Orders placed now will be prepared when we reopen.'
    : openState.nextOpenLabel
      ? `Orders placed now will be ready from ${openState.nextOpenLabel}.`
      : 'Orders placed now will be prepared when we reopen.';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="store-status-strip"
      className="w-full bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-center">
        <span aria-hidden="true" className="text-sm leading-none">🕘</span>
        <p className="text-[11px] sm:text-xs font-medium text-amber-900 dark:text-amber-200 leading-snug">
          <span className="font-bold">We&apos;re closed right now.</span>{' '}
          <span className="font-normal">{when}</span>
        </p>
      </div>
    </div>
  );
}
