import { X, ShoppingBag, LogIn, PackageCheck } from 'lucide-react';

interface CheckoutGuestPromptProps {
  itemCount: number;
  onGuest: () => void;
  onLogin: () => void;
  onClose: () => void;
}

export default function CheckoutGuestPrompt({ itemCount, onGuest, onLogin, onClose }: CheckoutGuestPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-prompt-title"
        className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl dark:bg-slate-800 sm:rounded-3xl sm:pb-7">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 grid h-11 w-11 place-items-center rounded-2xl text-gray-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-slate-400 dark:hover:bg-slate-700">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40">
            <PackageCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <h2 id="guest-prompt-title" className="text-lg font-bold text-gray-900 dark:text-white">
            Order in seconds
          </h2>
          <p className="mx-auto mt-1 max-w-[19rem] text-[13px] leading-snug text-gray-600 dark:text-slate-300">
            {itemCount > 0
              ? `You have ${itemCount} item${itemCount === 1 ? '' : 's'} in your bag.`
              : ''}{' '}
            Checkout as a guest in one tap — no OTP needed.
          </p>
        </div>

        <div className="mt-5 space-y-2.5">
          <button type="button" onClick={onGuest}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800">
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            Continue as guest
          </button>
          <button type="button" onClick={onLogin}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3.5 text-[15px] font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 dark:focus-visible:ring-offset-slate-800">
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Log in
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
          Logging in unlocks offers, order history and saved addresses.
          <span className="mt-0.5 block">Your delivery details are always collected at checkout.</span>
        </p>
      </div>
    </div>
  );
}