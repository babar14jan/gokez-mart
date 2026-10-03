import {
  AlertCircle, Bike, CheckCircle, ChefHat, MapPin, MessageCircle,
  Phone, RotateCcw, ShoppingCart, X, type LucideIcon,
  XCircle,
} from 'lucide-react';

/**
 * Shared order cards.
 *
 * These are used by BOTH the signed-in view and the guest (tracking-token) view.
 * They used to be two hand-rolled copies that drifted: the guest card silently
 * lost the delivery-partner block, then the Cancel and Need Help actions, so the
 * two audiences saw visibly different order screens. One component means a card
 * can only exist once.
 *
 * Everything session-specific arrives as a prop. The cards never read auth state
 * directly, so a guest card is not a stripped-down copy.
 */

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
const STEP_LABELS = ['Order Placed', 'Being Prepared', 'On the Way', 'Delivered'];
const STEP_ICONS: Record<string, LucideIcon> = {
  pending: ShoppingCart,
  preparing: ChefHat,
  out_for_delivery: Bike,
  delivered: CheckCircle,
};

const STATUS_TO_STEP: Record<string, string> = {
  pending: 'pending',
  confirmed: 'pending',
  preparing: 'preparing',
  ready_to_pickup: 'preparing',
  out_for_delivery: 'out_for_delivery',
  picked_up: 'out_for_delivery',
  delivered: 'delivered',
};

export const STATUS_LABELS: Record<string, string> = {
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
  duplicate_order: 'Cancelled — this appeared to be a duplicate order.',
  out_of_stock: 'Sorry — some items became unavailable. You will not be charged.',
  store_closed: 'Sorry — the store had to close unexpectedly. You will not be charged.',
  other: 'Your order was cancelled. You will not be charged.',
};

const STATUS_ICONS: Record<string, LucideIcon> = {
  delivered: CheckCircle,
  cancelled: XCircle,
  failed_delivery: AlertCircle,
  terminated: XCircle,
};

export const CLOSED = ['cancelled', 'failed_delivery', 'terminated'];
export const DELIVERED = ['delivered'];
export const ALL_CLOSED = [...CLOSED, ...DELIVERED];

// Only show delivered in the active list if it happened within the last 30 mins.
export function isRecentlyDelivered(order: any): boolean {
  if (order.status !== 'delivered') return false;
  const updated = new Date(order.updatedAt || order.createdAt).getTime();
  return Date.now() - updated < 30 * 60 * 1000;
}

export function hasActiveOrder(orders: any[]) {
  return orders.some(o => !ALL_CLOSED.includes(o.status));
}

export function formatDateTime(dateStr: string) {
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

type SharedCardProps = {
  order: any;
  // Nullable: callers read these straight out of stores that model "absent"
  // as null rather than undefined.
  whatsappNumber?: string | null;
  fallbackName?: string | null;
  fallbackPhone?: string | null;
};

// ── Active order card: status banner + step tracker + actions ─────────────────
export function ActiveOrderCard({
  order, whatsappNumber, fallbackName, fallbackPhone,
  canCancel, confirmCancel, cancelling, cancelError,
  onCancel, onRequestCancel, onDismissConfirm,
}: SharedCardProps & {
  canCancel: boolean;
  confirmCancel: string | null;
  cancelling: string | null;
  cancelError?: string;
  onCancel: (order: any) => void;
  onRequestCancel: (order: any) => void;
  onDismissConfirm: () => void;
}) {
  const curStep = STEPS.indexOf(STATUS_TO_STEP[order.status] || order.status);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-md border border-emerald-100 dark:border-emerald-900">
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
                {i <= curStep ? (() => {
                  const StepIcon = STEP_ICONS[step];
                  return <StepIcon className={`w-4 h-4 text-emerald-600 dark:text-emerald-400 ${i === curStep ? 'animate-bounce' : ''}`} />;
                })() : <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-600 block" />}
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

      {/* Cancel + Need Help */}
      {(canCancel || whatsappNumber || cancelError) && (
        <div className="px-4 pb-4 flex items-center justify-between gap-3">
          {whatsappNumber ? (() => {
            const name = order.guestName || fallbackName || 'Customer';
            const phone = order.guestPhone || fallbackPhone || 'Not provided';
            const message = `Need help regarding Order #${order.orderNumber} placed at ${formatDateTime(order.createdAt)}. Customer: ${name}. Phone: ${phone}.`;
            return (
              <a
                href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Need Help
              </a>
            );
          })() : <span />}
          {canCancel && (
            <div className={whatsappNumber ? 'ml-auto' : ''}>
            {confirmCancel === order.id ? (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-2xl px-3 py-2.5">
                <p className="text-xs text-red-600 flex-1">Cancel this order?</p>
                <button onClick={() => onCancel(order)} disabled={cancelling === order.id}
                  className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  {cancelling === order.id ? '...' : 'Yes'}
                </button>
                <button onClick={onDismissConfirm}
                  className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-600 text-xs font-semibold rounded-xl">No</button>
              </div>
            ) : (
              <button onClick={() => onRequestCancel(order)}
                className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-500 transition-colors">
                <X className="w-3.5 h-3.5" /> Cancel Order
              </button>
            )}
            </div>
          )}
          {cancelError && (
            <p className="w-full text-[11px] leading-snug text-red-600 dark:text-red-400">{cancelError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Delivered card ────────────────────────────────────────────────────────────
export function DeliveredOrderCard({ order, onViewDetails, onOrderAgain }: SharedCardProps & {
  onViewDetails: (order: any) => void;
  onOrderAgain: (order: any) => void;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-emerald-200 dark:border-emerald-800 overflow-hidden shadow-sm">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-bold text-gray-900 dark:text-white">Order Delivered!</p>
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
        <button onClick={() => onViewDetails(order)}
          className="flex-1 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
          View Details
        </button>
        <div className="w-px bg-gray-100 dark:bg-slate-700" />
        <button onClick={() => onOrderAgain(order)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Order Again
        </button>
      </div>
    </div>
  );
}

// ── Closed / past card ────────────────────────────────────────────────────────
export function ClosedOrderCard({ order, onViewDetails, onOrderAgain }: SharedCardProps & {
  onViewDetails: (order: any) => void;
  onOrderAgain: (order: any) => void;
}) {
  const StatusIcon = STATUS_ICONS[order.status] || XCircle;
  const termMsg = order.terminationReason ? TERMINATION_MESSAGES[order.terminationReason] : null;
  const cancelMsg = order.cancellationReason ? CANCELLATION_MESSAGES[order.cancellationReason] : null;

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm ${
      termMsg ? 'border-amber-200 dark:border-amber-800' : 'border-gray-100 dark:border-slate-700'
    }`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <StatusIcon className={`w-4 h-4 ${
                order.status === 'failed_delivery' ? 'text-amber-500' : 'text-red-500'
              }`} />
              <p className="text-sm font-bold text-gray-900 dark:text-white">{STATUS_LABELS[order.status]}</p>
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

        <ItemThumbnails items={order.items || []} />
      </div>

      <div className="flex border-t border-gray-100 dark:border-slate-700">
        <button onClick={() => onViewDetails(order)}
          className="flex-1 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
          View Details
        </button>
        <div className="w-px bg-gray-100 dark:border-slate-700" />
        <button onClick={() => onOrderAgain(order)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Order Again
        </button>
      </div>
    </div>
  );
}
