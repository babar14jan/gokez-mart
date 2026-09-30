import { CheckCircle } from 'lucide-react';

interface OrderSuccessProps {
  num: string;
  preference: string;
  storeName?: string;
  savedAmount?: number;
  whatsappNumber?: string;
  onTrackOrder: () => void;
  onContinueShopping: () => void;
}

export default function OrderSuccess({
  num,
  preference,
  storeName,
  savedAmount,
  whatsappNumber,
  onTrackOrder,
  onContinueShopping,
}: OrderSuccessProps) {
  const eta =
    preference === 'within_15'
      ? '10-15 mins'
      : preference === 'within_30'
        ? '30 mins'
        : '1 hour';

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex items-center justify-center px-4 py-8">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-500" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          Order Confirmed!
        </h2>

        {savedAmount && savedAmount > 0 && (
          <div className="inline-flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full mb-3">
            You saved ₹{savedAmount.toFixed(0)} with this order!
          </div>
        )}

        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
          Arriving in{' '}
          <span className="font-semibold text-gray-900 dark:text-white">
            {eta}
          </span>
        </p>

        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-2xl p-4 mb-6 text-left">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-500 dark:text-slate-400">
              Order ID
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              #{num}
            </span>
          </div>
          {storeName && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500 dark:text-slate-400">
                Fulfilled by
              </span>
              <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                {storeName}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onTrackOrder}
          className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all shadow-sm mb-3"
        >
          Track My Order
        </button>

        <button
          onClick={onContinueShopping}
          className="w-full py-3 text-sm font-semibold text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 rounded-2xl transition-colors mb-4"
        >
          Continue Shopping
        </button>

        {whatsappNumber && (
          <a
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          >
            Need help? Chat on WhatsApp →
          </a>
        )}
      </div>
    </div>
  );
}
