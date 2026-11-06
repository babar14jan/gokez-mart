import { MapPin } from 'lucide-react';
import type { SavedAddress } from '../store/customerStore';

/**
 * The single, shared entry point into the address book.
 *
 * A compact row showing the delivery address currently in use — or a prompt to
 * add one — with an action pill on the right reading "Add" or "Update", so the
 * next tap is never a guess. Tapping anywhere opens AddressSheet, which owns the
 * whole flow from there: the list of saved addresses with "Add new address", or
 * the form directly when the book is empty.
 *
 * Deliberately low-profile. This sits in the checkout's sticky footer, where
 * every pixel it takes is a pixel the basket loses, so it is a slim row rather
 * than a tall card. The heading is a flat "Deliver to" and never
 * "Deliver to Home": no home/office label is ever collected from the customer.
 *
 * Kept presentational and dumb on purpose: it reports the tap and shows whatever
 * address it is handed. Each host decides which address is "current" and what to
 * do when the sheet closes, so the same control can be dropped anywhere.
 */
interface AddressButtonProps {
  /** The address currently in use; null/undefined shows the empty prompt. */
  address?: SavedAddress | null;
  onClick: () => void;
  /** Overrides the "Deliver to" heading, e.g. the account page's address book. */
  heading?: string;
  /** Empty-state line, e.g. a guest prompt. */
  emptyLabel?: string;
  /** Highlights the row when the address still needs the shopper's attention. */
  error?: boolean;
  /** Drops the card surface so the row sits directly on its host. */
  flat?: boolean;
  className?: string;
}

export default function AddressButton({ address, onClick, heading, emptyLabel = 'Add your delivery address', error = false, flat = false, className = '' }: AddressButtonProps) {
  const surface = flat
    ? (error ? 'ring-1 ring-red-300 dark:ring-red-900' : '')
    : error
      ? 'bg-red-50 ring-1 ring-red-300 dark:bg-red-950/20 dark:ring-red-900'
      : 'bg-white ring-1 ring-[#e9edf2] hover:bg-gray-50 active:bg-gray-100 dark:bg-slate-800 dark:ring-slate-700 dark:hover:bg-slate-700/60';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-invalid={error || undefined}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 ${flat ? 'min-h-11 py-0' : 'py-2'} text-left transition-colors ${surface} ${className}`}
    >
      <MapPin className="h-4 w-4 shrink-0 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.04em] text-[#687386] dark:text-slate-400">
          {heading || 'Deliver to'}
        </span>
        <span className={`mt-0.5 block truncate text-[13px] ${address ? 'font-semibold text-[#172033] dark:text-white' : 'font-medium text-[#687386] dark:text-slate-400'}`}>
          {address ? address.address : emptyLabel}
        </span>
      </span>
      {/* A span, not a button: the whole row is already the control, so a nested
          button would be invalid markup and a second, confusing tab stop. */}
      <span className="shrink-0 rounded-lg bg-gokez-50 px-2.5 py-1 text-xs font-bold text-gokez-800 dark:bg-gokez-900/25 dark:text-gokez-300">
        {address ? 'Update' : 'Add'}
      </span>
    </button>
  );
}
