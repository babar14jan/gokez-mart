import { useState } from 'react';
import { Phone, ArrowRight, X } from 'lucide-react';
import { useCustomerStore } from '../store/customerStore';

interface PhoneModalProps {
  onClose: () => void;
}

export default function PhoneModal({ onClose }: PhoneModalProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { setPhone: savePhone, setHasAskedPhone } = useCustomerStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) { setError('Enter a valid 10-digit number'); return; }

    setLoading(true); setError('');
    savePhone(cleaned);
    setHasAskedPhone();
    setLoading(false);
    onClose();
  };

  const handleSkip = () => {
    setHasAskedPhone();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl p-6">

        <div className="flex items-center justify-between mb-5">
          <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/40 rounded-2xl flex items-center justify-center">
            <Phone className="w-5 h-5 text-emerald-600" />
          </div>
          <button onClick={handleSkip} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          What's your number?
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
          We'll save your name and address for faster checkout next time.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-3 py-2 rounded-xl mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-2xl px-4 py-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
            <span className="text-sm font-semibold text-gray-500 dark:text-slate-400 flex-shrink-0">+91</span>
            <div className="w-px h-4 bg-gray-300 dark:bg-slate-500" />
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
              className="flex-1 bg-transparent text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none"
              autoFocus
              inputMode="numeric"
            />
          </div>

          <button type="submit" disabled={loading || phone.replace(/\D/g,'').length < 10}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm">
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <><ArrowRight className="w-4 h-4" /> Continue</>
            )}
          </button>
        </form>

        <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center mt-3">
          Your number is only used for order delivery. We don't spam.
        </p>
      </div>
    </div>
  );
}
