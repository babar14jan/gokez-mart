import { useEffect, useState, useRef } from 'react';
import { ShoppingBag, ChevronDown, RefreshCw, X } from 'lucide-react';
import { authApi } from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  confirmed:        'bg-blue-100 text-blue-700',
  preparing:        'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-violet-100 text-violet-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-700',
  failed_delivery:  'bg-orange-100 text-orange-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed',
};

// Progress steps — cancelled is handled separately
const STEPS = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const STEP_LABELS = ['Placed', 'Confirmed', 'Preparing', 'On the Way', 'Delivered'];

const STEP_ICONS: Record<string, string> = {
  pending: '🕐', confirmed: '✅', preparing: '🍳', out_for_delivery: '🛵', delivered: '🎉',
};

const POLL_INTERVAL = 10000; // 10 seconds

function hasActiveOrder(orders: any[]) {
  return orders.some(o => !['delivered', 'cancelled', 'failed_delivery', 'terminated'].includes(o.status));
}

interface OrderHistoryPageProps { onBack?: () => void; }

export default function OrderHistoryPage({ onBack: _onBack }: OrderHistoryPageProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await authApi.getOrders();
      setOrders(r.data.data || []);
      setLastUpdated(new Date());
    } catch {}
    finally { setRefreshing(false); setLoading(false); }
  };

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await authApi.cancelOrder(orderId);
      await fetchOrders(true);
    } catch {}
    finally { setCancelling(null); setConfirmCancel(null); }
  };

  // Start/stop polling based on whether there are active orders
  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (hasActiveOrder(orders)) {
      pollRef.current = setInterval(() => fetchOrders(true), POLL_INTERVAL);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [orders]);

  const stepIndex = (status: string) => STEPS.indexOf(status);

  return (
    <div className="min-h-screen bg-[#fafaf9] dark:bg-slate-900 font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">

        {/* Live indicator — only when active orders exist */}
        {!loading && hasActiveOrder(orders) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Live tracking</span>
              {lastUpdated && (
                <span className="text-[10px] text-gray-400 dark:text-slate-500">
                  · Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>
            <button onClick={() => fetchOrders()} disabled={refreshing}
              className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">No orders yet</p>
            <p className="text-sm text-gray-400 mb-5">Your order history will appear here.</p>
            <button
              onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl transition-all shadow-sm">
              Browse Products
            </button>
          </div>
        ) : (
          orders.map(order => {
            const isActive = !['delivered', 'cancelled', 'failed_delivery', 'terminated'].includes(order.status);
            const curStep = stepIndex(order.status);
            const isCancelled = ['cancelled', 'failed_delivery', 'terminated'].includes(order.status);

            return (
              <div key={order.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm transition-all ${
                  isActive ? 'border-emerald-200 dark:border-emerald-800' : 'border-gray-100 dark:border-slate-700'
                }`}>

                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{order.orderNumber}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                      {/* Delivery preference */}
                  {order.deliveryPreference && order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <span className="text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                      {order.deliveryPreference === 'within_15' ? '⚡ Within 10-15 mins' :
                       order.deliveryPreference === 'within_30' ? '🕐 Within 30 mins' : '🕑 Within 1 hour'}
                    </span>
                  )}
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {' · '}₹{order.total}
                    </p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded === order.id ? 'rotate-180' : ''}`} />
                </div>

                {/* Progress bar — active orders only */}
                {isActive && !isCancelled && (
                  <div className="px-4 pb-4">
                    <div className="relative">
                      {/* Background line */}
                      <div className="absolute left-0 right-0 top-4 h-0.5 bg-gray-200 dark:bg-slate-600 mx-4" />
                      {/* Progress fill */}
                      <div
                        className="absolute left-4 top-4 h-0.5 bg-emerald-500 transition-all duration-700"
                        style={{ width: `calc(${(curStep / (STEPS.length - 1)) * 100}% - 2rem)` }}
                      />
                      {/* Steps: circle + label stacked */}
                      <div className="relative flex justify-between">
                        {STEPS.map((step, i) => (
                          <div key={step} className="flex flex-col items-center gap-1.5" style={{ width: '20%' }}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base z-10 relative bg-white dark:bg-slate-800 border-2 transition-all ${
                              i <= curStep ? 'border-emerald-500' : 'border-gray-200 dark:border-slate-600'
                            }`}>
                              {i <= curStep
                                ? <span>{STEP_ICONS[step]}</span>
                                : <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-slate-500 block" />}
                            </div>
                            <span className={`text-[9px] font-semibold text-center leading-tight ${
                              i <= curStep ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-slate-600'
                            }`}>{STEP_LABELS[i]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Cancelled state */}
                {isCancelled && (
                  <div className="px-4 pb-3">
                    <p className={`text-xs font-medium ${
                      order.status === 'failed_delivery' ? 'text-orange-500 dark:text-orange-400' :
                      order.status === 'terminated' ? 'text-gray-500 dark:text-slate-400' :
                      'text-red-500 dark:text-red-400'
                    }`}>
                      {order.status === 'failed_delivery'
                        ? '😔 We were unable to deliver your order. Please contact us if you need help.'
                        : order.status === 'terminated'
                        ? '😔 Sorry — your order had to be cancelled by our team. You will not be charged. Please reorder.'
                        : 'This order was cancelled.'}
                    </p>
                  </div>
                )}

                {/* Cancel button — only for pending/confirmed */}
                {(order.status === 'pending' || order.status === 'confirmed') && (
                  <div className="px-4 pb-3">
                    {confirmCancel === order.id ? (
                      <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 dark:text-red-400 flex-1">Cancel this order?</p>
                        <button onClick={() => handleCancel(order.id)} disabled={cancelling === order.id}
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-colors">
                          {cancelling === order.id ? '...' : 'Yes, Cancel'}
                        </button>
                        <button onClick={() => setConfirmCancel(null)}
                          className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-xs font-semibold rounded-lg">
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmCancel(order.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 transition-colors">
                        <X className="w-3.5 h-3.5" /> Cancel Order
                      </button>
                    )}
                  </div>
                )}

                {/* Delivery person — only shown when out for delivery */}
                {order.status === 'out_for_delivery' && order.deliveryByName && (
                  <div className="mx-4 mb-3 flex items-center justify-between gap-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-white">{order.deliveryByName[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{order.deliveryByName}</p>
                        <p className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">🛵 Your delivery person</p>
                      </div>
                    </div>
                    {order.deliveryByPhone && (
                      <a href={`tel:${order.deliveryByPhone}`}
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold rounded-xl transition-colors flex-shrink-0">
                        📞 Call
                      </a>
                    )}
                  </div>
                )}

                {/* Expanded items */}
                {expanded === order.id && (
                  <div className="px-4 pb-4 border-t border-gray-50 dark:border-slate-700 pt-3 space-y-2">
                    {(order.items || []).map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs text-gray-600 dark:text-slate-400">
                        <span>{item.productName} ({item.unit}) × {item.quantity}</span>
                        <span className="font-semibold text-gray-900 dark:text-white">₹{item.total}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 pt-1 border-t border-gray-100 dark:border-slate-700">
                      <span>Delivery</span><span>₹{order.deliveryCharge}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white">
                      <span>Total</span><span>₹{order.total}</span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-slate-500 pt-1">📍 {order.guestAddress}</p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
