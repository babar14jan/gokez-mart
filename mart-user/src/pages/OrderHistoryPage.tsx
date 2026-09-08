import { useEffect, useState, useRef } from 'react';
import { ShoppingBag, RefreshCw, X, Phone, ChevronDown, MapPin } from 'lucide-react';
import { authApi } from '../services/api';

const STEPS = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
const STEP_LABELS = ['Placed', 'Confirmed', 'Preparing', 'On the Way', 'Delivered'];
const STEP_ICONS = ['🕐', '✅', '👨‍🍳', '🛵', '🎉'];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed', confirmed: 'Confirmed', preparing: 'Being Prepared',
  out_for_delivery: 'Out for Delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Cancelled by Store',
};

const CLOSED = ['delivered', 'cancelled', 'failed_delivery', 'terminated'];

function hasActiveOrder(orders: any[]) {
  return orders.some(o => !CLOSED.includes(o.status));
}

interface Props { onBack?: () => void; }

export default function OrderHistoryPage({ onBack: _onBack }: Props) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await authApi.getOrders();
      setOrders(r.data.data || []);
    } catch {}
    finally { setRefreshing(false); setLoading(false); }
  };

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try { await authApi.cancelOrder(orderId); await fetchOrders(true); }
    catch {} finally { setCancelling(null); setConfirmCancel(null); }
  };

  useEffect(() => { fetchOrders(); }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (hasActiveOrder(orders)) {
      pollRef.current = setInterval(() => fetchOrders(true), 10000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [orders]);

  const activeOrders = orders.filter(o => !CLOSED.includes(o.status));
  const pastOrders = orders.filter(o => CLOSED.includes(o.status));

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (orders.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-20 h-20 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
        <ShoppingBag className="w-9 h-9 text-gray-300" />
      </div>
      <p className="text-base font-bold text-gray-900 dark:text-white mb-1">No orders yet</p>
      <p className="text-sm text-gray-400 mb-6">Your order history will appear here.</p>
      <button
        onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl transition-all shadow-sm">
        Start Shopping
      </button>
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-3 py-4 space-y-4 pb-36">

      {/* Live indicator */}
      {hasActiveOrder(orders) && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Live tracking</span>
          </div>
          <button onClick={() => fetchOrders()} disabled={refreshing}
            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* ── Active orders ── */}
      {activeOrders.map(order => {
        const curStep = STEPS.indexOf(order.status);
        const canCancel = ['pending', 'confirmed'].includes(order.status);

        return (
          <div key={order.id} className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-md border border-emerald-100 dark:border-emerald-900">

            {/* Status banner */}
            <div className="bg-emerald-500 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">{STATUS_LABELS[order.status]}</p>
                {order.deliveryPreference && (
                  <p className="text-emerald-100 text-xs mt-0.5">
                    {order.deliveryPreference === 'within_15' ? '⚡ Expected in 10-15 mins'
                      : order.deliveryPreference === 'within_30' ? '🕐 Expected in ~30 mins'
                      : '🕑 Expected in ~1 hour'}
                  </p>
                )}
              </div>
              <span className="text-emerald-100 text-xs font-semibold">{order.orderNumber}</span>
            </div>

            {/* Progress tracker */}
            <div className="px-4 pt-5 pb-4">
              <div className="relative flex justify-between items-start">
                {/* Track line */}
                <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-100 dark:bg-slate-700" />
                <div className="absolute top-4 left-4 h-0.5 bg-emerald-500 transition-all duration-700"
                  style={{ width: curStep >= 0 ? `calc(${(curStep / (STEPS.length - 1)) * 100}% - 0px)` : '0%' }} />

                {STEPS.map((step, i) => (
                  <div key={step} className="flex flex-col items-center gap-1.5 z-10" style={{ width: '20%' }}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 bg-white dark:bg-slate-800 transition-all ${
                      i < curStep ? 'border-emerald-500 bg-emerald-50' :
                      i === curStep ? 'border-emerald-500 shadow-md shadow-emerald-200 scale-110' :
                      'border-gray-200 dark:border-slate-600'
                    }`}>
                      {i <= curStep
                        ? <span className={i === curStep ? 'animate-bounce' : ''}>{STEP_ICONS[i]}</span>
                        : <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-600 block" />}
                    </div>
                    <span className={`text-[9px] font-semibold text-center leading-tight ${
                      i <= curStep ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-slate-600'
                    }`}>{STEP_LABELS[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery person */}
            {order.status === 'out_for_delivery' && order.deliveryByName && (
              <div className="mx-4 mb-3 flex items-center justify-between gap-3 bg-violet-50 dark:bg-violet-900/20 rounded-2xl px-3 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-violet-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-white">{order.deliveryByName[0].toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900 dark:text-white">{order.deliveryByName}</p>
                    <p className="text-[10px] text-violet-600 dark:text-violet-400">Your delivery partner</p>
                  </div>
                </div>
                {order.deliveryByPhone && (
                  <a href={`tel:${order.deliveryByPhone}`}
                    className="flex items-center gap-1.5 px-3 py-2 bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold rounded-xl transition-colors">
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                )}
              </div>
            )}

            {/* Order items */}
            <div className="px-4 pb-1 space-y-1.5">
              {(order.items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs text-gray-600 dark:text-slate-400">
                    {item.productName} <span className="text-gray-400">× {item.quantity}</span>
                  </span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-white">₹{item.total}</span>
                </div>
              ))}
            </div>

            {/* Divider + total + address */}
            <div className="mx-4 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700 space-y-1.5 pb-4">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Delivery charge</span><span>₹{order.deliveryCharge}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white">
                <span>Total</span><span>₹{order.total}</span>
              </div>
              <div className="flex items-start gap-1.5 mt-1">
                <MapPin className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-gray-400 leading-tight">{order.guestAddress}</p>
              </div>
            </div>

            {/* Cancel */}
            {canCancel && (
              <div className="px-4 pb-4">
                {confirmCancel === order.id ? (
                  <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-2xl px-3 py-2.5">
                    <p className="text-xs text-red-600 flex-1">Cancel this order?</p>
                    <button onClick={() => handleCancel(order.id)} disabled={cancelling === order.id}
                      className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                      {cancelling === order.id ? '...' : 'Yes'}
                    </button>
                    <button onClick={() => setConfirmCancel(null)}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-xs font-semibold rounded-xl">
                      No
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmCancel(order.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-500 transition-colors">
                    <X className="w-3.5 h-3.5" /> Cancel Order
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Past orders ── */}
      {pastOrders.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-2">Past Orders</p>
          <div className="space-y-2">
            {pastOrders.map(order => {
              const isDelivered = order.status === 'delivered';
              return (
                <div key={order.id}
                  className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">

                  {/* Header row */}
                  <button className="w-full flex items-center gap-3 px-4 py-3"
                    onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      isDelivered ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-red-50 dark:bg-red-900/20'
                    }`}>
                      <span className="text-lg">{isDelivered ? '✅' : '❌'}</span>
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{order.orderNumber}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isDelivered ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                        }`}>{STATUS_LABELS[order.status]}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {' · '}₹{order.total}
                        {' · '}{(order.items || []).length} item{(order.items || []).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${expanded === order.id ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Expanded items */}
                  {expanded === order.id && (
                    <div className="px-4 pb-4 border-t border-gray-50 dark:border-slate-700 pt-3 space-y-1.5">
                      {(order.items || []).map((item: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs text-gray-600 dark:text-slate-400">
                          <span>{item.productName} × {item.quantity}</span>
                          <span className="font-semibold text-gray-900 dark:text-white">₹{item.total}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs text-gray-400 pt-1.5 border-t border-gray-100 dark:border-slate-700">
                        <span>Delivery</span><span>₹{order.deliveryCharge}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white">
                        <span>Total</span><span>₹{order.total}</span>
                      </div>
                      <div className="flex items-start gap-1.5 pt-1">
                        <MapPin className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-gray-400">{order.guestAddress}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
