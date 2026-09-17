import { useEffect, useState, useRef } from 'react';
import { ShoppingBag, RefreshCw, X, Phone, MapPin, RotateCcw, IndianRupee } from 'lucide-react';
import { authApi } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { printReceipt } from '../utils/printReceipt';

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
const STEP_LABELS = ['Order Placed', 'Being Prepared', 'On the Way', 'Delivered'];
const STEP_ICONS = ['🛒', '🍳', '🛵', '🎉'];

// Map internal statuses to customer-visible step (4 steps)
const STATUS_TO_STEP: Record<string, string> = {
  pending:          'pending',
  confirmed:        'pending',
  preparing:        'preparing',
  ready_to_pickup:  'preparing',
  out_for_delivery: 'out_for_delivery',
  picked_up:        'out_for_delivery',
  delivered:        'delivered',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed', confirmed: 'Confirmed', preparing: 'Being Prepared',
  out_for_delivery: 'Out for Delivery', ready_to_pickup: 'Being Prepared', picked_up: 'On the Way', delivered: 'Order Delivered',
  cancelled: 'Order Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Cancelled by Store',
};

const TERMINATION_MESSAGES: Record<string, { title: string; sub: string }> = {
  outside_area: {
    title: 'Outside delivery area',
    sub: "We're sorry — your address is currently outside our delivery zone. We're expanding soon and will be in your area! 🌱",
  },
};


const CANCELLATION_MESSAGES: Record<string, string> = {
  customer_request: 'Cancelled as requested.',
  duplicate_order:  'Cancelled — this appeared to be a duplicate order.',
  out_of_stock:     'Sorry — some items became unavailable. You will not be charged.',
  store_closed:     'Sorry — the store had to close unexpectedly. You will not be charged.',
  other:            'Your order was cancelled. You will not be charged.',
};
const STATUS_EMOJI: Record<string, string> = {
  delivered: '✅', cancelled: '❌', failed_delivery: '😔', terminated: '❌',
};

const CLOSED = ['cancelled', 'failed_delivery', 'terminated'];
const DELIVERED = ['delivered'];
const ALL_CLOSED = [...CLOSED, ...DELIVERED];

// Only show delivered in current tab if delivered within last 30 mins
function isRecentlyDelivered(order: any): boolean {
  if (order.status !== 'delivered') return false;
  const updated = new Date(order.updatedAt || order.createdAt).getTime();
  return Date.now() - updated < 30 * 60 * 1000;
}

function hasActiveOrder(orders: any[]) {
  return orders.some(o => !ALL_CLOSED.includes(o.status));
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
    + ' at ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── Item Thumbnails ───────────────────────────────────────────────────────────
function ItemThumbnails({ items }: { items: any[] }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
      {items.map((item: any, i: number) => (
        <div key={i} className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
          {item.photoUrl
            ? <img src={item.photoUrl} alt={item.productName} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-xl">🥦</div>
          }
        </div>
      ))}
    </div>
  );
}

// ── Order Detail Bottom Sheet ─────────────────────────────────────────────────
function OrderDetailSheet({ order, onClose, onOrderAgain }: { order: any; onClose: () => void; onOrderAgain: (order: any) => void }) {

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 dark:bg-slate-600 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700">
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Order #{order.orderNumber}</p>
            <p className="text-xs text-gray-500 mt-0.5">Placed {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              order.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
            }`}>{STATUS_LABELS[order.status]}</span>
            <button onClick={onClose} className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
              <X className="w-5 h-5 text-red-500" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Items */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Items Ordered</p>
            <div className="space-y-3">
              {(order.items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
                      {item.photoUrl
                        ? <img src={item.photoUrl} alt={item.productName} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-lg">🥦</div>
                      }
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{item.productName}</p>
                      <p className="text-xs text-gray-500">{item.unit}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">₹{item.total}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bill */}
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Bill Details</p>
            <div className="flex justify-between text-sm text-gray-600 dark:text-slate-400">
              <span>Item total</span><span>₹{order.subtotal}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600 dark:text-slate-400">
              <span>Delivery</span>
              <span>{order.deliveryCharge === 0 ? <span className="text-emerald-600 font-semibold">FREE</span> : `₹${order.deliveryCharge}`}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white pt-2 border-t border-gray-200 dark:border-slate-600">
              <span>Total Paid</span><span>₹{order.total}</span>
            </div>
          </div>

          {/* Address */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-0.5">Delivered to</p>
              <p className="text-sm text-gray-700 dark:text-slate-300">{order.guestAddress}</p>
            </div>
          </div>

          {/* Payment + Receipt + Fulfilled — compact single section */}
          <div className="border-t border-gray-100 dark:border-slate-700 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-slate-400">Payment</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white uppercase">{order.paymentMethod}</p>
            </div>
            {order.fulfilledBy && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-slate-400">Fulfilled by</p>
                <p className="text-xs font-semibold text-gray-900 dark:text-white">{order.fulfilledBy}</p>
              </div>
            )}
            {order.status === 'delivered' && (
              <button onClick={() => printReceipt(order)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors">
                <IndianRupee className="w-3.5 h-3.5" /> Download Receipt
              </button>
            )}
          </div>


          {/* Order Again — all closed orders */}
          <button onClick={() => { onOrderAgain(order); onClose(); }}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all">
            <RotateCcw className="w-4 h-4" /> Order Again
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
interface Props { onBack?: () => void; }

export default function OrderHistoryPage({ onBack: _onBack }: Props) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [reorderToast, setReorderToast] = useState('');
  const [activeTab, setActiveTab] = useState<'current' | 'past'>('current');
  const [pastSearch, setPastSearch] = useState('');
  const [pastFilter, setPastFilter] = useState<'all' | 'delivered' | 'cancelled'>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addItem } = useCartStore();

  const fetchOrders = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try { const r = await authApi.getOrders(); setOrders(r.data.data || []); }
    catch {} finally { setRefreshing(false); setLoading(false); }
  };

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try { await authApi.cancelOrder(orderId); await fetchOrders(true); }
    catch {} finally { setCancelling(null); setConfirmCancel(null); }
  };

  const handleOrderAgain = (order: any) => {
    const items = order.items || [];
    items.forEach((item: any) => {
      addItem({
        id: item.productId, name: item.productName, unit: item.unit,
        price: item.price, photoUrl: item.photoUrl || null,
        availabilityStatus: 'available', isAvailable: true,
        discountPercent: 0, categoryId: '', categoryName: '',
        description: null, weightOptions: null, localName: null,
      });
    });
    setReorderToast(`${items.length} item${items.length > 1 ? 's' : ''} added to cart`);
    setTimeout(() => setReorderToast(''), 3000);
  };

  useEffect(() => { fetchOrders(); }, []);
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Keep polling while any order is not fully closed
    const hasLive = orders.some(o => !ALL_CLOSED.includes(o.status));
    if (hasLive) pollRef.current = setInterval(() => fetchOrders(true), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [orders]);

  const activeOrders = orders.filter(o => !ALL_CLOSED.includes(o.status));
  const deliveredOrders = orders.filter(o => isRecentlyDelivered(o));
  const pastOrders = orders.filter(o => ALL_CLOSED.includes(o.status) && !isRecentlyDelivered(o));

  // Filtered past orders
  const filteredPast = pastOrders.filter(o => {
    const matchFilter = pastFilter === 'all' ||
      (pastFilter === 'delivered' && o.status === 'delivered') ||
      (pastFilter === 'cancelled' && ['cancelled', 'failed_delivery', 'terminated'].includes(o.status));
    const q = pastSearch.toLowerCase();
    const matchSearch = !pastSearch ||
      o.orderNumber?.toLowerCase().includes(q) ||
      (o.items || []).some((i: any) => i.productName?.toLowerCase().includes(q));
    return matchFilter && matchSearch;
  });

  // Auto-switch to past tab if no active or delivered orders
  const showTab = (activeOrders.length > 0 || deliveredOrders.length > 0) ? activeTab : 'past';

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
      <p className="text-sm text-gray-500 mb-6">Your order history will appear here.</p>
      <button onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl transition-all">
        Start Shopping
      </button>
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-3 py-4 space-y-4 pb-36">

      {/* Reorder toast */}
      {reorderToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg">
          🛒 {reorderToast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-2xl p-1">
        <button
          onClick={() => setActiveTab('current')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all ${
            showTab === 'current'
              ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-slate-400'
          }`}>
          Current
          {(activeOrders.length + deliveredOrders.length) > 0 && (
            <span className="w-5 h-5 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {activeOrders.length + deliveredOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all ${
            showTab === 'past'
              ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-slate-400'
          }`}>
          Past
          {pastOrders.length > 0 && (
            <span className="text-[10px] text-gray-500 dark:text-slate-400 font-normal">({pastOrders.length})</span>
          )}
        </button>
      </div>

      {/* Live indicator — current tab only */}
      {showTab === 'current' && hasActiveOrder(orders) && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Live tracking</span>
          </div>
          <button onClick={() => fetchOrders()} disabled={refreshing}
            className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-600 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Past tab: search + filter */}
      {showTab === 'past' && pastOrders.length > 0 && (
        <div className="space-y-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
            <input
              type="text" value={pastSearch}
              onChange={e => setPastSearch(e.target.value)}
              placeholder="Search by order #..."
              className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm border-0"
            />
            {pastSearch && (
              <button onClick={() => setPastSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {(['all', 'delivered', 'cancelled'] as const).map(f => (
              <button key={f} onClick={() => setPastFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  pastFilter === f
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 shadow-sm'
                }`}>
                {f === 'all' ? 'All' : f === 'delivered' ? 'Delivered' : 'Cancelled'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Current tab: Active orders ── */}
      {showTab === 'current' && (
        activeOrders.length === 0 && deliveredOrders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No active orders</p>
            <p className="text-xs text-gray-500">All your orders have been delivered.</p>
          </div>
        ) : (
          <>
            {activeOrders.map(order => {
        const curStep = STEPS.indexOf(STATUS_TO_STEP[order.status] || order.status);
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
              <div className="text-right">
                <span className="text-emerald-100 text-xs font-semibold">Order #{order.orderNumber}</span>
                {order.fulfilledBy && (
                  <p className="text-emerald-200 text-[10px] mt-0.5">🏪 {order.fulfilledBy}</p>
                )}
              </div>
            </div>

            {/* Progress tracker */}
            <div className="px-4 pt-5 pb-4">
              <div className="relative flex justify-between items-start">
                <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-100 dark:bg-slate-700" />
                <div className="absolute top-4 left-4 h-0.5 bg-emerald-500 transition-all duration-700"
                  style={{ width: curStep >= 0 ? `calc(${(curStep / (STEPS.length - 1)) * 100}%)` : '0%' }} />
                {STEPS.map((step, i) => (
                  <div key={step} className="flex flex-col items-center gap-1.5 z-10" style={{ width: '20%' }}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 bg-white dark:bg-slate-800 transition-all ${
                      i < curStep ? 'border-emerald-500' :
                      i === curStep ? 'border-emerald-500 shadow-md shadow-emerald-200 scale-110' :
                      'border-gray-200 dark:border-slate-600'
                    }`}>
                      {i <= curStep
                        ? <span className={i === curStep ? 'animate-bounce' : ''}>{STEP_ICONS[i]}</span>
                        : <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-600 block" />}
                    </div>
                    <span className={`text-[9px] font-semibold text-center leading-tight ${
                      i <= curStep ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
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

            {/* Item thumbnails */}
            <div className="px-4 pb-3">
              <ItemThumbnails items={order.items || []} />
            </div>

            {/* Total + address */}
            <div className="mx-4 pt-3 border-t border-gray-100 dark:border-slate-700 space-y-1.5 pb-4">
              <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white">
                <span>{(order.items || []).length} items</span><span>₹{order.total}</span>
              </div>
              <div className="flex items-start gap-1.5">
                <MapPin className="w-3 h-3 text-gray-500 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-gray-500 leading-tight">{order.guestAddress}</p>
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
                      className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-600 text-xs font-semibold rounded-xl">No</button>
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

            {/* Delivered orders — same style as past cards */}
            {deliveredOrders.map(order => (
              <div key={order.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-emerald-200 dark:border-emerald-800 overflow-hidden shadow-sm">
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          🎉 Order Delivered!
                        </p>
                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                          {(order.items || []).length} items
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Placed {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">₹{order.total}</span>
                  </div>
                  <ItemThumbnails items={order.items || []} />
                </div>
                <div className="flex border-t border-gray-100 dark:border-slate-700">
                  <button onClick={() => setSelectedOrder(order)}
                    className="flex-1 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                    View Details
                  </button>
                  <div className="w-px bg-gray-100 dark:bg-slate-700" />
                  <button onClick={() => handleOrderAgain(order)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                    <RotateCcw className="w-3.5 h-3.5" /> Order Again
                  </button>
                </div>
              </div>
            ))}
          </>
        )
      )}

      {/* ── Past tab: Past orders ── */}
      {showTab === 'past' && (
        <div className="space-y-3">
          {filteredPast.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                {pastSearch || pastFilter !== 'all' ? 'No orders match' : 'No past orders'}
              </p>
              <p className="text-xs text-gray-500">
                {pastSearch || pastFilter !== 'all' ? 'Try a different search or filter' : 'Your completed orders will appear here'}
              </p>
            </div>
          ) : filteredPast.map(order => {
            const emoji = STATUS_EMOJI[order.status] || '❌';
            const termMsg = order.terminationReason ? TERMINATION_MESSAGES[order.terminationReason] : null;
            const cancelMsg = order.cancellationReason ? CANCELLATION_MESSAGES[order.cancellationReason] : null;
            return (
              <div key={order.id} className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm ${
                termMsg ? 'border-amber-200 dark:border-amber-800' : 'border-gray-100 dark:border-slate-700'
              }`}>
                {/* Card body */}
                <div className="px-4 pt-4 pb-3">
                  {/* Status + date */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {emoji} {STATUS_LABELS[order.status]}
                        </p>
                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                          {(order.items || []).length} items
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Placed {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">₹{order.total}</span>
                  </div>

                  {/* Termination / cancellation reason message */}
                  {(termMsg || cancelMsg) && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5 mb-3">
                      {termMsg && <>
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-0.5">📍 {termMsg.title}</p>
                        <p className="text-xs text-amber-600 dark:text-amber-500 leading-relaxed">{termMsg.sub}</p>
                      </>}
                      {cancelMsg && !termMsg && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">{cancelMsg}</p>
                      )}
                    </div>
                  )}

                  {/* Item thumbnails */}
                  <ItemThumbnails items={order.items || []} />
                </div>

                {/* Actions */}
                <div className="flex border-t border-gray-100 dark:border-slate-700">
                  <button onClick={() => setSelectedOrder(order)}
                    className="flex-1 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                    View Details
                  </button>
                  {/* Order Again — for all closed orders */}
                  {true && (
                    <>
                      <div className="w-px bg-gray-100 dark:bg-slate-700" />
                      <button onClick={() => handleOrderAgain(order)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" /> Order Again
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom sheet */}
      {selectedOrder && (
        <OrderDetailSheet
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderAgain={handleOrderAgain}
        />
      )}
    </div>
  );
}
