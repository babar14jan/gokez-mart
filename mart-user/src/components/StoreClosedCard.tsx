import { useEffect, useRef } from 'react';
import { Clock, X } from 'lucide-react';
import { reopenBlockLine, defaultClosedHeading } from '../utils/storeClosed';

interface StoreClosedCardProps {
  open: boolean;
  /** The cross, and the primary button when there is nothing else to do. */
  onClose: () => void;
  /** The primary button, when it does something different from dismissing. */
  onConfirm?: () => void;
  /** The store's greeting, shown as the card's heading. */
  greeting?: string;
  /** The store's message. May contain "{until}", which is filled with the
   *  reopening time. */
  message?: string;
  /**
   * When the store reopens, as a label the customer can read
   * ("tomorrow at 9:00 AM", "9:00 AM tomorrow", "on 22 Oct at 6:00 PM").
   * Null when the store has not said, and its hours do not say either.
   */
  resumeLabel?: string | null;
  /** The closing button's label. */
  primaryLabel?: string;
}

/**
 * The closed-store card.
 *
 * The banner along the top of the app says the store is shut, but it is a
 * thin strip and it is easy to read past. This card is the version a
 * customer meets the first time they arrive, and the version they meet again
 * if they try to order while the store is shut — the two moments when "the
 * store is closed" actually changes what they should do.
 *
 * The reopening time sits in a solid block rather than in the sentence,
 * because it is the one fact the customer acts on, and it should survive
 * being skimmed.
 */
export default function StoreClosedCard({
  open,
  onClose,
  onConfirm,
  greeting,
  message,
  resumeLabel,
  primaryLabel = 'Got it',
}: StoreClosedCardProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and the button takes focus so the card is usable from the
  // keyboard straight away.
  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const heading = (greeting ?? '').trim() || defaultClosedHeading();
  const text = (message ?? '').trim()
    .replace(/\{until\}/g, resumeLabel || 'later');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Store closed"
      data-testid="store-closed-card"
    >
      <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-slate-800 shadow-2xl overflow-hidden">
        {/* Cross, top right. Dismisses the card exactly like the button does. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 active:scale-95 transition dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-12 pb-6 text-center">
          <p className="text-base font-bold text-gray-900 dark:text-white leading-snug break-words">
            {heading}
          </p>
          {text && (
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300 leading-relaxed break-words">
              {text}
            </p>
          )}

          {/* The reopening time, in a solid block so it is the thing the eye
              lands on, with the reassurance the customer needs to know they
              can still order. Yellow, and deliberately not the same green as
              the button below it: one is information and the other is an
              action, and they should not look like the same thing. */}
          {resumeLabel && (
            <div className="mt-5 rounded-2xl bg-amber-400 px-4 py-3 text-amber-950">
              <div className="flex items-center justify-center gap-2.5">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-extrabold">Reopens {resumeLabel}</span>
              </div>
              <p className="mt-1.5 text-xs font-semibold text-white leading-snug">
                {reopenBlockLine(resumeLabel)}
              </p>
            </div>
          )}

          <button
            ref={buttonRef}
            type="button"
            onClick={() => (onConfirm ?? onClose)()}
            className="mx-auto mt-5 rounded-2xl border-2 border-emerald-800 bg-emerald-600 px-7 py-3 text-sm font-bold text-white hover:bg-emerald-500 active:scale-[0.98] transition"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
