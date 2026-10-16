import { MapPin, ChevronRight } from 'lucide-react';
import type { SavedAddress } from '../store/customerStore';

/**
 * The single, shared entry point into the address book.
 *
 * A pure-white pill showing the delivery address currently in use (label plus
 * line) or a prompt to add one. Tapping it opens AddressSheet, which owns the
 * whole flow from there — the list of saved addresses with "Add new address",
 * or the form directly when the book is empty.
 *
 * Kept presentational and dumb on purpose: it reports the tap and shows whatever
 * address it is handed. Each host decides which address is "current" and what to
 * do when the sheet closes, so the same control can be dropped anywhere.
 */
interface AddressButtonProps {
  /** The address currently in use; null/undefined shows the empty prompt. */
  address?: SavedAddress | null;
  onClick: () => void;
  /** Context-specific heading above the address line. */
  heading?: string;
  /** Empty-state label, e.g. a guest prompt. */
  emptyLabel?: string;
  /** Highlights the button when the address still needs the shopper's attention. */
  error?: boolean;
  className?: string;
}

export default function AddressButton({ address, onClick, heading, emptyLabel = 'Add your delivery address', error = false, className = '' }: AddressButtonProps) {
  const surface = error
    ? 'bg-red-50 ring-2 ring-red-300 dark:bg-red-950/20 dark:ring-red-900'
    : 'bg-white ring-1 ring-[#e9edf2] hover:bg-gray-50 active:bg-gray-100 dark:bg-slate-800 dark:ring-slate-700 dark:hover:bg-slate-700/60';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-invalid={error || undefined}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left shadow-[0_2px_10px_rgba(23,32,51,0.05)] transition-colors ${surface} ${className}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
        <MapPin className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-[0.04em] text-[#687386] dark:text-slate-400">
          {heading || (address ? `Deliver to ${address.label}` : 'Delivery address')}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-[#172033] dark:text-white">
          {address ? address.address : emptyLabel}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
    </button>
  );
}
