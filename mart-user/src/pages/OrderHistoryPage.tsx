import { useEffect, useState, useRef } from 'react';
import { ShoppingBag, RefreshCw, X, MapPin, RotateCcw, IndianRupee } from 'lucide-react';
import { authApi, storeApi } from '../services/api';
import { readTrackingTokens, clearTrackingTokens } from '../utils/guestTracking';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { useCartStore } from '../store/cartStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { printReceipt } from '../utils/printReceipt';

import {
  ActiveOrderCard, ClosedOrderCard, DeliveredOrderCard,
  ALL_CLOSED, STATUS_LABELS,
  isRecentlyDelivered, hasActiveOrder, formatDateTime,
} from '../components/OrderCards';
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
            {order.campaignDiscount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                <span>🎉 {order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'}</span>
                <span className="font-semibold">-₹{order.campaignDiscount}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white pt-2 border-t border-gray-200 dark:border-slate-600">
              <span>Total Paid</span><span>₹{order.total}</span>
            </div>
          </div>

          {/* Closed store indicator */}
          {order.placedOutsideHours && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 dark:text-amber-400">🕘</span>
                <div className="flex-1">
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    {order.closedReason === 'manual' ? 'Store was manually closed' : 'Ordered outside store hours'}
                  </p>
                  {order.scheduledForLabel && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      Will be prepared at {order.scheduledForLabel}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

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
interface Props { onBack?: () => void; whatsappNumber?: string; }

/* One header for both the guest and signed-in lists, so the two Orders pages do
   not drift apart visually again.

   `onClear` is intentionally injected rather than duplicated. The two meanings are
   NOT the same and must not be conflated:

     guest  -> the list IS device state, so clearing tokens empties it. Obvious.
     signed -> the list is the ACCOUNT's order history, served from the API.
               Deleting it is not something this button may do, so it only drops
               the leftover guest tokens on the device and says so in a toast.

   Same label and position in both; the toast is what keeps the second honest. */
function OrdersHeader({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">My Orders</h2>
      <button
        onClick={onClear}
        className="text-xs font-semibold text-gray-500 hover:text-emerald-600 transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

export default function OrderHistoryPage({ onBack: _onBack, whatsappNumber }: Props) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [reorderToast, setReorderToast] = useState('');
  const [clearToast, setClearToast] = useState('');
  const [activeTab, setActiveTab] = useState<'current' | 'past'>('current');
  const [pastSearch, setPastSearch] = useState('');
  const [pastFilter, setPastFilter] = useState<'all' | 'delivered' | 'cancelled'>('all');
  const [guestLoading, setGuestLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const { addItem } = useCartStore();
  const { name: customerName, phone: customerPhone, isLoggedIn } = useCustomerAuthStore();

  const fetchOrders = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try { const r = await authApi.getOrders(); setOrders(r.data.data || []); }
    catch {} finally { setRefreshing(false); setLoading(false); }
  };

  // Guests have no session, so authApi.getOrders() can only ever 401 here.
  const fetchGuestOrders = async (silent = false) => {
    if (!silent) setGuestLoading(true);
    try {
      const tokens = readTrackingTokens();
      if (!tokens.length) { setOrders([]); return; }
      const r = await storeApi.trackOrdersByTokens(tokens);
      setOrders(r.data.data || []);
    } catch { /* a token can be pruned server-side; keep whatever we have */ }
    finally { if (!silent) setGuestLoading(false); setLoading(false); }
  };

  const [cancelError, setCancelError] = useState('');

  /**
   * Guests cancel against their tracking token, signed-in customers against
   * their session. Refreshing must follow the same split: calling fetchOrders()
   * for a guest hits a guaranteed 401 and would leave the card showing a stale
   * status after a successful cancel.
   */
  const handleCancel = async (order: any) => {
    setCancelling(order.id);
    setCancelError('');
    try {
      if (isLoggedIn) {
        await authApi.cancelOrder(order.id);
        await fetchOrders(true);
      } else {
        await storeApi.cancelOrderByToken(order.id, order.trackingToken);
        await fetchGuestOrders(true);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error;
      setCancelError(msg && !msg.includes('Something went wrong')
        ? msg
        : 'Could not cancel this order. Please contact the store for help.');
    } finally {
      setCancelling(null);
      setConfirmCancel(null);
    }
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

  // Guests load from device tokens; there is no reason to spend a round trip on
  // an authenticated call that is guaranteed to 401 for them.
  useEffect(() => {
    if (isLoggedIn) fetchOrders();
    else fetchGuestOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Live updates for both audiences, but only while something is actually open.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasLive = orders.some(o => !ALL_CLOSED.includes(o.status));
    if (hasLive) {
      pollRef.current = setInterval(() => {
        if (isLoggedIn) fetchOrders(true);
        else fetchGuestOrders(true);
      }, 10000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, isLoggedIn]);

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

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(deltaX) > 50) {
      if (deltaX < 0 && showTab === 'current') setActiveTab('past');
      else if (deltaX > 0 && showTab === 'past') setActiveTab('current');
    }
    touchStartX.current = null;
  };

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isLoggedIn) {
    // readTrackingTokens swallows a corrupt payload. A bare JSON.parse here runs
    // during render, and with no error boundary in the tree a throw blanks the
    // whole app rather than falling back to the sign-in prompt.
    const hasLocalTokens = readTrackingTokens().length > 0;

    if (loading || guestLoading) return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );

    if (!hasLocalTokens) {
      return (
        <div className="max-w-lg mx-auto px-4 py-16 text-center pb-36">
          <div className="w-20 h-20 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-9 h-9 text-gray-300" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Your orders, right here</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            Sign in with your phone number to see all your past orders and track current ones.
          </p>
          <button
            onClick={() => { useLoginFlowStore.getState().setPostLoginPath('/orders'); useLoginFlowStore.getState().setGuestReturnPath('/orders'); window.history.pushState({}, '', '/account'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all shadow-sm mb-3"
          >
            Track My Orders →
          </button>
          <button
            onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="w-full py-3 text-sm font-semibold text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 rounded-2xl transition-colors"
          >
            Continue Shopping
          </button>
        </div>
      );
    }

    if (orders.length === 0) {
      return (
        <div className="max-w-lg mx-auto px-4 py-16 text-center pb-36">
          <div className="w-16 h-16 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShoppingBag className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No orders found</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-6">No recent orders on this device</p>
          <button
            onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="w-full py-3 text-sm font-semibold text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 rounded-2xl transition-colors"
          >
            Continue Shopping
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-36">
        <OrdersHeader onClear={() => { clearTrackingTokens(); setOrders([]); }} />
        {/* Same three cards the signed-in view uses. The only guest-specific
            input is canCancel: cancelling needs the order's tracking token, and
            an order whose token is missing cannot be proven to belong to this
            device, so no button is offered rather than one that would 404. */}
        {orders.map(order => {
          const isClosed = ALL_CLOSED.includes(order.status);
          const canGuestCancel = ['pending', 'confirmed'].includes(order.status)
            && typeof order.trackingToken === 'string' && order.trackingToken.length > 0;
          if (!isClosed) {
            return (
              <ActiveOrderCard key={order.id} order={order} whatsappNumber={whatsappNumber}
                canCancel={canGuestCancel}
                confirmCancel={confirmCancel} cancelling={cancelling}
                cancelError={cancelError}
                onCancel={handleCancel}
                onRequestCancel={(o) => { setCancelError(''); setConfirmCancel(o.id); }}
                onDismissConfirm={() => setConfirmCancel(null)} />
            );
          }
          if (order.status === 'delivered') {
            return (
              <DeliveredOrderCard key={order.id} order={order}
                onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />
            );
          }
          return (
            <ClosedOrderCard key={order.id} order={order}
              onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />
          );
        })}

        {/* Detail sheet for guests too — "View Details" has to open something. */}
        {selectedOrder && (
          <OrderDetailSheet order={selectedOrder} onClose={() => setSelectedOrder(null)}
            onOrderAgain={handleOrderAgain} />
        )}
        <div className="text-center">
          <button
            onClick={() => { useLoginFlowStore.getState().setPostLoginPath('/orders'); useLoginFlowStore.getState().setGuestReturnPath('/orders'); window.history.pushState({}, '', '/account'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            Track a different order →
          </button>
        </div>
      </div>
    );
  }

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
    <div className="max-w-lg mx-auto px-3 py-4 space-y-4 pb-36" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>

      <OrdersHeader onClear={() => {
        // Device-local only. The visible list is the account's history and is
        // deliberately left alone -- see OrdersHeader.
        clearTrackingTokens();
        setClearToast('Cleared guest orders saved on this device. Your account orders are unchanged.');
        setTimeout(() => setClearToast(''), 4000);
      }} />

      {/* Reorder toast */}
      {reorderToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg">
          🛒 {reorderToast}
        </div>
      )}

      {clearToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg max-w-[90vw] text-center">
          {clearToast}
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
            {activeOrders.map(order => (
              <ActiveOrderCard key={order.id} order={order} whatsappNumber={whatsappNumber}
                fallbackName={customerName} fallbackPhone={customerPhone}
                canCancel={['pending', 'confirmed'].includes(order.status)}
                confirmCancel={confirmCancel} cancelling={cancelling}
                cancelError={cancelError}
                onCancel={handleCancel}
                onRequestCancel={(o) => { setCancelError(''); setConfirmCancel(o.id); }}
                onDismissConfirm={() => setConfirmCancel(null)} />
            ))}

            {/* Delivered orders — same style as past cards */}
            {deliveredOrders.map(order => (
              <DeliveredOrderCard key={order.id} order={order}
                onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />
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
) : filteredPast.map(order => (
            <ClosedOrderCard key={order.id} order={order}
              onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />
          ))}
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
