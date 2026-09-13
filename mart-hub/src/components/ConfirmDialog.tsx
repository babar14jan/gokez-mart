import { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={loading ? undefined : onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-1">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors">
            {cancelLabel}
          </button>
          <button onClick={handleConfirm} disabled={loading}
            className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-70 ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
            }`}>
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
