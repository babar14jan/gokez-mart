import { useState } from 'react';
import { X, Banknote, Smartphone } from 'lucide-react';

interface PaymentConfirmDialogProps {
  orderTotal: number;
  onConfirm: (method: 'cash' | 'upi') => void;
  onCancel: () => void;
}

export default function PaymentConfirmDialog({ orderTotal, onConfirm, onCancel }: PaymentConfirmDialogProps) {
  const [selected, setSelected] = useState<'cash' | 'upi' | null>(null);

  const handleSelect = (method: 'cash' | 'upi') => {
    if (selected === method) {
      setSelected(null);
    } else {
      setSelected(method);
    }
  };

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Confirm Payment</h3>
          <button onClick={onCancel} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
          Order Total: <span className="font-bold text-gray-900 dark:text-white">₹{orderTotal}</span>
        </p>

        <div className="space-y-2 mb-4">
          <button
            onClick={() => handleSelect('cash')}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
              selected === 'cash'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                : 'border-gray-200 dark:border-slate-600 hover:border-gray-300'
            }`}
          >
            <Banknote className={`w-5 h-5 ${selected === 'cash' ? 'text-emerald-600' : 'text-gray-400'}`} />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Cash</span>
            {selected === 'cash' && (
              <span className="ml-auto text-xs text-emerald-600 font-bold">₹{orderTotal}</span>
            )}
          </button>

          <button
            onClick={() => handleSelect('upi')}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
              selected === 'upi'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                : 'border-gray-200 dark:border-slate-600 hover:border-gray-300'
            }`}
          >
            <Smartphone className={`w-5 h-5 ${selected === 'upi' ? 'text-emerald-600' : 'text-gray-400'}`} />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">UPI</span>
            {selected === 'upi' && (
              <span className="ml-auto text-xs text-emerald-600 font-bold">₹{orderTotal}</span>
            )}
          </button>
        </div>

        <button
          onClick={handleConfirm}
          disabled={!selected}
          className="mt-4 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
        >
          Confirm & Mark Delivered
        </button>
      </div>
    </div>
  );
}
