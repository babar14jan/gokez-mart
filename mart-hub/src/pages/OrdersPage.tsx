import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ClipboardList, Calendar, CalendarClock, ChevronDown, Phone, MapPin,
  Navigation, Package, XCircle, CheckSquare, Square,
  Truck, Clock, IndianRupee, Search, X,
} from 'lucide-react';
import { ordersApi, teamApi } from '../services/api';
import { printReceipt } from '../utils/printReceipt';
import { orderDisplayName } from '../utils/orderName';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';
import { onOrderEvent, onOrderStreamConnect } from '../services/realtime';
import PaymentConfirmDialog from '../components/PaymentConfirmDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import SmartImage from '../components/SmartImage';
import PageSkeleton from '../components/PageSkeleton';

type DateRange = 'today' | 'week' | 'month' | 'custom' | 'all';
type StatusFilter = '' | 'pending' | 'confirmed' | 'preparing' | 'ready_to_pickup' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'failed_delivery' | 'terminated';

const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const toStoreDateTimeLocal = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const storeDateTimeToIso = (value: string) => {
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Order pipeline — used for progress bar
const PIPELINE = [
  { status: 'pending',          label: 'Pending',          emoji: '🛒' },
  { status: 'confirmed',        label: 'Confirmed',        emoji: '✅' },
  { status: 'preparing',        label: 'Preparing',        emoji: '🍳' },
  { status: 'out_for_delivery', label: 'Out for Delivery', emoji: '🛵' },
  { status: 'delivered',        label: 'Delivered',        emoji: '🎉' },
];

const TERMINAL = ['delivered', 'cancelled', 'failed_delivery', 'terminated'];

const STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  confirmed:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  preparing:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  out_for_delivery: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  ready_to_pickup:  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  picked_up:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  delivered:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:        'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  failed_delivery:  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  terminated:       'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery', ready_to_pickup: 'Ready to Pickup',
  picked_up: 'Picked Up', delivered: 'Delivered',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Terminated',
};

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe' };

// Human labels for mart_orders.cancellation_reason. Covers both the customer's
// self-service reasons (CUSTOMER_CANCEL_REASONS on the API) and the reasons
// staff pick when they stop an order, so a cancelled order always explains why.
const CANCELLATION_REASON_LABELS: Record<string, string> = {
  customer_request: 'Customer cancelled',
  ordered_by_mistake: 'Customer: ordered by mistake',
  changed_my_mind: 'Customer: changed their mind',
  wrong_address: 'Customer: wrong address or delivery details',
  found_better_price: 'Customer: found a better price elsewhere',
  delivery_too_slow: 'Customer: delivery taking too long',
  duplicate_order: 'Duplicate order',
  out_of_stock: 'Out of stock',
  store_closed: 'Store closed',
  outside_area: 'Outside delivery area',
  incorrect_address: 'Invalid address',
  rider_unavailable: 'Rider unavailable',
  technical_issue: 'Technical issue',
  other: 'Other',
};

const PAYMENT_COLORS: Record<string, string> = {
  cod: 'text-emerald-600 dark:text-emerald-400',
  upi: 'text-blue-600 dark:text-blue-400',
  phonepay: 'text-violet-600 dark:text-violet-400',
};

const NEXT_ACTION: Record<string, { label: string; status: string; color: string } | null> = {
  pending:          { label: 'Confirm Order',     status: 'confirmed',        color: 'bg-blue-500 hover:bg-blue-600 text-white' },
  confirmed:        { label: 'Start Preparing',   status: 'preparing',        color: 'bg-indigo-500 hover:bg-indigo-600 text-white' },
  preparing:        { label: 'Ready to Pickup',   status: 'ready_to_pickup',  color: 'bg-orange-500 hover:bg-orange-600 text-white' },
  ready_to_pickup:  null,
  out_for_delivery: null,
  picked_up:        null,
  delivered: null, cancelled: null, failed_delivery: null,
};

const STATUS_TABS: { id: StatusFilter; label: string; dot: string }[] = [
  { id: '',                 label: 'All',        dot: 'bg-gray-400' },
  { id: 'pending',          label: 'Pending',    dot: 'bg-amber-500' },
  { id: 'confirmed',        label: 'Confirmed',  dot: 'bg-blue-500' },
  { id: 'preparing',        label: 'Preparing',  dot: 'bg-indigo-500' },
  { id: 'ready_to_pickup',  label: 'Ready',      dot: 'bg-orange-500' },
  { id: 'out_for_delivery', label: 'On the Way', dot: 'bg-violet-500' },
  { id: 'delivered',        label: 'Delivered',  dot: 'bg-emerald-500' },
  { id: 'cancelled',        label: 'Cancelled',  dot: 'bg-red-400' },
  { id: 'failed_delivery',  label: 'Failed',     dot: 'bg-orange-500' },
  { id: 'terminated',       label: 'Terminated', dot: 'bg-gray-400' },
];

const DATE_TABS: { id: DateRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: '7 Days' },
  { id: 'month', label: '30 Days' },
  { id: 'all',   label: 'All' },
  { id: 'custom',label: 'Custom' },
];

const PREF_LABELS: Record<string, string> = {
  within_15: '⚡ Fastest',
  within_30: '🕐 30 mins',
  within_60: '🕑 1 hour',
  scheduled: '📅 Scheduled',
};

function deliveryDuration(order: any): { minutes: number; color: string } | null {
  if (order.status !== 'delivered') return null;
  const deliveredAt = order.deliveredAt || order.statusEvents?.find((event: any) => event.toStatus === 'delivered')?.createdAt;
  const preparationStartedAt = order.statusEvents?.find((event: any) => event.toStatus === 'preparing')?.createdAt;
  const startedAt = order.deliveryPreference === 'scheduled' ? preparationStartedAt : order.createdAt;
  if (!deliveredAt || !startedAt) return null;
  const minutes = Math.max(0, Math.round((new Date(deliveredAt).getTime() - new Date(startedAt).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 15) return { minutes, color: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' };
  if (minutes < 30) return { minutes, color: 'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-400' };
  return { minutes, color: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' };
}

function getJourneyEvents(order: any) {
  const statusEvents = (order.statusEvents || []).map((event: any) => ({ ...event, type: 'status' }));
  const deliveryEvents = (order.deliveryEvents || []).map((event: any) => ({ ...event, type: 'delivery' }));
  return [...statusEvents, ...deliveryEvents]
    .sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
}

const STALE_MINS: Record<string, number> = {
  pending: 15, confirmed: 20, preparing: 30, out_for_delivery: 45,
};

function openGoogleMaps(address: string, latitude?: number | null, longitude?: number | null) {
  const query = latitude != null && longitude != null ? `${latitude},${longitude}` : address;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank');
}

function JourneyButton({ onClick }: { onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">
      View journey
      <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );
}

// Progress bar component
function OrderProgress({ status }: { status: string }) {
  if (TERMINAL.includes(status) && status !== 'delivered') return null;
  // Map statuses not in pipeline to nearest step
  const mapped: Record<string, string> = {
    ready_to_pickup: 'preparing',
    picked_up:       'out_for_delivery',
  };
  const lookupStatus = mapped[status] || status;
  const currentIdx = PIPELINE.findIndex(s => s.status === lookupStatus);
  if (currentIdx === -1) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-50 dark:border-slate-700">
      <div className="flex items-center gap-0">
        {PIPELINE.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          const isLast = idx === PIPELINE.length - 1;
          return (
            <div key={step.status} className="flex items-center flex-1 min-w-0">
              {/* Node */}
              <div className="w-12 flex flex-col items-center flex-shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all ${
                  active ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900 scale-110' :
                  done   ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                           'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                }`}>
                  {done ? '✓' : step.emoji}
                </div>
                <span className={`w-full px-0.5 text-[9px] font-semibold mt-0.5 text-center leading-tight break-words ${
                  active ? 'text-emerald-600 dark:text-emerald-400' :
                  done   ? 'text-gray-500 dark:text-slate-400' :
                           'text-gray-500 dark:text-slate-400'
                }`}>
                  {step.label}
                </span>
              </div>
              {/* Connector line */}
              {!isLast && (
                <div className={`h-0.5 flex-1 mx-0.5 rounded-full transition-all ${
                  done ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-gray-100 dark:bg-slate-700'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const [terminating, setTerminating] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionType, setResolutionType] = useState<'failed_delivery' | 'terminated'>('failed_delivery');
  const [paymentOrder, setPaymentOrder] = useState<any | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  // The range to return to when Custom is clicked a second time (the date
  // range toggles closed instead of staying stuck open).
  const prevDateRangeRef = useRef<DateRange>('today');
  const handleDateRangeClick = (id: DateRange) => {
    if (id !== 'custom') { setDateRange(id); return; }
    if (dateRange === 'custom') { setDateRange(prevDateRangeRef.current); return; }
    prevDateRangeRef.current = dateRange;
    setDateRange('custom');
  };
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveryHandlers, setDeliveryHandlers] = useState<any[]>([]);
  const [assigningOrder, setAssigningOrder] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [detailsOrder, setDetailsOrder] = useState<any | null>(null);
  const [confirmNextOpenOrder, setConfirmNextOpenOrder] = useState<any | null>(null);
  const [rescheduleOrder, setRescheduleOrder] = useState<any | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');

  const { role, id: currentUserId, name, username } = useAuthStore();
  const canTerminate = ['super_admin', 'store_owner'].includes(role || '');
  const canReschedule = ['super_admin', 'store_owner'].includes(role || '');
  const canCancelOutsideArea = ['super_admin', 'store_owner', 'store_manager'].includes(role || '');
  const canManage    = ['super_admin', 'store_owner', 'store_manager'].includes(role || '');
  const canDispatch = false;
  const canAssignDelivery = ['super_admin', 'store_owner', 'store_manager'].includes(role || '');

  const load = (fresh = false) =>
    ordersApi.getAll({ limit: 500, storeId: getActiveStoreId() } as any, { fresh })
      .then(r => setAllOrders(r.data.data || []))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useEffect(() => {
    teamApi.getStoreTeam(getActiveStoreId())
      .then(r => setDeliveryHandlers((r.data.data || []).filter((member: any) => member.isActive && member.assignmentActive && ['store_owner', 'store_manager', 'staff', 'delivery_staff'].includes(member.role))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // Live refresh: instant via SSE events (weak-network friendly), plus a quiet
  // polling fallback so a missed/lost event can never hide an order for long.
  // Live paths pass fresh=true: they must hit the server, not the nav cache.
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh < 2000) return;
      lastRefresh = now;
      load(true);
    };
    const offEvent = onOrderEvent(refresh);
    const offConnect = onOrderStreamConnect(() => load(true));
    const poll = setInterval(() => load(true), 30000);
    return () => { offEvent(); offConnect(); clearInterval(poll); };
  }, []);

  const getStaleMinutes = (order: any): number | null => {
    // After-hours orders legitimately sit from placement until the store next
    // opens, so timing "waiting" from placement would always flag them as late.
    if (order.placedOutsideHours) return null;
    const threshold = STALE_MINS[order.status];
    if (!threshold) return null;
    const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
    return mins >= threshold ? mins : null;
  };

  const handleTerminate = async (id: string, reason: string) => {
    setTerminating(id);
    try { await ordersApi.terminate(id, reason); await load(); }
    finally { setTerminating(null); }
  };

  // Accept an after-hours order for delivery at the next opening hours. The
  // order moves to the normal confirmed status, so prepare/assign/dispatch all
  // keep working exactly as they do for any confirmed order.
  const handleConfirmNextOpen = async (order: any) => {
    setUpdating(order.id);
    try {
      await ordersApi.confirmNextOpen(order.id);
      setConfirmNextOpenOrder(null);
      await load();
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Could not confirm this order for the next opening hours');
      setConfirmNextOpenOrder(null);
    } finally {
      setUpdating(null);
    }
  };

  const openReschedule = (order: any) => {
    setRescheduleOrder(order);
    setRescheduleAt(toStoreDateTimeLocal(order.scheduledFor));
  };

  const handleReschedule = async () => {
    if (!rescheduleOrder || !rescheduleAt) return;
    const scheduledFor = storeDateTimeToIso(rescheduleAt);
    if (!scheduledFor) return;
    setUpdating(rescheduleOrder.id);
    try {
      await ordersApi.reschedule(rescheduleOrder.id, scheduledFor);
      setRescheduleOrder(null);
      setRescheduleAt('');
      await load();
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Could not reschedule this delivery');
    } finally {
      setUpdating(null);
    }
  };

  const handleStopOrder = async (order: any, isEarly: boolean) => {
    if (!cancellationReason) return;
    if (isEarly) {
      setUpdating(order.id);
      try {
        await ordersApi.updateStatus(order.id, 'cancelled', undefined, cancellationReason);
        await load();
      } finally {
        setUpdating(null);
      }
    } else {
      await handleTerminate(order.id, cancellationReason);
    }
    setCancellingId(null);
    setCancellationReason('');
  };

  const handleDeliveryResolution = async (order: any) => {
    if (!resolutionReason) return;
    try {
      if (resolutionType === 'failed_delivery') {
        setUpdating(order.id);
        await ordersApi.updateStatus(order.id, 'failed_delivery', resolutionReason);
        await load();
      } else {
        await handleTerminate(order.id, resolutionReason);
      }
    } finally {
      setUpdating(null);
      setResolvingId(null);
      setResolutionType('failed_delivery');
      setResolutionReason('');
    }
  };

  const handleBatchDispatch = async () => {
    if (batchSelected.length === 0) return;
    setBatching(true);
    try { await ordersApi.batchDispatch(batchSelected); setBatchSelected([]); await load(); }
    finally { setBatching(false); }
  };

  const updateStatus = async (id: string, status: string, e?: React.MouseEvent, failureReason?: string, paymentMethod?: 'cash' | 'upi') => {
    e?.stopPropagation();
    setUpdating(id);
    try {
      await ordersApi.updateStatus(id, status, failureReason, undefined, undefined, paymentMethod);
      await load();
      return true;
    } catch (error: any) {
      // A delivered/moved order may already be committed server-side while a
      // later step (notifications, inventory, etc.) reports failure. Re-fetch
      // instead of trusting the error, so a real status change isn't shown as
      // an error popup.
      try {
        const r = await ordersApi.getAll({ limit: 500, storeId: getActiveStoreId() } as any);
        const rows = r.data.data || [];
        const isDone = rows.some((o: any) => o.id === id && o.status === status);
        if (isDone) {
          setAllOrders(rows);
          setLoading(false);
          return true;
        }
      } catch { /* fall through to the error popup */ }
      alert(error?.response?.data?.error || 'Failed to update order status');
      return false;
    }
    finally { setUpdating(null); }
  };

  const assignForDelivery = async (orderId: string) => {
    if (!assigneeId) return;
    setUpdating(orderId);
    try {
      await ordersApi.updateStatus(orderId, 'ready_to_pickup', undefined, undefined, assigneeId);
      setAssigningOrder(null); setAssigneeId(''); await load();
    } finally { setUpdating(null); }
  };

  const dateBounds = useMemo(() => {
    const now = new Date();
    const start =
      dateRange === 'today'  ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) :
      dateRange === 'week'   ? new Date(now.getTime() - 7 * 86400000) :
      dateRange === 'month'  ? new Date(now.getTime() - 30 * 86400000) :
      dateRange === 'custom' && customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    // Custom end is the whole local day, so a single-day pick isn't cut off at
    // 00:00 and a range ending "today" includes today's orders.
    const end = dateRange === 'custom' && customTo ? new Date(`${customTo}T23:59:59.999`) : null;
    return { start, end };
  }, [dateRange, customFrom, customTo]);

  const filteredOrders = useMemo(() => {
    const { start, end } = dateBounds;
    return allOrders.filter(o => {
      const created = new Date(o.createdAt);
      if (start && created < start) return false;
      if (end   && created > end)   return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        // Match what the row actually shows (real name, or the phone fallback for
        // placeholder names), plus the phone, order identifiers, and any part of
        // the delivery address.
        const matchesName    = orderDisplayName(o).toLowerCase().includes(q);
        const matchesPhone   = String(o.guestPhone || '').toLowerCase().includes(q);
        const matchesOrder   = String(o.orderNumber || '').toLowerCase().includes(q) || String(o.id || '').toLowerCase().includes(q);
        const matchesAddress = String(o.guestAddress || '').toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesOrder && !matchesAddress) return false;
      }
      return true;
    });
  }, [allOrders, dateBounds, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const { start, end } = dateBounds;
    const base = allOrders.filter(o => {
      const d = new Date(o.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
    return Object.fromEntries(
      STATUS_TABS.map(t => [t.id, t.id === '' ? base.length : base.filter(o => o.status === t.id).length])
    );
  }, [allOrders, dateBounds]);

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-3">

      {/* Date range tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {DATE_TABS.map(tab => (
          <button key={tab.id} onClick={() => handleDateRangeClick(tab.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              dateRange === tab.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}>
            {tab.id === 'custom' && <Calendar className="w-3 h-3" />}
            {tab.label}
          </button>
        ))}
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
        )}
      </div>

      {/* Status filter dropdown + search */}
      <div className="flex items-center gap-2">
        <div className="relative inline-block flex-shrink-0">
        <button onClick={() => setStatusOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-gray-400 transition-all">
          {(() => {
            const active = STATUS_TABS.find(t => t.id === statusFilter) || STATUS_TABS[0];
            return (
              <>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active.dot}`} />
                {active.label}
                {(statusCounts[active.id] || 0) > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400">
                    {statusCounts[active.id]}
                  </span>
                )}
              </>
            );
          })()}
          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${statusOpen ? 'rotate-180' : ''}`} />
        </button>

        {statusOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(false)} />
            <div className="absolute top-full mt-1.5 left-0 w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-1.5 z-20">
              {STATUS_TABS.map(tab => (
                <button key={tab.id} onClick={() => { setStatusFilter(tab.id); setStatusOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors ${
                    statusFilter === tab.id ? 'bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tab.dot}`} />
                  <span className="flex-1 text-left">{tab.label}</span>
                  {(statusCounts[tab.id] || 0) > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      statusFilter === tab.id ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                    }`}>
                      {statusCounts[tab.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
        </div>

        {/* Search box — by customer name, phone, address or order id */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, address or order id"
            className="w-full pl-9 pr-8 py-2 text-xs bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Order cards */}
      {filteredOrders.length === 0 ? (
        <div className="page-card">
          <div className="text-center py-16 text-gray-500 dark:text-slate-400">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No orders for this period.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map(order => {
            const nextAction = NEXT_ACTION[order.status];
            const isExpanded = expanded === order.id;
            const isUpdating = updating === order.id;
            const totalItems = (order.items || []).reduce((s: number, i: any) => s + i.quantity, 0);
            const staleMin = getStaleMinutes(order);
            // The next-opening promise only holds until fulfilment actually
            // starts. While the order is still pending/confirmed nothing is
            // being prepared, so the promise is the honest state; once preparing
            // begins it is fulfilled and the promise badges must drop away.
            const awaitingNextOpen = order.confirmedNextOpen
              && (order.status === 'pending' || order.status === 'confirmed');
            const isActive = !TERMINAL.includes(order.status);
            const timeStr = new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
            const duration = deliveryDuration(order);
            const isAssignedDeliveryHandler = order.deliveryById === currentUserId;
            const canReportDeliveryIssue = isAssignedDeliveryHandler || ['super_admin', 'store_owner', 'store_manager'].includes(role || '');
            const canResolveDelivery = order.status === 'out_for_delivery' && (canReportDeliveryIssue || canTerminate);
            const deliveryAction = isAssignedDeliveryHandler && (
              order.status === 'ready_to_pickup' || order.status === 'picked_up'
                ? { label: 'Start Delivery', status: 'out_for_delivery', color: 'bg-violet-500 hover:bg-violet-600 text-white' }
                : order.status === 'out_for_delivery'
                  ? { label: 'Mark Delivered', status: 'delivered', color: 'bg-emerald-500 hover:bg-emerald-600 text-white' }
                  : null
            );

            return (
              <div key={order.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm transition-all ${
                  staleMin ? 'border-amber-200 dark:border-amber-800' : 'border-gray-200 dark:border-slate-700'
                }`}>

                {/* Stale warning banner */}
                {staleMin && (
                  <div className={`px-4 py-1.5 flex items-center gap-2 text-xs font-semibold ${
                    staleMin >= 60
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                  }`}>
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    Waiting {staleMin} min — needs attention
                  </div>
                )}

                {/* Card header */}
                <div className="px-4 pt-4 pb-3">
                  {/* Row 1: Order number + status badge + amount */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-gray-600 dark:text-slate-300">#{order.orderNumber}</span>
                      <span className="text-[10px] text-gray-500 dark:text-slate-400 flex items-center gap-1 whitespace-nowrap">
                        <Clock className="w-3 h-3" />{timeStr}
                      </span>
                      {order.status !== 'delivered' && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[order.status] || order.status}
                        </span>
                      )}
                      {/* Customer-cancelled orders carry the reason the customer
                          chose, so staff do not have to open the order (or call)
                          to find out why it stopped. */}
                      {order.status === 'cancelled' && order.cancellationReason && (
                        <span
                          title={CANCELLATION_REASON_LABELS[order.cancellationReason] || order.cancellationReason}
                          className="text-[10px] font-semibold bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full"
                        >
                          {CANCELLATION_REASON_LABELS[order.cancellationReason] || order.cancellationReason}
                        </span>
                      )}
                        {/* Express ETA is meaningless on an after-hours order,
                            and the scheduled window has its own badge below. */}
                        {order.deliveryPreference && order.deliveryPreference !== 'scheduled' && (!TERMINAL.includes(order.status) || order.status === 'delivered') && (!order.placedOutsideHours || order.status === 'delivered') && (
                          <span className="text-[10px] font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                            {PREF_LABELS[order.deliveryPreference]}
                          </span>
                        )}
                        {duration && (
                          <span title={`Delivered in ${duration.minutes} minutes`} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${duration.color}`}>
                            Delivered in {duration.minutes} min
                          </span>
                        )}
                        {/* Customer booked a later delivery window. Staff plan
                            around the slot rather than the express ETA. */}
                        {order.deliveryPreference === 'scheduled' && order.scheduledForLabel && (
                          <span
                            title={`Scheduled delivery · ${order.scheduledForLabel}`}
                            className="text-[10px] font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full"
                          >
                            Scheduled · {order.scheduledForLabel}
                          </span>
                        )}
                        {/* Taken while the store was shut, not yet accepted.
                            Once staff accept it the "Confirmed · next opening"
                            badge below carries the state, so this drops away. */}
                        {order.placedOutsideHours && !order.confirmedNextOpen && !TERMINAL.includes(order.status) && (
                          <span
                            title={order.closedReason === 'manual'
                              ? 'Store was manually closed when this was placed'
                              : `Outside posted hours — expected from ${order.scheduledForLabel || 'the next opening'}`}
                            className="text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full"
                          >
                            {order.closedReason === 'manual' ? 'Store closed' : `After hours${order.scheduledForLabel ? ` · ${order.scheduledForLabel}` : ''}`}
                          </span>
                        )}
                        {/* Accepted for the next opening hours — the customer was
                            told the same thing and got a push at the moment the
                            staff confirmed it. Only while fulfilment is still
                            waiting on the opening. */}
                        {awaitingNextOpen && (
                          <span
                            title="Accepted for delivery at the next opening hours"
                            className="text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full"
                          >
                            Confirmed · next opening
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <IndianRupee className="w-3.5 h-3.5 text-gray-900 dark:text-white" />
                      <span className="text-base font-bold text-gray-900 dark:text-white">{order.total}</span>
                    </div>
                  </div>

                  {/* Row 2: Customer name + time */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{orderDisplayName(order)}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {order.status === 'delivered' && order.paymentCollectedAt && (
                          <span className={`text-xs font-semibold ${PAYMENT_COLORS[order.paymentMethod] || 'text-gray-500'}`}>
                            {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0">
                      {!TERMINAL.includes(order.status) && (
                        <button onClick={e => { e.stopPropagation(); window.open(`tel:${order.guestPhone}`); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors">
                          <Phone className="w-3.5 h-3.5" />
                          <span className="text-xs font-semibold">{order.guestPhone}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Address + notes — hidden until expanded */}
                  {isExpanded && (
                    <>
                      <div className="flex items-start gap-1.5 bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed flex-1">{order.guestAddress}</p>
                        {!["delivered","cancelled","failed_delivery","terminated"].includes(order.status) && (
                          <button onClick={e => { e.stopPropagation(); openGoogleMaps(order.guestAddress, order.deliveryLatitude, order.deliveryLongitude); }}
                            className="flex-shrink-0 p-1 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                            <Navigation className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {order.deliveryNote && !TERMINAL.includes(order.status) && (
                        <div className="flex items-start gap-1.5 bg-amber-50 dark:bg-amber-900/10 rounded-xl px-3 py-2">
                          <span className="text-sm flex-shrink-0">📝</span>
                          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">{order.deliveryNote}</p>
                        </div>
                      )}
                      {order.notes && !TERMINAL.includes(order.status) && (
                        <div className="flex items-start gap-1.5 bg-blue-50 dark:bg-blue-900/10 rounded-xl px-3 py-2">
                          <span className="text-sm flex-shrink-0">💬</span>
                          <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">{order.notes}</p>
                        </div>
                      )}
                      {/* Why the order stopped — the customer's own reason for a
                          self-service cancel, or the staff reason otherwise. */}
                      {['cancelled', 'terminated'].includes(order.status) && order.cancellationReason && (
                        <div className="flex items-start gap-1.5 bg-red-50 dark:bg-red-900/10 rounded-xl px-3 py-2">
                          <XCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-red-700 dark:text-red-400 leading-relaxed">
                            {CANCELLATION_REASON_LABELS[order.cancellationReason] || order.cancellationReason}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Delivery staff info when dispatched */}
                  {(order.status === 'out_for_delivery' || order.status === 'picked_up') && order.deliveryByName && (
                    <div className="flex items-center gap-2 mt-2 bg-violet-50 dark:bg-violet-900/20 rounded-xl px-3 py-2">
                      <span className="text-xs">🛵</span>
                      <span className="flex-1 min-w-0 text-xs font-semibold text-violet-700 dark:text-violet-400 break-words">{order.deliveryByName}</span>
                      {order.deliveryByPhone && (
                        <button onClick={e => { e.stopPropagation(); window.open(`tel:${order.deliveryByPhone}`); }}
                          className="ml-auto text-[10px] text-violet-600 dark:text-violet-400 font-semibold hover:underline">
                          {order.deliveryByPhone}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Progress bar — active orders only */}
                {isActive && <OrderProgress status={order.status} />}
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <JourneyButton onClick={e => { e.stopPropagation(); setDetailsOrder(order); }} />
                  <div className="flex items-center gap-1.5">
                    {canManage && !TERMINAL.includes(order.status) && order.status !== 'out_for_delivery' && (['pending', 'confirmed'].includes(order.status) || canTerminate) && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setCancellationReason(''); setCancellingId(order.id); }}
                        disabled={isUpdating}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Cancel
                      </button>
                    )}
                    {canReschedule && order.status !== 'delivered' && (
                      <button
                        type="button"
                        aria-label="Reschedule delivery"
                        title="Reschedule delivery"
                        onClick={e => { e.stopPropagation(); openReschedule(order); }}
                        className="inline-flex items-center justify-center rounded-lg border border-violet-200 bg-violet-50 p-2 text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/30"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {['store_owner', 'store_manager'].includes(role || '') && order.status !== 'pending' && order.statusEvents?.length > 0 && (
                  <p className="px-4 pb-2 text-[10px] text-gray-500 dark:text-slate-400 break-words">
                    Current state set by {order.statusEvents[order.statusEvents.length - 1].actorName}
                  </p>
                )}

                {/* Action bar */}
                {order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'terminated' && (
                  <div className="px-4 pb-3 pt-1 flex items-center gap-2 flex-wrap">
                    <>
                    {/* Batch select */}
                    {canDispatch && (order.status === 'confirmed' || order.status === 'preparing' || order.status === 'ready_to_pickup') && (
                      <button
                        onClick={e => { e.stopPropagation(); setBatchSelected(prev => prev.includes(order.id) ? prev.filter(id => id !== order.id) : [...prev, order.id]); }}
                        className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                          batchSelected.includes(order.id)
                            ? 'bg-violet-500 text-white border-violet-500'
                            : 'bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300'
                        }`}>
                        {batchSelected.includes(order.id) ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                        Batch
                      </button>
                    )}

                    {/* Confirm-for-next-opening: shown only for orders placed
                        after closing hours, and only to staff who can actually
                        call the endpoint (super_admin/store_owner/store_manager).
                        The generic Confirm Order button is suppressed for these
                        managers because "we're preparing your order" would be a
                        false promise while the store is shut — this one promises
                        the next opening hours instead. Non-manager roles keep
                        their original Confirm Order, which is the transition they
                        have always been able to make. */}
                    {canManage && order.status === 'pending' && order.placedOutsideHours && (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmNextOpenOrder(order); }}
                        disabled={isUpdating}
                        title="Store was closed when this was placed — accept it and deliver at the next opening hours"
                        className="flex-1 min-w-[150px] flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold leading-tight whitespace-normal rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 transition-colors disabled:opacity-50">
                        Confirm for next opening hours
                      </button>
                    )}

                    {/* Primary next action */}
                    {nextAction && order.status !== 'preparing' && !(order.status === 'pending' && order.placedOutsideHours && canManage) && (
                      <button
                        onClick={e => updateStatus(order.id, nextAction.status, e)}
                        disabled={isUpdating}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl transition-all disabled:opacity-50 ${nextAction.color}`}>
                        {isUpdating
                          ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : nextAction.label}
                      </button>
                    )}

                    {order.status === 'preparing' && canAssignDelivery && (
                      assigningOrder === order.id ? (
                        <div className="flex flex-1 items-center gap-2">
                          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
                            className="flex-1 min-w-0 px-2.5 py-2.5 text-xs border border-orange-200 dark:border-orange-800 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none">
                            <option value="">Select delivery handler</option>
                            {currentUserId && <option value={currentUserId}>Myself ({name || username})</option>}
                            {deliveryHandlers.filter(member => member.adminId !== currentUserId).map(member => (
                              <option key={member.adminId} value={member.adminId}>{member.name || member.username}</option>
                            ))}
                          </select>
                          <button onClick={() => assignForDelivery(order.id)} disabled={!assigneeId || isUpdating}
                            className="px-3 py-2.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50">Ready</button>
                        </div>
                      ) : (
                        <button onClick={() => { setAssigningOrder(order.id); setAssigneeId(currentUserId || ''); }}
                          className="flex-1 py-2.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors">
                          Assign &amp; Ready for Pickup
                        </button>
                      )
                    )}

                    {deliveryAction && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          if (deliveryAction.status === 'delivered') {
                            setPaymentOrder(order);
                          } else {
                            updateStatus(order.id, deliveryAction.status, e);
                          }
                        }}
                        disabled={isUpdating}
                        className={`flex-1 min-w-[132px] flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-xs font-bold leading-tight whitespace-normal rounded-xl transition-all disabled:opacity-50 ${deliveryAction.color}`}>
                        {isUpdating
                          ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : deliveryAction.label}
                      </button>
                    )}

                    {/* One delivery-resolution flow keeps failure and termination auditable. */}
                    {canResolveDelivery && (resolvingId === order.id ? (() => {
                      const isProcessing = updating === order.id || terminating === order.id;
                      const canTerminateThisOrder = canTerminate;
                      const terminationSelected = resolutionType === 'terminated';
                      return (
                        <div className="flex flex-1 items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                          <select value={resolutionType}
                            onChange={e => { setResolutionType(e.target.value as 'failed_delivery' | 'terminated'); setResolutionReason(''); }}
                            disabled={isProcessing}
                            className="min-w-[148px] flex-1 text-xs border border-orange-200 dark:border-orange-800 rounded-xl px-2.5 py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 focus:outline-none cursor-pointer font-semibold disabled:opacity-50">
                            <option value="failed_delivery">Unable to deliver</option>
                            {canTerminateThisOrder && <option value="terminated">Terminate order</option>}
                          </select>
                          <select value={resolutionReason}
                            onChange={e => setResolutionReason(e.target.value)}
                            disabled={isProcessing}
                            className="min-w-[148px] flex-1 text-xs border border-orange-200 dark:border-orange-800 rounded-xl px-2.5 py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 focus:outline-none cursor-pointer font-semibold disabled:opacity-50">
                            <option value="" disabled>{terminationSelected ? 'Why terminate?' : 'Why unable to deliver?'}</option>
                            {terminationSelected ? <>
                              <option value="out_of_stock">Out of stock</option>
                              <option value="store_closed">Store closed</option>
                              <option value="rider_unavailable">Rider unavailable</option>
                              <option value="technical_issue">Technical issue</option>
                            </> : <>
                              <option value="refused">Customer refused</option>
                              <option value="no_answer">Customer unavailable</option>
                              <option value="phone_off">Phone switched off</option>
                              <option value="wrong_address">Wrong or unreachable address</option>
                            </>}
                            <option value="other">Other</option>
                          </select>
                          <button onClick={() => handleDeliveryResolution(order)} disabled={!resolutionReason || isProcessing}
                            className="px-3 py-2 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50">
                            Confirm
                          </button>
                          <button onClick={() => { setResolvingId(null); setResolutionType('failed_delivery'); setResolutionReason(''); }} disabled={isProcessing}
                            className="p-2 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-xl disabled:opacity-50"
                            aria-label="Close delivery resolution" title="Back">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })() : (
                      <button onClick={e => { e.stopPropagation(); setResolutionType('failed_delivery'); setResolutionReason(''); setResolvingId(order.id); }} disabled={isUpdating}
                        className="flex items-center gap-1 px-3 py-2.5 text-xs font-semibold rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Resolve Delivery</span>
                      </button>
                    ))}

                    {/* Early order cancellation and late-stage termination remain distinct from delivery resolution. */}
                    {canManage && !TERMINAL.includes(order.status) && order.status !== 'out_for_delivery' && (() => {
                      const isEarly = ['pending', 'confirmed'].includes(order.status);
                      const isLate  = !isEarly;
                      if (isLate && !canTerminate) return null;
                      const isProcessing = updating === order.id || terminating === order.id;
                      return cancellingId === order.id ? (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <select value={cancellationReason}
                            onChange={e => setCancellationReason(e.target.value)}
                            disabled={isProcessing}
                            className="text-xs border border-red-200 dark:border-red-800 rounded-xl px-2.5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 focus:outline-none cursor-pointer font-semibold disabled:opacity-50">
                            <option value="" disabled>Why stopping?</option>
                            {isEarly && <option value="customer_request">Customer request</option>}
                            {isEarly && <option value="duplicate_order">Duplicate order</option>}
                            {(isEarly || canTerminate) && <option value="out_of_stock">Out of stock</option>}
                            {(isEarly || canTerminate) && <option value="store_closed">Store closed</option>}
                            {order.status === 'pending' && canCancelOutsideArea && <option value="outside_area">Outside delivery area</option>}
                            {(isEarly || canTerminate) && <option value="incorrect_address">Invalid address</option>}
                            {!isEarly && canTerminate && <option value="rider_unavailable">Rider unavailable</option>}
                            {!isEarly && canTerminate && <option value="technical_issue">Technical issue</option>}
                            {(isEarly || canTerminate) && <option value="other">Other</option>}
                          </select>
                          <button onClick={() => handleStopOrder(order, isEarly)} disabled={!cancellationReason || isProcessing}
                            className="px-3 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl disabled:opacity-50">
                            Confirm
                          </button>
                          <button onClick={() => { setCancellingId(null); setCancellationReason(''); }} disabled={isProcessing}
                            className="p-2 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-xl disabled:opacity-50"
                            aria-label="Go back without stopping this order" title="Back">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        null
                      );
                    })()}
                    </>
                  </div>
                )}

                {/* Expand toggle */}
                <button onClick={() => setExpanded(isExpanded ? null : order.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-t border-gray-50 dark:border-slate-700 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    <span>
                      {totalItems} item{totalItems !== 1 ? 's' : ''} · ₹{order.subtotal} + ₹{order.deliveryCharge} delivery
                      {Number(order.campaignDiscount) > 0 ? ` − ₹${order.campaignDiscount} offer` : ''}
                    </span>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} strokeWidth={3} />
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="border-t border-gray-50 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/30 px-4 py-3 space-y-2">
                    {(order.items || []).map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <SmartImage
                            src={item.photoUrl}
                            alt={item.productName}
                            className="w-8 h-8 rounded-lg flex-shrink-0 border border-gray-100 dark:border-slate-600"
                            imgClassName="object-cover"
                          />
                          <div className="min-w-0">
                            <p className="break-words text-xs text-gray-700 dark:text-slate-300">
                              {item.productName} <span className="text-gray-500 dark:text-slate-400">({item.unit})</span> × {item.quantity}
                            </p>
                            {item.localName && item.localName.trim() !== item.productName.trim() && (
                              <p className="mt-0.5 break-words text-[11px] text-gray-500 dark:text-slate-400">{item.localName}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-gray-900 dark:text-white flex-shrink-0">₹{item.total}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-gray-100 dark:border-slate-600 space-y-1">
                      {(() => {
                        const itemSavings = Number(order.itemSavings) || 0;
                        const freeDeliverySaving = Number(order.freeDeliverySaving) || 0;
                        const campaignDiscount = Number(order.campaignDiscount) || 0;
                        const totalSavings = itemSavings + freeDeliverySaving + campaignDiscount;
                        return (
                          <>
                            {totalSavings > 0 && (
                              <div className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-amber-950">
                                <span className="text-xs" aria-hidden="true">🎉</span>
                                <span className="text-xs font-extrabold">Customer saved ₹{totalSavings.toFixed(0)}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                              <span>Subtotal</span>
                              <span className="flex items-center gap-1.5">
                                {itemSavings > 0 && (
                                  <span className="text-gray-400 line-through dark:text-slate-500">₹{(Number(order.subtotal) + itemSavings).toFixed(0)}</span>
                                )}
                                <span className="text-gray-900 dark:text-white">₹{order.subtotal}</span>
                              </span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                              <span>Delivery</span>
                              <span className="flex items-center gap-1.5">
                                {freeDeliverySaving > 0 && (
                                  <span className="text-gray-400 line-through dark:text-slate-500">₹{freeDeliverySaving.toFixed(0)}</span>
                                )}
                                <span>{order.deliveryCharge === 0 ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">FREE</span> : `₹${order.deliveryCharge}`}</span>
                              </span>
                            </div>
                            {campaignDiscount > 0 && (
                              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                                <span>{order.couponCodeUsed ? `Coupon ${order.couponCodeUsed}` : 'Offer discount'}</span>
                                <span>-₹{order.campaignDiscount}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white pt-1 border-t border-gray-100 dark:border-slate-600">
                              <span>Total</span><span>₹{order.total}</span>
                            </div>
                            {order.status === 'delivered' && (
                              <button onClick={e => { e.stopPropagation(); printReceipt(order); }}
                                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                                <IndianRupee className="w-3.5 h-3.5" /> View receipt
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Batch dispatch sticky bar */}
      {batchSelected.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:left-[200px] bg-violet-600 dark:bg-violet-700 px-4 py-3 flex items-center justify-between gap-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-white flex-shrink-0" />
            <span className="text-sm font-bold text-white">
              {batchSelected.length} order{batchSelected.length > 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setBatchSelected([])}
              className="px-3 py-1.5 text-xs font-semibold text-violet-200 hover:text-white transition-colors">
              Clear
            </button>
            <button onClick={handleBatchDispatch} disabled={batching}
              className="flex items-center gap-1.5 px-4 py-2 bg-white text-violet-700 text-xs font-bold rounded-xl hover:bg-violet-50 disabled:opacity-50 transition-colors">
              {batching ? <div className="w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
              🛵 Dispatch
            </button>
          </div>
        </div>
      )}

      {detailsOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4" onClick={() => setDetailsOrder(null)}>
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-4">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Order #{detailsOrder.orderNumber}</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 break-words">Status history and activity</p>
              </div>
              <button onClick={() => setDetailsOrder(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700" aria-label="Close order details">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-4 py-5">
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-700/50">
                <p className="text-xs font-semibold text-gray-900 dark:text-white break-words">{orderDisplayName(detailsOrder)}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 break-words">Delivered order total: ₹{detailsOrder.total}</p>
              </div>
              <div className="space-y-0">
                <div className="relative flex gap-3 pb-4">
                  <div className="flex w-5 justify-center"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-gray-400" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">Order placed</p>
                    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">Customer · {new Date(detailsOrder.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                  </div>
                </div>
                {getJourneyEvents(detailsOrder).map((event: any, index: number, events: any[]) => (
                  <div key={`${event.createdAt}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < events.length - 1 && <span className="absolute left-[9px] top-4 h-full w-px bg-gray-200 dark:bg-slate-600" />}
                    <div className="z-10 flex w-5 justify-center"><span className={`mt-1 h-2.5 w-2.5 rounded-full ${event.type === 'delivery' ? 'bg-violet-500' : 'bg-emerald-500'}`} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold capitalize text-gray-900 dark:text-white break-words">
                        {event.type === 'delivery'
                          ? `Delivery rescheduled to ${new Date(event.scheduledFor).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`
                          : event.toStatus.replaceAll('_', ' ')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400 break-words">
                        {event.actorName} · {new Date(event.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentOrder && (
        <PaymentConfirmDialog
          orderTotal={paymentOrder.total}
          submitting={updating === paymentOrder.id}
          onConfirm={async (method) => {
            if (await updateStatus(paymentOrder.id, 'delivered', undefined, undefined, method)) {
              setPaymentOrder(null);
            }
          }}
          onCancel={() => setPaymentOrder(null)}
        />
      )}

      {confirmNextOpenOrder && (
        <ConfirmDialog
          title="Confirm for next opening hours"
          message={`Accept order #${confirmNextOpenOrder.orderNumber}? The customer will be told it will be delivered at the store's next opening hours, and they'll get a notification now.`}
          confirmLabel="Confirm"
          onConfirm={() => handleConfirmNextOpen(confirmNextOpenOrder)}
          onCancel={() => setConfirmNextOpenOrder(null)}
        />
      )}

      {rescheduleOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 sm:items-center" onClick={() => setRescheduleOrder(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"><CalendarClock className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">Reschedule delivery</h2>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">Order #{rescheduleOrder.orderNumber}. The customer will receive a delivery update.</p>
                </div>
              </div>
              <button type="button" onClick={() => setRescheduleOrder(null)} disabled={updating === rescheduleOrder.id}
                className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700"
                aria-label="Close reschedule delivery" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-xs font-semibold text-gray-700 dark:text-slate-300" htmlFor="reschedule-time">Delivery time</label>
            <input id="reschedule-time" type="datetime-local" step="1800" value={rescheduleAt} onChange={event => setRescheduleAt(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">Choose an available 30-minute store-hours slot today or tomorrow. All times are IST.</p>
            <div className="mt-5">
              <button type="button" onClick={handleReschedule} disabled={!rescheduleAt || updating === rescheduleOrder.id}
                className="w-full rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">{updating === rescheduleOrder.id ? 'Saving...' : 'Reschedule'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
