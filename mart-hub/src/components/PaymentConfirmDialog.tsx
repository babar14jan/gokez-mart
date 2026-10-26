import { useEffect, useState } from 'react';
import { X, Store } from 'lucide-react';
import { settingsApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';

interface PaymentConfirmDialogProps {
  orderTotal: number;
  submitting?: boolean;
  onConfirm: (method: 'cash' | 'upi') => void;
  onCancel: () => void;
}

export default function PaymentConfirmDialog({ orderTotal, submitting = false, onConfirm, onCancel }: PaymentConfirmDialogProps) {
  const [selected, setSelected] = useState<'cash' | 'upi' | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [storeName, setStoreName] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // The QR is optional — it is shown for UPI only when the store has one enabled.
  useEffect(() => {
    settingsApi.getAll(getActiveStoreId()).then(r => {
      const list = r.data.data || [];
      const qrEnabled = list.find((s: any) => s.key === 'upi_qr_enabled')?.value === 'true'
        || list.find((s: any) => s.key === 'phonepay_enabled')?.value === 'true';
      const qr = list.find((s: any) => s.key === 'phonepay_qr_url')?.value;
      setQrUrl(qrEnabled && qr ? qr : '');
      setStoreName(list.find((s: any) => s.key === 'store_name')?.value || '');
    }).catch(() => {}).finally(() => setSettingsLoaded(true));
  }, []);

  const handleSelect = (method: 'cash' | 'upi') => {
    if (submitting) return;
    // Cash is the common case and needs no further confirmation: tapping it
    // records the payment and completes the delivery in one action.
    if (method === 'cash') {
      onConfirm('cash');
      return;
    }
    if (qrUrl) {
      setSelected('upi');
      setShowQr(true);
      return;
    }
    // Wait for the QR setting before deciding whether UPI needs a scan step.
    if (settingsLoaded) {
      onConfirm('upi');
      return;
    }
    setSelected('upi');
  };

  const handleConfirm = () => {
    if (!selected || submitting) return;
    onConfirm(selected);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4">
      <div className="w-full sm:max-w-sm bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Confirm Payment</h3>
          <button onClick={onCancel} disabled={submitting} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
          Order Total: <span className="font-bold text-gray-900 dark:text-white">₹{orderTotal}</span>
        </p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          Select how the customer paid. Cash marks the order delivered immediately.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => handleSelect('cash')}
            disabled={submitting}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 ${
              selected === 'cash'
                ? 'bg-gray-900'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          >
            <span className="text-lg leading-none">💵</span>
            <span className={`text-sm font-semibold ${selected === 'cash' ? 'text-white' : 'text-gray-900 dark:text-white'}`}>Cash</span>
          </button>

          <button
            onClick={() => handleSelect('upi')}
            disabled={submitting}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50 ${
              selected === 'upi'
                ? 'bg-gray-900'
                : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          >
            <span className="text-lg leading-none">💳</span>
            <span className={`text-sm font-semibold ${selected === 'upi' ? 'text-white' : 'text-gray-900 dark:text-white'}`}>UPI</span>
          </button>
        </div>

        {selected === 'upi' && (
          <button
            onClick={handleConfirm}
            disabled={!selected || submitting}
            className="mt-4 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            {submitting ? 'Marking delivered…' : 'Confirm & Mark Delivered'}
          </button>
        )}

        {submitting && !selected && (
          <p className="mt-4 text-center text-sm font-semibold text-emerald-600 dark:text-emerald-400" role="status">
            Marking delivered…
          </p>
        )}
      </div>

      {showQr && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-xs bg-white dark:bg-slate-800 rounded-3xl shadow-2xl px-4 py-4 text-center">
            <div className="flex justify-end -mt-1 -mr-1">
              <button onClick={() => setShowQr(false)} disabled={submitting} aria-label="Close"
                className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <p className="text-sm font-semibold text-gray-500 dark:text-slate-400">Please scan to pay</p>
            <p className="mt-0.5 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">₹{orderTotal}</p>

            <div className="mt-3 rounded-2xl border border-gray-200 dark:border-slate-600 bg-white p-2">
              <img src={qrUrl} alt="UPI payment QR" className="mx-auto w-full max-w-full rounded-xl" />
            </div>

            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="mt-4 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-bold transition-colors"
            >
              {submitting ? 'Marking delivered…' : 'Confirm & Mark Delivered'}
            </button>

            {storeName && (
              <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-medium text-gray-600 dark:text-slate-400">
                <Store className="h-3.5 w-3.5" /> Fulfilled by {storeName}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
