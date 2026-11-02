import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, VolumeX, X } from 'lucide-react';
import { onOrderEvent, type LiveOrderEvent } from '../services/realtime';
import { startOrderAlarm, stopOrderAlarm } from '../services/orderAlarm';

interface ToastItem {
  key: number;
  orderNumber?: string;
  total?: number;
  guestName?: string;
}

let nextKey = 0;

export default function LiveOrderToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [ringing, setRinging] = useState(false);
  const navigate = useNavigate();

  const stopRinging = () => {
    stopOrderAlarm();
    setRinging(false);
  };

  const dismiss = (key: number) => {
    setToasts(prev => prev.filter(x => x.key !== key));
  };

  useEffect(() => {
    const off = onOrderEvent((event: LiveOrderEvent) => {
      if (event.type !== 'order.created') return;
      const toast: ToastItem = {
        key: ++nextKey,
        orderNumber: event.order.orderNumber,
        total: event.order.total,
        guestName: event.order.guestName,
      };
      setToasts(prev => [...prev.slice(-2), toast]);
      setRinging(true);
      startOrderAlarm();
    });
    return () => {
      off();
      stopOrderAlarm();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-3 sm:bottom-6 sm:right-6 z-[100] flex flex-col gap-2 w-[calc(100%-1.5rem)] max-w-sm">
      {toasts.map(t => (
        <div
          key={t.key}
          onClick={() => { stopRinging(); dismiss(t.key); navigate('/orders'); }}
          className="cursor-pointer rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 shadow-lg shadow-emerald-900/10 p-3.5 flex items-start gap-3 animate-in"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
              New Order #{t.orderNumber || ''}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 truncate">
              {t.guestName || 'Customer'} · ₹{t.total || 0}
            </p>
            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1">Tap to open orders</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {ringing && (
              <button
                onClick={e => { e.stopPropagation(); stopRinging(); }}
                className="p-1 text-amber-600 hover:text-amber-700 dark:text-amber-400"
                aria-label="Stop ringing"
                title="Stop ringing"
              >
                <VolumeX className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); stopRinging(); dismiss(t.key); }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}