import { Clock } from 'lucide-react';
import type { StoreOpenState } from '../services/api';

interface StoreStatusStripProps {
  openState?: StoreOpenState;
  zoneName?: string;
}

export default function StoreStatusStrip({ openState, zoneName }: StoreStatusStripProps) {
  if (!openState || openState.isOpen) return null;

  const when = openState.closedReason === 'manual'
    ? 'You can order now — we will start delivering from next opening hours.'
    : openState.nextOpenLabel
      ? `You can order now — we will start delivering from ${openState.nextOpenLabel}.`
      : 'You can order now — we will start delivering from next opening hours.';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="store-status-strip"
      className="w-full bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60"
    >
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-center gap-2.5 text-center">
        <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <div className="text-left">
          <p className="text-[11px] sm:text-xs font-bold text-amber-900 dark:text-amber-200 leading-snug">
            {zoneName ? `${zoneName} store is closed now.` : "We're closed right now."}
          </p>
          <p className="text-[11px] sm:text-xs font-medium text-amber-800/80 dark:text-amber-300/80 leading-snug">
            {when}
          </p>
        </div>
      </div>
    </div>
  );
}
