import { useState } from 'react';
import { X, Banknote, Smartphone, ChevronDown } from 'lucide-react';

interface PaymentConfirmDialogProps {
  orderTotal: number;
  onConfirm: (method: 'cash' | 'upi' | 'split', cashAmount?: number, upiAmount?: number) => void;
  onCancel: () => void;
}

export default function PaymentConfirmDialog({ orderTotal, onConfirm, onCancel }: PaymentConfirmDialogProps) {
  const [selected, setSelected] = useState<'cash' | 'upi' | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');

  const handleSelect = (method: 'cash' | 'upi') => {
    if (selected === method) {
      setSelected(null);
      setShowSplit(false);
    } else if (selected && selected !== method) {
      setSelected(method);
      setShowSplit(true);
    } else {
      setSelected(method);
      setShowSplit(false);
    }
  };

  const handleConfirm = () => {
    if (!selected) return;
    if (showSplit) {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      if (cash + upi !== orderTotal) return;
      onConfirm('split', cash, upi);
    } else {
      onConfirm(selected);
    }
  };

  const splitTotal = (parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0);
  const splitValid = showSplit && splitTotal === orderTotal;

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
            {selected === 'cash' && !showSplit && (
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
            {selected === 'upi' && !showSplit && (
              <span className="ml-auto text-xs text-emerald-600 font-bold">₹{orderTotal}</span>
            )}
          </button>
        </div>

        {selected && (
          <button
            onClick={() => setShowSplit(!showSplit)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSplit ? 'rotate-180' : ''}`} />
            {showSplit ? 'Hide split payment' : 'Split payment (Cash + UPI)'}
          </button>
        )}

        {showSplit && selected && (
          <div className="mt-3 space-y-2 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Cash Amount</label>
              <input
                type="number"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
                placeholder="0"
                className="w-full mt-1 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">UPI Amount</label>
              <input
                type="number"
                value={upiAmount}
                onChange={e => setUpiAmount(e.target.value)}
                placeholder="0"
                className="w-full mt-1 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <p className={`text-[10px] font-semibold ${splitValid ? 'text-emerald-600' : 'text-red-500'}`}>
              Total: ₹{splitTotal} / ₹{orderTotal}
            </p>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!selected || (showSplit && !splitValid)}
          className="mt-4 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
        >
          Confirm & Mark Delivered
        </button>
      </div>
    </div>
  );
}
