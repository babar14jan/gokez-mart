import { useEffect, useState, useMemo } from 'react';
import {
  ClipboardList, Calendar,
  ChevronDown, Phone, MapPin, Navigation, Package,
  XCircle, CheckSquare, Square, Truck, Receipt,
} from 'lucide-react';
import { ordersApi } from '../services/api';
import { printReceipt } from '../utils/printReceipt';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';

type DateRange = 'today' | 'week' | 'month' | 'custom' | 'all';
type StatusFilter = '' | 'pending' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'failed_delivery' | 'terminated';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  confirmed:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  preparing:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  out_for_delivery: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  picked_up:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  delivered:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled:        'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  failed_delivery:  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  terminated:       'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery', picked_up: 'Picked Up', delivered: 'Delivered',
  cancelled: 'Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Terminated',
};

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe' };

// Next logical action for each status
const NEXT_ACTION: Record<string, { label: string; status: string; color: string } | null> = {
  pending:          { label: '✓ Confirm Order',      status: 'confirmed',        color: 'bg-blue-500 hover:bg-blue-600 text-white' },
  confirmed:        { label: '🍳 Start Preparing',   status: 'preparing',        color: 'bg-indigo-500 hover:bg-indigo-600 text-white' },
  preparing:        { label: '🛵 Out for Delivery',  status: 'out_for_delivery', color: 'bg-violet-500 hover:bg-violet-600 text-white' },
  out_for_delivery: { label: '📦 Picked Up',         status: 'picked_up',        color: 'bg-amber-500 hover:bg-amber-600 text-white' },
  picked_up:        { label: '✅ Mark Delivered',    status: 'delivered',        color: 'bg-emerald-500 hover:bg-emerald-600 text-white' },
  delivered:        null,
  cancelled:        null,
  failed_delivery:  null,
};

const STATUS_TABS: { id: StatusFilter; label: string; dot: string }[] = [
  { id: '',                label: 'All',         dot: 'bg-gray-400' },
  { id: 'pending',         label: 'Pending',     dot: 'bg-amber-500' },
  { id: 'confirmed',       label: 'Confirmed',   dot: 'bg-blue-500' },
  { id: 'preparing',       label: 'Preparing',   dot: 'bg-indigo-500' },
  { id: 'out_for_delivery',label: 'On the Way',  dot: 'bg-violet-500' },
  { id: 'delivered',       label: 'Delivered',   dot: 'bg-emerald-500' },
  { id: 'cancelled',       label: 'Cancelled',   dot: 'bg-red-400' },
  { id: 'failed_delivery', label: 'Failed',      dot: 'bg-orange-500' },
  { id: 'terminated',      label: 'Terminated',  dot: 'bg-gray-400' },
];

const DATE_TABS: { id: DateRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: '7 Days' },
  { id: 'month', label: '30 Days' },
  { id: 'all',   label: 'All Time' },
  { id: 'custom',label: 'Custom' },
];

function openGoogleMaps(address: string) {
  const encoded = encodeURIComponent(address);
  window.open(`https://www.google.com/maps/search/?api=1&query=${encoded}`, '_blank');
}

function callPhone(phone: string) {
  window.open(`tel:${phone}`);
}

export default function OrdersPage() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const [terminating, setTerminating] = useState<string | null>(null);

  // Stale thresholds in minutes
  const STALE_MINS: Record<string, number> = {
    pending: 15, confirmed: 20, preparing: 30, out_for_delivery: 45,
  };

  const getStaleMinutes = (order: any): number | null => {
    const threshold = STALE_MINS[order.status];
    if (!threshold) return null;
    const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
    return mins >= threshold ? mins : null;
  };

  const handleTerminate = async (id: string, reason: string, customReason?: string) => {
    setTerminating(id);
    try { await ordersApi.terminate(id, reason, customReason); await load(); }
    finally { setTerminating(null); }
  };

  const PREF_LABELS: Record<string, string> = {
    within_15: '⚡ Within 10-15 mins',
    within_30: '🕐 Within 30 mins',
    within_60: '🕑 Within 1 hour',
  };
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () =>
    ordersApi.getAll({ limit: 500, storeId: getActiveStoreId() } as any)
      .then(r => setAllOrders(r.data.data || []))
      .finally(() => setLoading(false));

  const { role } = useAuthStore();
  const canTerminate = ['super_admin', 'store_owner'].includes(role || '');
  const canManage = ['super_admin', 'store_owner', 'sales_manager'].includes(role || '');
  const canDispatch = ['super_admin', 'store_owner', 'sales_manager'].includes(role || '');

  useEffect(() => { load(); }, []);


  const handleBatchDispatch = async () => {
    if (batchSelected.length === 0) return;
    setBatching(true);
    try {
      await ordersApi.batchDispatch(batchSelected);
      setBatchSelected([]);
      await load();
    } finally { setBatching(false); }
  };
  const updateStatus = async (id: string, status: string, e?: React.MouseEvent, failureReason?: string) => {
    e?.stopPropagation();
    setUpdating(id);
    try {
      await ordersApi.updateStatus(id, status, failureReason);
      await load();
    } finally { setUpdating(null); }
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

  // Count per status for tab badges
  const statusCounts = useMemo(() => {
    const base = allOrders.filter(o => {
      const now = new Date();
      const start =
        dateRange === 'today'  ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) :
        dateRange === 'week'   ? new Date(now.getTime() - 7 * 86400000) :
        dateRange === 'month'  ? new Date(now.getTime() - 30 * 86400000) : null;
      if (start && new Date(o.createdAt) < start) return false;
      return true;
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

      {/* Status filter tabs with counts */}
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
        <div className="space-y-2">
          {filteredOrders.map(order => {
            const nextAction = NEXT_ACTION[order.status];
            const isExpanded = expanded === order.id;
            const isUpdating = updating === order.id;
            const totalItems = (order.items || []).reduce((s: number, i: any) => s + i.quantity, 0);

            return (
              <div key={order.id}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden shadow-sm">

                {/* Card header — always visible */}
                <div className="px-4 pt-3.5 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* Left: order number + status, then customer + time */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-xs font-bold text-gray-900 dark:text-white truncate">Order #{order.orderNumber}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[order.status] || order.status}
                        </span>
                        {(() => { const m = getStaleMinutes(order); return m ? (<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${m >= 60 ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>⚠️ {m}min</span>) : null; })()}                      </div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{order.guestName}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                        {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod} · {new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {/* Right: price on top, call below — aligned with customer name */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">₹{order.total}</span>
                      <button
                        onClick={e => { e.stopPropagation(); callPhone(order.guestPhone); }}
                        className="flex items-center justify-center w-7 h-7 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 transition-colors">
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Address */}
                  <div className="flex items-start gap-1.5 mt-1.5">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">{order.guestAddress}</p>
                  </div>
                  {/* Delivery preference + note */}
                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    {order.deliveryPreference && (
                      <span className="text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                        {PREF_LABELS[order.deliveryPreference] || order.deliveryPreference}
                      </span>
                    )}
                    {order.deliveryNote && (
                      <span className="text-[10px] text-gray-500 dark:text-slate-400">
                        📝 {order.deliveryNote}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action bar */}
                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                    {/* Batch select — store owner + sales manager */}
                    {canDispatch && (order.status === 'confirmed' || order.status === 'preparing') && (
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
                    {/* Primary next action */}
                    {nextAction && (
                      // delivery_staff can only mark out_for_delivery → delivered
                      canManage || nextAction.status === 'delivered' || nextAction.status === 'out_for_delivery'
                    ) && (
                      <button
                        onClick={e => updateStatus(order.id, nextAction.status, e)}
                        disabled={isUpdating}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl transition-all disabled:opacity-50 ${nextAction.color}`}>
                        {isUpdating ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : nextAction.label}
                      </button>
                    )}

                    {/* Call button — now in header */}

                    {/* Google Maps — always show for active orders */}
                    <button
                      onClick={e => { e.stopPropagation(); openGoogleMaps(order.guestAddress); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                      <Navigation className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Navigate</span>
                    </button>

                    {/* Receipt */}
                    <button
                      onClick={e => { e.stopPropagation(); printReceipt(order); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors">
                      <Receipt className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Receipt</span>
                    </button>

                    {/* Cancel — store owner only */}
                    {canManage && (order.status === 'pending' || order.status === 'confirmed') && (
                      <button
                        onClick={e => updateStatus(order.id, 'cancelled', e)}
                        disabled={isUpdating}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Cancel</span>
                      </button>
                    )}
                    {/* Failed Delivery — only for out_for_delivery */}
                    {order.status === 'out_for_delivery' && (
                      <div className="relative group">
                        <select
                          defaultValue=""
                          onChange={async e => {
                            const reason = e.target.value;
                            if (!reason) return;
                            e.target.value = '';
                            await updateStatus(order.id, 'failed_delivery', undefined, reason);
                          }}
                          onClick={e => e.stopPropagation()}
                          className="text-xs border border-orange-200 dark:border-orange-800 rounded-xl px-2.5 py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 focus:outline-none cursor-pointer font-semibold">
                          <option value="" disabled>⚠️ Delivery Failed?</option>
                          <option value="refused">Customer refused</option>
                          <option value="no_answer">No answer / door closed</option>
                          <option value="phone_off">Phone not reachable</option>
                          <option value="wrong_address">Wrong / unclear address</option>
                        </select>
                      </div>
                    )}
                    {/* Terminate — super_admin, store_owner, sales_manager only */}
                    {canTerminate && order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'failed_delivery' && order.status !== 'terminated' && (
                      <select defaultValue="" onChange={e => { const r = e.target.value; if (!r) return; e.target.value = ''; handleTerminate(order.id, r); }} onClick={e => e.stopPropagation()}
                        disabled={terminating === order.id}
                        className="text-xs border border-red-200 dark:border-red-800 rounded-xl px-2.5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 focus:outline-none cursor-pointer font-semibold disabled:opacity-50">
                        <option value="" disabled>🛑 Terminate?</option>
                        <option value="rider_unavailable">Rider unavailable</option>
                        <option value="store_closed">Store closed</option>
                        <option value="out_of_stock">Item out of stock</option>
                        <option value="technical_issue">Technical issue</option>
                        <option value="other">Other</option>
                      </select>
                    )}                  </div>
                )}



                {/* Expand toggle — items breakdown */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : order.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-t border-gray-50 dark:border-slate-700 text-xs text-gray-400 dark:text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    <span>{totalItems} item{totalItems !== 1 ? 's' : ''} · ₹{order.subtotal} + ₹{order.deliveryCharge} delivery</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="border-t border-gray-50 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/30 px-4 py-3 space-y-1.5">
                    {(order.items || []).map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-600 dark:text-slate-400">{item.productName} ({item.unit}) × {item.quantity}</span>
                        <span className="font-semibold text-gray-900 dark:text-white">₹{item.total}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 pt-1 border-t border-gray-100 dark:border-slate-600">
                      <span>Delivery</span><span>₹{order.deliveryCharge}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white pt-1 border-t border-gray-100 dark:border-slate-600">
                      <span>Total</span><span>₹{order.total}</span>
                    </div>
                    {order.notes && (
                      <p className="text-xs text-gray-500 dark:text-slate-400 pt-1">📝 {order.notes}</p>
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
              {batchSelected.length} order{batchSelected.length > 1 ? 's' : ''} selected for dispatch
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
              🛵 Start Delivery
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
