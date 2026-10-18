import type { ReactNode } from 'react';

const BAR = 'rounded bg-gray-200 dark:bg-slate-700';
const CARD = 'rounded-xl bg-gray-100 dark:bg-slate-800';

function Row() {
  return (
    <div className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0 dark:border-slate-700">
      <div className={`h-9 w-9 flex-shrink-0 rounded-full ${BAR}`} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`h-3.5 w-1/3 ${BAR}`} />
        <div className={`h-3 w-1/2 ${CARD}`} />
      </div>
      <div className={`h-5 w-14 flex-shrink-0 ${BAR}`} />
    </div>
  );
}

/**
 * Route/data placeholder shown while a page (or its data) loads. It keeps the
 * screen on the app's own background with the page's shape already in place —
 * no full-page dark flash and no rotating spinner before the content lands.
 */
export default function PageSkeleton({ rows = 6, children }: { rows?: number; children?: ReactNode }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse space-y-3">
        <div className={`h-6 w-40 ${BAR}`} />
        <div className={`h-4 w-56 ${CARD}`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className={`h-20 ${CARD}`} />)}
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-slate-700 dark:bg-slate-800">
          {Array.from({ length: rows }, (_, i) => <Row key={i} />)}
        </div>
        {children}
      </div>
    </div>
  );
}
