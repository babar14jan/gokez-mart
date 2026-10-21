import { Clock } from 'lucide-react';
import type { StoreOpenState } from '../services/api';
import { reopenLine, defaultClosedHeading } from '../utils/storeClosed';

interface StoreStatusStripProps {
  openState?: StoreOpenState;
  /**
   * The store's own wording for the closure, written in the hub.
   *
   * The greeting replaces the heading and the message replaces the default
   * explanation, so the customer reads what the owner actually wants to say
   * rather than a generic line. Either may be left empty, in which case the
   * default is used for that line only.
   */
  closedGreeting?: string;
  closedMessage?: string;
}

/**
 * Fills "{until}" with the time the store is back.
 *
 * The owner writes the sentence, and the one part that has to be exact — when
 * the store reopens — is filled from the server's own schedule, so the banner
 * cannot promise a time the backend does not agree with.
 */
function withResumeTime(message: string, resumeLabel: string | null | undefined): string {
  if (!message.includes('{until}')) return message;
  return message.replace(/\{until\}/g, resumeLabel || 'later');
}

export default function StoreStatusStrip({
  openState,
  closedGreeting,
  closedMessage,
}: StoreStatusStripProps) {
  if (!openState || openState.isOpen) return null;

  const greeting = (closedGreeting ?? '').trim();
  const message = (closedMessage ?? '').trim();

  // No heading by default. The zone name is already in the navbar directly
  // above this strip, so naming it again was noise, and the message the
  // store wrote carries the meaning on its own. The one case that still needs
  // a heading is a store that wrote no message either, where the strip would
  // otherwise say nothing about the closure at all.
  const heading = greeting || defaultClosedHeading();

  // The default explanation tells the customer what happens to an order they
  // place while the store is closed. A store's own message replaces it.
  const explanation = message
    ? withResumeTime(message, openState.closedUntilLabel)
    : reopenLine(openState.closedUntilLabel);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="store-status-strip"
      className="w-full bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60"
    >
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-center gap-2.5 text-center">
        <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        {/* min-w-0 so the text is allowed to shrink below its content width
            and wrap. Without it a flex item keeps its automatic minimum size
            and a long message runs off the side of the phone. */}
        <div className="text-left min-w-0">
          {heading && (
            <p className="text-[11px] sm:text-xs font-bold text-amber-900 dark:text-amber-200 leading-snug break-words">
              {heading}
            </p>
          )}
          {message && (
            <p className="text-[11px] sm:text-xs font-medium text-amber-800/80 dark:text-amber-300/80 leading-snug break-words">
              {explanation}
            </p>
          )}
          {/* The reopening line, always. It is the answer to the two questions
              the customer has: can I still order, and when will it arrive. */}
          <p className="text-[11px] sm:text-xs font-medium text-amber-800/80 dark:text-amber-300/80 leading-snug break-words">
            {reopenLine(openState.closedUntilLabel)}
          </p>
        </div>
      </div>
    </div>
  );
}
