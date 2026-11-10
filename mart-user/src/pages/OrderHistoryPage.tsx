import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingBag, RefreshCw, X, MapPin, RotateCcw, IndianRupee, User, MessageCircle, WifiOff, CalendarClock } from 'lucide-react';
import { authApi, storeApi } from '../services/api';
import { requestErrorMessage } from '../utils/networkError';
import { readTrackingTokens } from '../utils/guestTracking';
import { useLoginFlowStore } from '../store/loginFlowStore';
import { useCartStore } from '../store/cartStore';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { printReceipt } from '../utils/printReceipt';
import { buildWhatsAppLink } from '../utils/whatsapp';
import { useKeyboardDismiss } from '../utils/useKeyboardDismiss';

import {
  ActiveOrderCard, ClosedOrderCard, DeliveredOrderCard,
} from '../components/OrderCards';
import { ALL_CLOSED, STATUS_LABELS, isRecentlyDelivered, hasActiveOrder, formatDateTime } from '../utils/orderStatus';
import PageHeader from '../components/PageHeader';
import SmartImage from '../components/SmartImage';

// Customer-facing cancel reasons, matching CUSTOMER_CANCEL_REASONS on the
// server. The value is what is stored; the label is what the customer reads.
const CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: 'ordered_by_mistake', label: 'Ordered by mistake' },
  { value: 'changed_my_mind', label: 'Changed my mind' },
  { value: 'wrong_address', label: 'Wrong address or delivery details' },
  { value: 'duplicate_order', label: 'Duplicate order' },
  { value: 'found_better_price', label: 'Found a better price elsewhere' },
  { value: 'delivery_too_slow', label: 'Delivery is taking too long' },
  { value: 'other', label: 'Other' },
];

function OrderDetailSheet({
  order, onClose, onOrderAgain, nextOpenLabel, whatsappNumber, fallbackName, fallbackPhone,
  canCancel, confirmCancel, cancelling, cancelError, onCancel, onRequestCancel, onDismissConfirm,
}: {
  order: any;
  onClose: () => void;
  onOrderAgain: (order: any) => void;
  nextOpenLabel?: string | null;
  whatsappNumber?: string;
  fallbackName?: string | null;
  fallbackPhone?: string | null;
  canCancel: boolean;
  confirmCancel: string | null;
  cancelling: string | null;
  cancelError: string;
  onCancel: (order: any, reason: string) => void;
  onRequestCancel: (order: any) => void;
  onDismissConfirm: () => void;
}) {
  const nextOpenWhen = nextOpenLabel || order.scheduledForLabel || null;
  const cancellationPolicy = order.cancellationPolicy;
  const canRequestCancellation = order.status === 'preparing' && !order.cancellationRequestedAt;
  const isCancellationRequest = order.status === 'preparing';
  const showOrderSupport = !ALL_CLOSED.includes(order.status) && (cancellationPolicy || whatsappNumber || cancelError);
  // Require an explicit reason before the destructive confirm is reachable; this
  // is what stops a stray tap from cancelling an order.
  const [cancelReason, setCancelReason] = useState('');
  const adjustmentUpdates = (Object.values((order.adjustments || []).reduce((groups: Record<string, {
    createdAt: string;
    reason: string | null;
    changes: string[];
  }>, adjustment: any) => {
    const key = `${adjustment.createdAt || ''}:${adjustment.reason || ''}`;
    const group = groups[key] || {
      createdAt: adjustment.createdAt || '',
      reason: adjustment.reason || null,
      changes: [],
    };
    const quantity = Number(adjustment.deliveredQuantity) || 0;
    const removedQuantity = Number(adjustment.removedQuantity) || 0;
    if (Number(adjustment.previousQuantity) === 0) {
      group.changes.push(`Added ${adjustment.productName} · ${adjustment.unit} × ${quantity}`);
    } else if (removedQuantity > 0) {
      group.changes.push(`Removed ${adjustment.productName} · ${adjustment.unit} × ${removedQuantity}`);
    } else {
      group.changes.push(`Updated ${adjustment.productName}`);
    }
    groups[key] = group;
    return groups;
  }, {})) as Array<{ createdAt: string; reason: string | null; changes: string[] }>).sort(
    (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
  );

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Portaled to <body> (like AddressSheet) so the app's scroll container and
  // header cannot push it down — otherwise the page behind shows above the sheet.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-50 dark:bg-slate-900">
      <div className="page-shell bg-gray-50 dark:bg-slate-900">
        <PageHeader title="Order details" onBack={onClose} />

        <div className="mx-auto max-w-lg space-y-4 px-4 py-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {order.fulfilledBy ? (
                  <>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Fulfilled by</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{order.fulfilledBy}</p>
                    {order.storeAddress && (
                      <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-slate-400">{order.storeAddress}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs font-bold text-gray-900 dark:text-white">Order #{order.orderNumber}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold text-gray-900 dark:text-white">Order #{order.orderNumber}</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{formatDateTime(order.createdAt)}</p>
                <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${
                  order.status === 'delivered' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                }`}>{STATUS_LABELS[order.status]}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm dark:bg-slate-800">
          {/* Items */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Items Ordered</p>
            <div className="space-y-3">
              {(order.items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
                      <SmartImage
                        src={item.smallUrl || item.thumbnailUrl || item.photoUrl}
                        alt={item.productName}
                        className="h-full w-full"
                        imgClassName="object-cover"
                        fallback={<div className="w-full h-full flex items-center justify-center text-lg">🥦</div>}
                      />
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
            {(() => {
              const itemSavings = Number(order.itemSavings) || 0;
              const freeDeliverySaving = Number(order.freeDeliverySaving) || 0;
              const campaignDiscount = Number(order.campaignDiscount) || 0;
              const hasCampaign = Boolean(order.campaignId || order.couponCodeUsed);
              const totalSavings = itemSavings + freeDeliverySaving + campaignDiscount;
              return (
                <>
                  {totalSavings > 0 && (
                    <div className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-2 text-amber-950 shadow-sm">
                      <span className="text-sm" aria-hidden="true">🎉</span>
                      <span className="text-sm font-extrabold">You saved ₹{totalSavings.toFixed(0)}</span>
                      <span className="text-xs font-semibold text-amber-900/80">on this order</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-slate-400">
                    <span>Item total</span>
                    <span className="flex items-center gap-1.5">
                      {itemSavings > 0 && (
                        <span className="text-xs font-medium text-gray-400 line-through dark:text-slate-500">₹{(Number(order.subtotal) + itemSavings).toFixed(0)}</span>
                      )}
                      <span className="font-medium text-gray-900 dark:text-white">₹{order.subtotal}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-slate-400">
                    <span>Delivery</span>
                    <span className="flex items-center gap-1.5">
                      {freeDeliverySaving > 0 && (
                        <span className="text-xs font-medium text-gray-400 line-through dark:text-slate-500">₹{freeDeliverySaving.toFixed(0)}</span>
                      )}
                      <span>{order.deliveryCharge === 0 ? <span className="text-emerald-600 font-semibold">FREE</span> : `₹${order.deliveryCharge}`}</span>
                    </span>
                  </div>
                  {hasCampaign && (
                    <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                      <span>{order.campaignRequiresScheduledDelivery ? 'Scheduled delivery discount' : order.couponCodeUsed ? `Code: ${order.couponCodeUsed}` : 'Offer applied'}</span>
                      {campaignDiscount > 0 && <span className="font-semibold">-₹{order.campaignDiscount}</span>}
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white pt-2 border-t border-gray-200 dark:border-slate-600">
                    <span>Total Paid</span><span>₹{order.total}</span>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Scheduled delivery window chosen by the customer */}
          {order.deliveryPreference === 'scheduled' && order.scheduledForLabel && (
            <div className="bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-900/60 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-violet-900 dark:text-violet-200">Scheduled delivery</p>
                  <p className="text-xs text-violet-700 dark:text-violet-300 mt-1">
                    {order.status === 'delivered' ? 'Delivered on' : 'Arriving'} {order.scheduledForLabel}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Closed store indicator — plain text, no card chrome, so it does not
              compete with the primary order information. */}
          {order.placedOutsideHours && (
            <div className="flex items-start gap-2">
              <span className="text-amber-600 dark:text-amber-400">🕘</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {order.closedReason === 'manual' ? 'Store was manually closed' : 'Ordered outside store hours'}
                </p>
                {!order.confirmedNextOpen && (nextOpenWhen || order.scheduledForLabel) && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                    Will be prepared at {nextOpenWhen || order.scheduledForLabel}
                  </p>
                )}
                {order.confirmedNextOpen && (order.status === 'pending' || order.status === 'confirmed') && (
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 mt-0.5">
                    ✅ Confirmed — we'll start preparing when the store opens{nextOpenWhen ? ` at ${nextOpenWhen}` : ' next'}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Address */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-0.5">Delivered to</p>
              <div className="flex items-center justify-between gap-2">
                {(order.guestName || fallbackName) && (
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{order.guestName || fallbackName}</p>
                )}
                {(order.guestPhone || fallbackPhone) && (
                  <p className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{order.guestPhone || fallbackPhone}</p>
                )}
              </div>
              <p className="text-sm text-gray-700 dark:text-slate-300 mt-0.5">{order.guestAddress}</p>
            </div>
          </div>

          {adjustmentUpdates.length > 0 && (
            <div className="border-t border-gray-100 pt-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">Order updates</p>
              <div className="space-y-2">
                {adjustmentUpdates.map((update, index) => (
                  <div key={`${update.createdAt}-${index}`} className="text-xs leading-snug text-gray-700 dark:text-slate-300">
                    {update.changes.map((change, changeIndex) => (
                      <p key={changeIndex} className="font-medium text-gray-900 dark:text-white">{change}</p>
                    ))}
                    {update.reason && <p className="mt-0.5 text-gray-500 dark:text-slate-400">Reason: {update.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment + Receipt — compact single section */}
          <div className="border-t border-gray-100 dark:border-slate-700 pt-3 space-y-2">
            {order.status === 'delivered' && order.paymentCollectedAt && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-slate-400">Payment</p>
                <p className="text-xs font-semibold text-gray-900 dark:text-white uppercase">{order.paymentMethod === 'cod' ? 'Cash' : order.paymentMethod}</p>
              </div>
            )}
          </div>

          {showOrderSupport && (
            <div className="border-t border-gray-100 pt-4 dark:border-slate-700">
              <div className="space-y-2">
                {(whatsappNumber || ((canCancel || canRequestCancellation) && confirmCancel !== order.id)) && (
                  <div className="flex items-center gap-2">
                {whatsappNumber && (() => {
                  const name = order.guestName || fallbackName || 'Customer';
                  const phone = order.guestPhone || fallbackPhone || 'Not provided';
                  const message = `Need help regarding Order #${order.orderNumber} placed at ${formatDateTime(order.createdAt)}. Customer: ${name}. Phone: ${phone}.`;
                  return (
                    <a
                      href={buildWhatsAppLink(whatsappNumber, message)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Need help
                    </a>
                  );
                })()}
                {canCancel && confirmCancel !== order.id && (
                  <button type="button" onClick={() => { setCancelReason(''); onRequestCancel(order); }}
                    className="shrink-0 px-2 py-2 text-xs font-semibold text-red-500 transition-colors hover:text-red-600">
                    Cancel order
                  </button>
                )}
                {canRequestCancellation && confirmCancel !== order.id && (
                  <button type="button" onClick={() => { setCancelReason(''); onRequestCancel(order); }}
                    className="shrink-0 px-2 py-2 text-xs font-semibold text-red-500 transition-colors hover:text-red-600">
                    Request cancellation
                  </button>
                )}
                  </div>
                )}
                {(canCancel || canRequestCancellation) && confirmCancel === order.id && (
                  <div className="rounded-xl bg-red-50 px-3 py-3 dark:bg-red-950/30">
                    <p className="mb-1 text-xs font-medium text-red-700 dark:text-red-300">
                      {isCancellationRequest ? 'The store will review this request before cancelling the order.' : order.status === 'confirmed' ? 'This order is confirmed, but preparation has not started yet.' : 'This order has not started preparation yet.'}
                    </p>
                    <p className="mb-2 text-xs font-medium text-red-700 dark:text-red-300">Why are you {isCancellationRequest ? 'requesting cancellation' : 'cancelling this order'}?</p>
                    <div className="mb-3 space-y-1.5">
                      {CANCEL_REASONS.filter(reason => reason.value !== 'delivery_too_slow' || cancellationPolicy?.canReportDelay).map(reason => (
                        <label key={reason.value}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                            cancelReason === reason.value
                              ? 'border-red-400 bg-white text-red-800 dark:border-red-500 dark:bg-slate-800 dark:text-red-200'
                              : 'border-transparent bg-white/60 text-gray-700 dark:bg-slate-800/60 dark:text-slate-300'
                          }`}>
                          <input type="radio" name={`cancel-reason-${order.id}`} value={reason.value}
                            checked={cancelReason === reason.value}
                            onChange={() => setCancelReason(reason.value)}
                            className="h-3.5 w-3.5 accent-red-600" />
                          {reason.label}
                        </label>
                      ))}
                    </div>
                    {cancelReason === 'wrong_address' && cancellationPolicy?.canEditAddress && (
                      <p className="mb-3 text-xs leading-snug text-gray-600 dark:text-slate-300">Support can help correct delivery details before preparation begins.</p>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onCancel(order, cancelReason)}
                        disabled={!cancelReason || cancelling === order.id}
                        className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                        {cancelling === order.id ? (isCancellationRequest ? 'Requesting...' : 'Cancelling...') : (isCancellationRequest ? 'Request cancellation' : 'Cancel order')}
                      </button>
                      <button type="button" onClick={() => { setCancelReason(''); onDismissConfirm(); }}
                        className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm dark:bg-slate-700 dark:text-slate-200">
                        Keep order
                      </button>
                    </div>
                  </div>
                )}
                {order.cancellationRequestedAt && confirmCancel !== order.id && (
                  <p className={`text-center text-[11px] leading-snug ${
                    order.cancellationRequestDecision === 'declined'
                      ? 'text-gray-600 dark:text-slate-300'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}>
                    {order.cancellationRequestDecision === 'declined'
                      ? 'The store cannot cancel this order because preparation is already underway.'
                      : 'Cancellation requested. The store will review it before dispatch.'}
                  </p>
                )}
                {cancelError && <p className="text-center text-[11px] leading-snug text-red-600 dark:text-red-400">{cancelError}</p>}
              </div>
            </div>
          )}

          {order.status === 'delivered' ? (
            <div className="mx-auto mt-3 grid w-full max-w-xs grid-cols-2 gap-3">
              <button type="button" onClick={() => printReceipt(order)}
                className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white transition-colors hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600">
                <IndianRupee className="h-3.5 w-3.5" /> View receipt
              </button>
              <button type="button" onClick={() => { onOrderAgain(order); onClose(); }}
                className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#15803d] px-3 text-xs font-bold text-white transition-colors hover:bg-[#166534]">
                <RotateCcw className="h-3.5 w-3.5" /> Order again
              </button>
            </div>
          ) : ALL_CLOSED.includes(order.status) && (
            <button onClick={() => { onOrderAgain(order); onClose(); }}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all">
              <RotateCcw className="w-4 h-4" /> Order Again
            </button>
          )}
        </div>
      </div>
    </div>
    </div>,
    document.body
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
interface Props { onBack?: () => void; whatsappNumber?: string; nextOpenLabel?: string | null; }

export default function OrderHistoryPage({ onBack: _onBack, whatsappNumber, nextOpenLabel }: Props) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [reorderToast, setReorderToast] = useState('');
  const [activeTab, setActiveTab] = useState<'current' | 'past'>('current');
  // Live store opening label ("9:00 AM today") when the app has one; falls
  // back to the opening time captured with the order when the store state
  // hasn't been fetched yet e.g. right after a fresh page load.
  const nextOpenWhen = nextOpenLabel || null;
  const [pastSearch, setPastSearch] = useState('');
  const [pastFilter, setPastFilter] = useState<'all' | 'delivered' | 'cancelled'>('all');
  const [guestLoading, setGuestLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const { addItem } = useCartStore();
  const { name: customerName, phone: customerPhone, isLoggedIn } = useCustomerAuthStore();
  const { ref: searchInputRef, onKeyDown: handleSearchKeyDown, onSurfaceClick: handleSearchSurfaceClick } = useKeyboardDismiss();

  // Silent mode must bypass the HTTP cache: order status changes on the server
  // (hub actions, delivery updates) with no write from this client, so a cached
  // response would freeze the 10s poll on a stale status. Manual loads and the
  // first mount stay cached so revisiting the page paints instantly.
  //
  // A failed load is remembered instead of being swallowed: without this the
  // page showed "No orders yet" after a network failure — which is simply
  // false, and stayed false after the connection came back because nothing
  // refetched. Silent poll failures never touch loadError (the list on screen
  // is still the truth as of the last successful load).
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchOrders = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await authApi.getOrders({ fresh: silent });
      const currentOrders = r.data.data || [];
      setOrders(currentOrders);
      setSelectedOrder((current: any | null) => currentOrders.find((order: any) => order.id === current?.id) || current);
      setLoadError(null);
      return currentOrders;
    } catch (e: any) {
      if (!silent) setLoadError(requestErrorMessage(e, 'We could not load your orders. Please try again.'));
    } finally { setRefreshing(false); setLoading(false); }
  };

  // Guests have no session, so authApi.getOrders() can only ever 401 here.
  const fetchGuestOrders = async (silent = false) => {
    if (!silent) setGuestLoading(true);
    try {
      const tokens = readTrackingTokens();
      if (!tokens.length) { setOrders([]); setLoadError(null); return []; }
      const r = await storeApi.trackOrdersByTokens(tokens, { fresh: silent });
      const currentOrders = r.data.data || [];
      setOrders(currentOrders);
      setSelectedOrder((current: any | null) => currentOrders.find((order: any) => order.id === current?.id) || current);
      setLoadError(null);
      return currentOrders;
    } catch (e: any) {
      // A token can be pruned server-side (a real 4xx) — keep whatever we have
      // rather than blaming the network. Only a genuine load failure with
      // nothing to show earns the error state.
      if (!silent && orders.length === 0) {
        setLoadError(requestErrorMessage(e, 'We could not load your orders. Please try again.'));
      }
    }
    finally { if (!silent) setGuestLoading(false); setLoading(false); }
  };

  const [cancelError, setCancelError] = useState('');

  /**
   * Guests cancel against their tracking token, signed-in customers against
   * their session. Refreshing must follow the same split: calling fetchOrders()
   * for a guest hits a guaranteed 401 and would leave the card showing a stale
   * status after a successful cancel.
   */
  const handleCancel = async (order: any, reason: string) => {
    setCancelling(order.id);
    setCancelError('');
    try {
      if (isLoggedIn) {
        if (order.status === 'preparing') await authApi.requestCancellation(order.id, reason);
        else await authApi.cancelOrder(order.id, reason);
        await fetchOrders(true);
      } else {
        if (order.status === 'preparing') await storeApi.requestCancellationByToken(order.id, order.trackingToken, reason);
        else await storeApi.cancelOrderByToken(order.id, order.trackingToken, reason);
        await fetchGuestOrders(true);
      }
      if (order.status !== 'preparing') setSelectedOrder(null);
    } catch (err: any) {
      const msg = err?.response?.data?.error;
      let canRequestLatestCancellation = false;
      if (err?.response?.status === 400) {
        const currentOrders = isLoggedIn
          ? await fetchOrders(true)
          : await fetchGuestOrders(true);
        const currentOrder = currentOrders?.find((entry: any) => entry.id === order.id);
        if (currentOrder) {
          setSelectedOrder(currentOrder);
          canRequestLatestCancellation = currentOrder.status === 'preparing' && !currentOrder.cancellationRequestedAt;
        }
      }
      setCancelError(canRequestLatestCancellation
        ? 'Preparation has started. You can request cancellation and the store will review it before dispatch.'
        : msg && !msg.includes('Something went wrong')
          ? msg
        : order.status === 'preparing'
          ? 'Could not request cancellation. Please contact the store for help.'
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
        description: null, weightOptions: null, localName: null, searchAliases: [],
        approxWeight: null, isBundle: false,
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

  // Come back online → retry a failed load automatically, so the honest error
  // state replaces itself the moment the connection returns instead of waiting
  // for the customer to notice the button.
  useEffect(() => {
    const onOnline = () => {
      if (!loadError) return;
      if (isLoggedIn) fetchOrders(true);
      else fetchGuestOrders(true);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, loadError]);

  // Live updates for both audiences, but only while something is actually open.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasLive = orders.some(o => !ALL_CLOSED.includes(o.status));
    if (hasLive) {
      const refreshLiveOrders = () => {
        if (isLoggedIn) fetchOrders(true);
        else fetchGuestOrders(true);
      };
      pollRef.current = setInterval(() => {
        refreshLiveOrders();
      }, isLoggedIn ? 3000 : 5000);
      const refreshOnReturn = () => {
        if (document.visibilityState === 'visible') refreshLiveOrders();
      };
      window.addEventListener('focus', refreshOnReturn);
      document.addEventListener('visibilitychange', refreshOnReturn);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        window.removeEventListener('focus', refreshOnReturn);
        document.removeEventListener('visibilitychange', refreshOnReturn);
      };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, isLoggedIn]);

  const activeOrders = orders.filter(o => !ALL_CLOSED.includes(o.status));
  const deliveredOrders = orders.filter(o => isRecentlyDelivered(o));
  const pastOrders = orders.filter(o => ALL_CLOSED.includes(o.status) && !isRecentlyDelivered(o));
  const pastDeliveredCount = pastOrders.filter(o => o.status === 'delivered').length;
  const pastCancelledCount = pastOrders.filter(o => ['cancelled', 'failed_delivery', 'terminated'].includes(o.status)).length;

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

  // Both tabs stay selectable even when one is empty. A customer may still want
  // to verify there is no current order before looking through older orders.
  const showTab = activeTab;

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

  // The load itself failed and there is nothing on screen to fall back on.
  // Saying "no orders" here would be a lie; say what happened and offer a way
  // back. Also retried automatically when the connection returns (effect above).
  if (loadError && orders.length === 0) return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
        <WifiOff className="h-9 w-9 text-gray-300 dark:text-slate-500" />
      </div>
      <h2 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">Couldn&apos;t load your orders</h2>
      <p className="mx-auto mb-7 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-slate-400">{loadError}</p>
      <button
        onClick={() => { setLoadError(null); setLoading(true); if (isLoggedIn) fetchOrders(); else fetchGuestOrders(); }}
        className="flex min-h-12 mx-auto items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
      >
        <RefreshCw className="h-4 w-4" /> Try Again
      </button>
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

    if (!hasLocalTokens || orders.length === 0) {
      return (
        <div className="mx-auto max-w-lg px-5 py-16 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
            <ShoppingBag className="h-9 w-9 text-gray-300 dark:text-slate-500" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">Your orders will appear here</h2>
          <p className="mx-auto mb-7 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-slate-400">
            Log in to view your order history, or continue shopping as a guest.
          </p>
          <button
            onClick={() => { useLoginFlowStore.getState().setPostLoginPath('/orders'); useLoginFlowStore.getState().setGuestReturnPath('/orders'); window.history.pushState({}, '', '/account'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="mb-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            <User className="h-4 w-4" /> Log in
          </button>
          <button
            onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Continue Shopping
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1 rounded-2xl bg-gray-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setActiveTab('current')}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all ${showTab === 'current' ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-slate-400'}`}>
            Current
          </button>
          <button type="button" onClick={() => setActiveTab('past')}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all ${showTab === 'past' ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-gray-500 dark:text-slate-400'}`}>
            History
          </button>
        </div>

        {/* Same three cards the signed-in view uses. The only guest-specific
            input is canCancel: cancelling needs the order's tracking token, and
            an order whose token is missing cannot be proven to belong to this
            device, so no button is offered rather than one that would 404. */}
        {showTab === 'current' && (activeOrders.length === 0 && deliveredOrders.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-4xl">✅</div>
            <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">No active orders</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Looking for an older order? Check History.</p>
            <button type="button" onClick={() => setActiveTab('past')}
              className="mt-3 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
              View History
            </button>
          </div>
        ) : <>
          {activeOrders.map(order => <ActiveOrderCard key={order.id} order={order} whatsappNumber={whatsappNumber}
            nextOpenLabel={nextOpenWhen} onViewDetails={setSelectedOrder} />)}
          {deliveredOrders.map(order => <DeliveredOrderCard key={order.id} order={order}
            onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />)}
        </>)}

        {showTab === 'past' && (pastOrders.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-4xl">📦</div>
            <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">No past orders</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Completed orders will appear here.</p>
          </div>
        ) : pastOrders.map(order => <ClosedOrderCard key={order.id} order={order}
          onViewDetails={setSelectedOrder} onOrderAgain={handleOrderAgain} />))}

        {/* Detail sheet for guests too — "View Details" has to open something. */}
        {selectedOrder && (
          <OrderDetailSheet order={selectedOrder} onClose={() => setSelectedOrder(null)}
            onOrderAgain={handleOrderAgain} nextOpenLabel={nextOpenWhen}
            whatsappNumber={whatsappNumber}
            canCancel={['pending', 'confirmed'].includes(selectedOrder.status) && typeof selectedOrder.trackingToken === 'string' && selectedOrder.trackingToken.length > 0}
            confirmCancel={confirmCancel} cancelling={cancelling} cancelError={cancelError}
            onCancel={handleCancel}
            onRequestCancel={(order) => { setCancelError(''); setConfirmCancel(order.id); }}
            onDismissConfirm={() => setConfirmCancel(null)} />
        )}
        <div className="text-center">
          <button
            onClick={() => { useLoginFlowStore.getState().setPostLoginPath('/orders'); useLoginFlowStore.getState().setGuestReturnPath('/orders'); window.history.pushState({}, '', '/account'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            Log in to see all orders →
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
            Use the same mobile number to retrieve your complete order history, including orders from other devices.
          </p>
        </div>
      </div>
    );
  }

  if (orders.length === 0) return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
        <ShoppingBag className="h-9 w-9 text-gray-300 dark:text-slate-500" />
      </div>
      <p className="mb-2 text-lg font-bold text-gray-900 dark:text-white">Your order history is ready</p>
      <p className="mb-7 max-w-xs text-sm leading-relaxed text-gray-500 dark:text-slate-400">Place your first order and its updates, receipt, and delivery status will appear here.</p>
      <button onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700">
        <ShoppingBag className="h-4 w-4" /> Continue shopping
      </button>
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-3 py-4 space-y-4" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onClick={handleSearchSurfaceClick}>

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
        </button>
        <button
          onClick={() => setActiveTab('past')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all ${
            showTab === 'past'
              ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-slate-400'
          }`}>
          History
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
        <div className="space-y-2" onClick={handleSearchSurfaceClick}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
            <input
              ref={searchInputRef}
              type="text" value={pastSearch}
              onChange={e => setPastSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              inputMode="search" enterKeyHint="search"
              placeholder="Search by order number"
              className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm border-0" />
            {pastSearch && (
              <button onClick={() => setPastSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {(['all', 'delivered', 'cancelled'] as const).map(f => {
              const count = f === 'all' ? pastOrders.length : f === 'delivered' ? pastDeliveredCount : pastCancelledCount;
              return (
                <button key={f} onClick={() => setPastFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    pastFilter === f
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 shadow-sm'
                  }`}>
                  {f === 'all' ? 'All' : f === 'delivered' ? 'Delivered' : 'Cancelled'} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Current tab: Active orders ── */}
      {showTab === 'current' && (
        activeOrders.length === 0 && deliveredOrders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No active orders</p>
            <p className="text-xs text-gray-500">Looking for an older order? Check History.</p>
            <button type="button" onClick={() => setActiveTab('past')}
              className="mt-3 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
              View History
            </button>
          </div>
        ) : (
          <>
            {activeOrders.map(order => (
              <ActiveOrderCard key={order.id} order={order} whatsappNumber={whatsappNumber}
                nextOpenLabel={nextOpenWhen}
                fallbackName={customerName} fallbackPhone={customerPhone}
                onViewDetails={setSelectedOrder} />
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
          nextOpenLabel={nextOpenWhen}
          whatsappNumber={whatsappNumber}
          fallbackName={customerName}
          fallbackPhone={customerPhone}
          canCancel={['pending', 'confirmed'].includes(selectedOrder.status)}
          confirmCancel={confirmCancel}
          cancelling={cancelling}
          cancelError={cancelError}
          onCancel={handleCancel}
          onRequestCancel={(order) => { setCancelError(''); setConfirmCancel(order.id); }}
          onDismissConfirm={() => setConfirmCancel(null)}
        />
      )}
    </div>
  );
}
