import { useState, useCallback } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return { toasts, show };
}

export function ToastContainer({ toasts }: { toasts: { id: number; message: string; type: string }[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white animate-fade-in ${
            t.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
          }`}>
          {t.type === 'success' ? '✓ ' : '✕ '}{t.message}
        </div>
      ))}
    </div>
  );
}
