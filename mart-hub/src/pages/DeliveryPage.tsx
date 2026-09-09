import { useEffect, useState, useRef } from 'react';
import { Phone, MapPin, Navigation, RefreshCw, CheckCircle, Package, Clock } from 'lucide-react';
import { ordersApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

export default function DeliveryPage() {
  const { id: myId } = useAuthStore() as any;
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await ordersApi.getAll({ limit: 50 });
      const all = r.data.data || [];
      // Only show orders assigned to me
      const mine = all.filter((o: any) =>
        o.deliveryById === myId ||
        ['out_for_delivery', 'picked_up'].includes(o.status)
      );
      setOrders(mine);
    } catch {} finally { setRefreshing(false); setLoading(false); }
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const updateStatus = async (orderId: string, status: string) => {
    setUpdating(orderId);
    try {
      await ordersApi.updateStatus(orderId, status);
      await load(true);
    } catch { alert('Failed to update status'); }
    finally { setUpdating(null); }
  };

  const openMaps = (address: string) => {
    const encoded = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`, '_blank');
  };

  const active = orders.filter(o => ['out_for_delivery', 'picked_up'].includes(o.status));
  const done = orders.filter(o => o.status === 'delivered').slice(0, 5);

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4 max-w-lg mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {active.length} active · {done.length} delivered today
          </p>
        </div>
        <button onClick={() => load()} disabled={refreshing}
          className="p-2 rounded-xl text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Active deliveries */}
      {active.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 text-center py-16 px-6">
          <div className="text-5xl mb-3">🛵</div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No active deliveries</p>
          <p className="text-xs text-gray-400">You'll get a notification when orders are assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(order => (
            <div key={order.id} className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm ${
              order.status === 'out_for_delivery' ? 'border-violet-200 dark:border-violet-800' : 'border-amber-200 dark:border-amber-800'
            }`}>
              {/* Status bar */}
              <div className={`px-4 py-2.5 flex items-center justify-between ${
                order.status === 'out_for_delivery' ? 'bg-violet-500' : 'bg-amber-500'
              }`}>
                <div className="flex items-center gap-2">
                  {order.status === 'out_for_delivery'
                    ? <Package className="w-4 h-4 text-white" />
                    : <Navigation className="w-4 h-4 text-white" />
                  }
                  <span className="text-white text-sm font-bold">
                    {order.status === 'out_for_delivery' ? 'Go to Store — Pick Up' : 'On the Way to Customer'}
                  </span>
                </div>
                <span className="text-white/80 text-xs">Order #{order.orderNumber}</span>
              </div>

              <div className="p-4 space-y-3">
                {/* Customer info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{order.guestName}</p>
                    <div className="flex items-start gap-1.5 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">{order.guestAddress}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {/* Call */}
                    <a href={`tel:${order.guestPhone}`}
                      className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-colors">
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                    {/* Navigate */}
                    <button onClick={() => openMaps(order.guestAddress)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors">
                      <Navigation className="w-3.5 h-3.5" /> Maps
                    </button>
                  </div>
                </div>

                {/* Items summary */}
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {(order.items || []).length} item{(order.items || []).length !== 1 ? 's' : ''} · ₹{order.total}
                    {order.deliveryNote && <span className="ml-2 text-gray-400">· {order.deliveryNote}</span>}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  {order.status === 'out_for_delivery' && (
                    <button
                      onClick={() => updateStatus(order.id, 'picked_up')}
                      disabled={updating === order.id}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors">
                      {updating === order.id
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Package className="w-4 h-4" />
                      }
                      Picked Up from Store
                    </button>
                  )}
                  {order.status === 'picked_up' && (
                    <button
                      onClick={() => updateStatus(order.id, 'delivered')}
                      disabled={updating === order.id}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors">
                      {updating === order.id
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <CheckCircle className="w-4 h-4" />
                      }
                      Mark Delivered
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Done today */}
      {done.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-2">
            <Clock className="w-3.5 h-3.5 inline mr-1" />Delivered Today
          </p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden divide-y divide-gray-50 dark:divide-slate-700">
            {done.map(order => (
              <div key={order.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{order.guestName}</p>
                  <p className="text-xs text-gray-400 truncate">{order.guestAddress}</p>
                </div>
                <span className="text-xs font-bold text-gray-500 dark:text-slate-400">₹{order.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
