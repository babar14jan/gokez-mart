import { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList, Calendar, ChevronDown, Phone, MapPin,
  Navigation, Package, XCircle, CheckSquare, Square,
  Truck, Receipt, Clock, IndianRupee,
} from 'lucide-react';
import { ordersApi } from '../services/api';
import { printReceipt } from '../utils/printReceipt';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';

type DateRange = 'today' | 'week' | 'month' | 'custom' | 'all';
type StatusFilter = '' | 'pending' | 'confirmed' | 'preparing' | 'ready_to_pickup' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'failed_delivery' | 'terminated';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

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
const PAYMENT_COLORS: Record<string, string> = {
  cod: 'text-emerald-600 dark:text-emerald-400',
  upi: 'text-blue-600 dark:text-blue-400',
  phonepay: 'text-violet-600 dark:text-violet-400',
};

const NEXT_ACTION: Record<string, { label: string; status: string; color: string } | null> = {
  pending:          { label: 'Confirm Order',     status: 'confirmed',        color: 'bg-blue-500 hover:bg-blue-600 text-white' },
  confirmed:        { label: 'Start Preparing',   status: 'preparing',        color: 'bg-indigo-500 hover:bg-indigo-600 text-white' },
  preparing:        { label: 'Ready to Pickup',   status: 'ready_to_pickup',  color: 'bg-orange-500 hover:bg-orange-600 text-white' },
  ready_to_pickup:  { label: 'Out for Delivery',  status: 'out_for_delivery', color: 'bg-violet-500 hover:bg-violet-600 text-white' },
  out_for_delivery: { label: 'Picked Up',         status: 'picked_up',        color: 'bg-amber-500 hover:bg-amber-600 text-white' },
  picked_up:        { label: 'Mark Delivered',    status: 'delivered',        color: 'bg-emerald-500 hover:bg-emerald-600 text-white' },
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
  { id: 'all',   label: 'All Time' },
  { id: 'custom',label: 'Custom' },
];

const PREF_LABELS: Record<string, string> = {
  within_15: '⚡ 10-15 mins',
  within_30: '🕐 30 mins',
  within_60: '🕑 1 hour',
};

const STALE_MINS: Record<string, number> = {
  pending: 15, confirmed: 20, preparing: 30, out_for_delivery: 45,
};

function openGoogleMaps(address: string) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
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
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all ${
                  active ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900 scale-110' :
                  done   ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                           'bg-gray-100 dark:bg-slate-700 text-gray-300 dark:text-slate-600'
                }`}>
                  {done ? '✓' : step.emoji}
                </div>
                <span className={`text-[9px] font-semibold mt-0.5 text-center leading-tight ${
                  active ? 'text-emerald-600 dark:text-emerald-400' :
                  done   ? 'text-gray-400 dark:text-slate-500' :
                           'text-gray-300 dark:text-slate-600'
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);

  const { role } = useAuthStore();
  const canTerminate = ['super_admin', 'store_owner'].includes(role || '');
  const canManage    = ['super_admin', 'store_owner', 'sales_manager', 'store_manager'].includes(role || '');
  const canDispatch  = ['super_admin', 'store_owner', 'sales_manager', 'store_manager'].includes(role || '');

  const load = () =>
    ordersApi.getAll({ limit: 500, storeId: getActiveStoreId() } as any)
      .then(r => setAllOrders(r.data.data || []))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const getStaleMinutes = (order: any): number | null => {
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

  const handleBatchDispatch = async () => {
    if (batchSelected.length === 0) return;
    setBatching(true);
    try { await ordersApi.batchDispatch(batchSelected); setBatchSelected([]); await load(); }
    finally { setBatching(false); }
  };

  const updateStatus = async (id: string, status: string, e?: React.MouseEvent, failureReason?: string) => {
    e?.stopPropagation();
    setUpdating(id);
    try { await ordersApi.updateStatus(id, status, failureReason); await load(); }
    finally { setUpdating(null); }
  };

  const filteredOrders = useMemo(() => {
    const now = new Date();
    const start =
      dateRange === 'today'  ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) :
      dateRange === 'week'   ? new Date(now.getTime() - 7 * 86400000) :
      dateRange === 'month'  ? new Date(now.getTime() - 30 * 86400000) :
      dateRange === 'custom' && customFrom ? new Date(customFrom) : null;
    const end = dateRange === 'custom' && customTo
      ? (() => { const d = new Date(customTo); d.setHours(23,59,59,999); return d; })()
      : null;
    return allOrders.filter(o => {
      const created = new Date(o.createdAt);
      if (start && created < start) return false;
      if (end   && created > end)   return false;
      if (statusFilter && o.status !== statusFilter) return false;
      return true;
    });
  }, [allOrders, dateRange, customFrom, customTo, statusFilter]);

  const statusCounts = useMemo(() => {
    const base = allOrders.filter(o => {
      const now = new Date();
      const start =
        dateRange === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) :
        dateRange === 'week'  ? new Date(now.getTime() - 7 * 86400000) :
        dateRange === 'month' ? new Date(now.getTime() - 30 * 86400000) : null;
      return !start || new Date(o.createdAt) >= start;
    });
    return Object.fromEntries(
      STATUS_TABS.map(t => [t.id, t.id === '' ? base.length : base.filter(o => o.status === t.id).length])
    );
  }, [allOrders, dateRange]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-3">

      {/* Date range tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {DATE_TABS.map(tab => (
          <button key={tab.id} onClick={() => setDateRange(tab.id)}
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
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {STATUS_TABS.map(tab => (
          <button key={tab.id} onClick={() => setStatusFilter(tab.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
              statusFilter === tab.id
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-gray-400'
            }`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tab.dot}`} />
            {tab.label}
            {(statusCounts[tab.id] || 0) > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                statusFilter === tab.id ? 'bg-white/20 dark:bg-black/20' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
              }`}>
                {statusCounts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Order cards */}
      {filteredOrders.length === 0 ? (
        <div className="page-card">
          <div className="text-center py-16 text-gray-400 dark:text-slate-500">
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
            const isActive = !TERMINAL.includes(order.status);
            const timeStr = new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

            return (
              <div key={order.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl border overflow-hidden shadow-sm transition-all ${
                  staleMin ? 'border-amber-200 dark:border-amber-800' : 'border-gray-100 dark:border-slate-700'
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
                      <span className="text-xs font-bold text-gray-500 dark:text-slate-400">#{order.orderNumber}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                      {order.deliveryPreference && (
                        <span className="text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          {PREF_LABELS[order.deliveryPreference]}
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
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{order.guestName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-xs font-semibold ${PAYMENT_COLORS[order.paymentMethod] || 'text-gray-500'}`}>
                          {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{timeStr}
                        </span>
                      </div>
                    </div>
                    {/* Call button */}
                    <button onClick={e => { e.stopPropagation(); window.open(`tel:${order.guestPhone}`); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors flex-shrink-0">
                      <Phone className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">{order.guestPhone}</span>
                    </button>
                  </div>

                  {/* Row 3: Address */}
                  <div className="flex items-start gap-1.5 bg-gray-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed flex-1">{order.guestAddress}</p>
                    <button onClick={e => { e.stopPropagation(); openGoogleMaps(order.guestAddress); }}
                      className="flex-shrink-0 p-1 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <Navigation className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Delivery note */}
                  {order.deliveryNote && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5 px-1">📝 {order.deliveryNote}</p>
                  )}

                  {/* Delivery staff info when dispatched */}
                  {(order.status === 'out_for_delivery' || order.status === 'picked_up') && order.deliveryByName && (
                    <div className="flex items-center gap-2 mt-2 bg-violet-50 dark:bg-violet-900/20 rounded-xl px-3 py-2">
                      <span className="text-xs">🛵</span>
                      <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">{order.deliveryByName}</span>
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

                {/* Action bar */}
                {order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'terminated' && (
                  <div className="px-4 pb-3 pt-1 flex items-center gap-2 flex-wrap">

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

                    {/* Primary next action */}
                    {nextAction && (
                      <button
                        onClick={e => updateStatus(order.id, nextAction.status, e)}
                        disabled={isUpdating}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl transition-all disabled:opacity-50 ${nextAction.color}`}>
                        {isUpdating
                          ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : nextAction.label}
                      </button>
                    )}

                    {/* Delivery failed dropdown */}
                    {order.status === 'out_for_delivery' && (
                      <select defaultValue=""
                        onChange={async e => {
                          const reason = e.target.value;
                          if (!reason) return;
                          e.target.value = '';
                          await updateStatus(order.id, 'failed_delivery', undefined, reason);
                        }}
                        onClick={e => e.stopPropagation()}
                        className="text-xs border border-orange-200 dark:border-orange-800 rounded-xl px-2.5 py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 focus:outline-none cursor-pointer font-semibold">
                        <option value="" disabled>⚠️ Failed?</option>
                        <option value="refused">Customer refused</option>
                        <option value="no_answer">No answer</option>
                        <option value="phone_off">Phone off</option>
                        <option value="wrong_address">Wrong address</option>
                      </select>
                    )}

                    {/* Cancel */}
                    {canManage && (order.status === 'pending' || order.status === 'confirmed') && (
                      <button onClick={e => updateStatus(order.id, 'cancelled', e)} disabled={isUpdating}
                        className="flex items-center gap-1 px-3 py-2.5 text-xs font-semibold rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Cancel</span>
                      </button>
                    )}

                    {/* Terminate */}
                    {canTerminate && !['delivered','cancelled','failed_delivery','terminated'].includes(order.status) && (
                      <select defaultValue=""
                        onChange={e => { const r = e.target.value; if (!r) return; e.target.value = ''; handleTerminate(order.id, r); }}
                        onClick={e => e.stopPropagation()}
                        disabled={terminating === order.id}
                        className="text-xs border border-red-200 dark:border-red-800 rounded-xl px-2.5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 focus:outline-none cursor-pointer font-semibold disabled:opacity-50">
                        <option value="" disabled>🛑 Terminate?</option>
                        <option value="rider_unavailable">Rider unavailable</option>
                        <option value="store_closed">Store closed</option>
                        <option value="out_of_stock">Out of stock</option>
                        <option value="technical_issue">Technical issue</option>
                        <option value="other">Other</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Receipt button for delivered */}
                {order.status === 'delivered' && (
                  <div className="px-4 pb-3 pt-1">
                    <button onClick={e => { e.stopPropagation(); printReceipt(order); }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">
                      <Receipt className="w-3.5 h-3.5" /> Print Receipt
                    </button>
                  </div>
                )}

                {/* Expand toggle */}
                <button onClick={() => setExpanded(isExpanded ? null : order.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-t border-gray-50 dark:border-slate-700 text-xs text-gray-400 dark:text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    <span>{totalItems} item{totalItems !== 1 ? 's' : ''} · ₹{order.subtotal} + ₹{order.deliveryCharge} delivery</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="border-t border-gray-50 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/30 px-4 py-3 space-y-2">
                    {(order.items || []).map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.photoUrl && (
                            <img src={item.photoUrl} alt={item.productName}
                              className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-gray-100 dark:border-slate-600" />
                          )}
                          <span className="text-xs text-gray-700 dark:text-slate-300 truncate">
                            {item.productName} <span className="text-gray-400">({item.unit})</span> × {item.quantity}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-gray-900 dark:text-white flex-shrink-0">₹{item.total}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-gray-100 dark:border-slate-600 space-y-1">
                      <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500">
                        <span>Subtotal</span><span>₹{order.subtotal}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500">
                        <span>Delivery</span><span>₹{order.deliveryCharge}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white pt-1 border-t border-gray-100 dark:border-slate-600">
                        <span>Total</span><span>₹{order.total}</span>
                      </div>
                    </div>
                    {order.notes && (
                      <p className="text-xs text-gray-500 dark:text-slate-400 pt-1 border-t border-gray-100 dark:border-slate-600">📝 {order.notes}</p>
                    )}
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
    </div>
  );
}
