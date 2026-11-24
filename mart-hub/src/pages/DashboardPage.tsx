import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, ClipboardList, TrendingUp, Clock, XCircle, Users } from 'lucide-react';
import { ordersApi, customersApi, type OrderSummary, type CustomerAggregates } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { orderDisplayName } from '../utils/orderName';
import { orderBrowseDate } from '../utils/orderDate';
import { getActiveStoreId } from '../utils/store';
import { onOrderEvent, onOrderStreamConnect } from '../services/realtime';
import PageSkeleton from '../components/PageSkeleton';
import { DATE_RANGE_OPTIONS, CustomDateInputs, DateRangeChips, ScheduledFilterButton, type DateRangeId } from '../components/DateRangeFilter';

type Range = 'today' | 'yesterday' | 'custom' | 'all';

const wholeRupees = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

const ROLE_MESSAGES: Record<string, string> = {
  super_admin:    'Here\u2019s the overview across your stores.',
  store_owner:    'Here\u2019s how your store is performing.',
  store_manager:  'Here\u2019s the store overview.',
  delivery_staff: 'Here\u2019s your delivery summary.',
  staff:          'Here\u2019s what\u2019s happening.',
};

function greetingWord(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 21) return 'Good evening';
  return 'Good night';
}

const STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  confirmed:        'bg-blue-100 text-blue-700',
  preparing:        'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-violet-100 text-violet-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-700',
};

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe' };

const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Local-time day bounds for a range. Custom dates are read as local calendar
   days (via `T00:00:00`), not UTC, so a single-day pick includes the whole
   local day instead of losing the early hours to a timezone shift. */
function rangeBounds(r: Range, from: string, to: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (r === 'today')     return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: null };
  if (r === 'yesterday') return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999) };
  if (r === 'custom') return {
    start: from ? new Date(`${from}T00:00:00`) : null,
    end:   to   ? new Date(`${to}T23:59:59.999`) : null,
  };
  return { start: null, end: null };
}

export default function DashboardPage() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('today');
  const [scheduledView, setScheduledView] = useState(false);
  const prevRangeRef = useRef<Range>('today');
  const handleRangeSelect = (id: DateRangeId) => {
    setScheduledView(false);
    if (id !== 'custom') { setRange(id); return; }
    if (range === 'custom') { setRange(prevRangeRef.current); return; }
    prevRangeRef.current = range;
    setRange('custom');
  };
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [summary, setSummary] = useState<OrderSummary>({ placed: 0, pending: 0, confirmed: 0, delivered: 0, cancelled: 0, preparing: 0, readyToPickup: 0, outForDelivery: 0, pickedUp: 0, revenue: 0, avgOrderValue: 0, deliveryCollected: 0, freeDeliveries: 0, couponOrders: 0, couponAmount: 0 });
  const [customerAgg, setCustomerAgg] = useState<CustomerAggregates>({ totalCustomers: 0, newCustomers: 0, repeatCustomers: 0, avgOrders: 0, top: [] });
  const { name, role } = useAuthStore();
  const canSeeCustomers = !!role && ['super_admin', 'store_owner', 'store_manager'].includes(role);

  const reqId = useRef(0);
  const EMPTY_AGG = { totalCustomers: 0, newCustomers: 0, repeatCustomers: 0, avgOrders: 0, top: [] };

  const loadAllOrders = useCallback((fresh = false) =>
    ordersApi.getAll({ storeId: getActiveStoreId(), limit: 500 } as any, { fresh })
      .then(o => setAllOrders(o.data.data || []))
      .catch(() => {}), []);

  // One loader for both the initial paint and every live refresh. A request id
  // guards against out-of-order responses: switching range/date fires a new
  // request immediately, and a slow reply from the previous params is dropped
  // instead of overwriting the newer figures (which looked like "data not
  // refreshing").
  const loadSummary = useCallback((fresh = false) => {
    const custom = range === 'custom';
    if (custom && (!customFrom || !customTo)) return;
    const id = ++reqId.current;
    const yesterday = toDateStr(new Date(new Date().setDate(new Date().getDate() - 1)));
    const params = {
      storeId: getActiveStoreId(),
      range: (range === 'yesterday' ? 'custom' : range) as import('../services/api').SummaryRange,
      from: range === 'yesterday' ? yesterday : (custom ? customFrom : undefined),
      to: range === 'yesterday' ? yesterday : (custom ? customTo : undefined),
      dateBasis: 'browse' as const,
    };
    ordersApi.getSummary(params, { fresh })
      .then(r => { if (id === reqId.current) setSummary(r.data.data); })
      .catch(() => {});
    if (canSeeCustomers) {
      customersApi.getAggregates(params, { fresh })
        .then(r => { if (id === reqId.current) setCustomerAgg(r.data.data || EMPTY_AGG); })
        .catch(() => {});
    }
  }, [range, customFrom, customTo, canSeeCustomers]);

  useEffect(() => { loadAllOrders().finally(() => setLoading(false)); }, [loadAllOrders]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Live refresh hits the server (fresh=true); the initial paint may use cache.
  const refreshLive = useCallback(() => { loadAllOrders(true); loadSummary(true); }, [loadAllOrders, loadSummary]);

  // Live refresh: instant via SSE events plus a polling fallback so cards and
  // the recent-orders list stay current even on a weak/flaky connection.
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh < 2000) return;
      lastRefresh = now;
      refreshLive();
    };
    const offEvent = onOrderEvent(refresh);
    const offConnect = onOrderStreamConnect(refreshLive);
    const poll = setInterval(refreshLive, 30000);
    return () => { offEvent(); offConnect(); clearInterval(poll); };
  }, [refreshLive]);

  const filtered = useMemo(() => {
    if (scheduledView) {
      return allOrders.filter(o => o.deliveryPreference === 'scheduled' && !['delivered','cancelled','failed_delivery','terminated'].includes(o.status));
    }
    const { start, end } = rangeBounds(range, customFrom, customTo);
    return allOrders.filter(o => {
      const d = orderBrowseDate(o);
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (range === 'today' && o.deliveryPreference === 'scheduled' && !['delivered','cancelled','failed_delivery','terminated'].includes(o.status) && new Date(o.scheduledFor) >= new Date(new Date().setHours(0,0,0,0) + 86400000)) return false;
      return true;
    });
  }, [allOrders, range, customFrom, customTo, scheduledView]);

  const scheduledCount = useMemo(
    () => allOrders.filter(o =>
      o.deliveryPreference === 'scheduled' && !['delivered', 'cancelled', 'failed_delivery', 'terminated'].includes(o.status),
    ).length,
    [allOrders],
  );

  const localStatusCounts = useMemo(() => ({
    pending: filtered.filter(o => o.status === 'pending').length,
    confirmed: filtered.filter(o => o.status === 'confirmed').length,
    delivered: filtered.filter(o => o.status === 'delivered').length,
    cancelled: filtered.filter(o => ['cancelled', 'failed_delivery', 'terminated'].includes(o.status)).length,
    preparing: filtered.filter(o => o.status === 'preparing').length,
    readyToPickup: filtered.filter(o => o.status === 'ready_to_pickup').length,
    outForDelivery: filtered.filter(o => o.status === 'out_for_delivery').length,
    pickedUp: filtered.filter(o => o.status === 'picked_up').length,
  }), [filtered]);

  const localRevenue = useMemo(
    () => filtered.filter(o => o.status === 'delivered').reduce((sum, o) => sum + (Number(o.total) || 0), 0),
    [filtered],
  );

  const localCouponAmount = useMemo(
    () => filtered.filter(o => !['cancelled', 'failed_delivery', 'terminated'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.campaignDiscount) || 0), 0),
    [filtered],
  );

  const localOrderValue = useMemo(
    () => filtered.filter(o => !['cancelled', 'failed_delivery', 'terminated'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0),
    [filtered],
  );

  const kpis = useMemo(() => {
    const inProgress = localStatusCounts.pending + localStatusCounts.confirmed + localStatusCounts.preparing
      + localStatusCounts.readyToPickup + localStatusCounts.outForDelivery + localStatusCounts.pickedUp;
    const local = {
      total: filtered.length,
      pending: localStatusCounts.pending,
      confirmed: localStatusCounts.confirmed,
      delivered: localStatusCounts.delivered,
      cancelled: localStatusCounts.cancelled,
      preparing: localStatusCounts.preparing,
      readyToPickup: localStatusCounts.readyToPickup,
      outForDelivery: localStatusCounts.outForDelivery,
      pickedUp: localStatusCounts.pickedUp,
      inProgress,
      revenue: scheduledView ? 0 : localRevenue,
    };
    if (scheduledView || filtered.length > 0) return local;
    return {
      total: summary.placed,
      pending: summary.pending,
      confirmed: summary.confirmed,
      delivered: summary.delivered,
      cancelled: summary.cancelled,
      preparing: summary.preparing,
      readyToPickup: summary.readyToPickup,
      outForDelivery: summary.outForDelivery,
      pickedUp: summary.pickedUp,
      inProgress: summary.pending + summary.confirmed + summary.preparing + summary.readyToPickup + summary.outForDelivery + summary.pickedUp,
      revenue: summary.revenue,
    };
  }, [scheduledView, filtered, localStatusCounts, localRevenue, summary]);

  const displayCustomerAgg = useMemo(() => {
    const phones = new Set(filtered.map((o) => o.guestPhone).filter(Boolean));
    const hasBackendAgg = customerAgg.totalCustomers > 0 || customerAgg.newCustomers > 0 || customerAgg.repeatCustomers > 0;
    const base = hasBackendAgg ? customerAgg : { totalCustomers: phones.size, newCustomers: phones.size, repeatCustomers: 0, avgOrders: 0, top: [] };
    return { ...base, totalCustomers: scheduledView || filtered.length > 0 ? phones.size : base.totalCustomers };
  }, [scheduledView, filtered, customerAgg]);

  const rangeLabel = range === 'custom'
    ? `${customFrom || '…'} – ${customTo || '…'}`
    : DATE_RANGE_OPTIONS.find(r => r.id === range)?.label || '';
  const inProgressSub = [
    kpis.pending > 0 ? `${kpis.pending} pending` : '',
    kpis.confirmed > 0 ? `${kpis.confirmed} confirmed` : '',
    kpis.preparing > 0 ? `${kpis.preparing} preparing` : '',
    kpis.readyToPickup > 0 ? `${kpis.readyToPickup} ready` : '',
    kpis.outForDelivery > 0 ? `${kpis.outForDelivery} out` : '',
    kpis.pickedUp > 0 ? `${kpis.pickedUp} picked up` : '',
  ].filter(Boolean).join(' · ') || 'No active orders';
  const scheduledValue = filtered.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const scheduledCoupon = filtered.reduce((sum, order) => sum + (Number(order.campaignDiscount) || 0), 0);
  const couponValue = scheduledView ? scheduledCoupon
    : filtered.length > 0 ? localCouponAmount : summary.couponAmount;
  const rawOrderValue = scheduledView ? scheduledValue
    : filtered.length > 0 ? localOrderValue : kpis.revenue + couponValue;
  const displayRevenue = wholeRupees(scheduledView ? scheduledValue : kpis.revenue);
  const displayCouponAmount = wholeRupees(couponValue);
  const displayOrderValue = wholeRupees(rawOrderValue);
  const revenueSub = scheduledView && filtered.length === 0
    ? 'No scheduled orders'
    : `₹${displayOrderValue.toFixed(0)} order value − ₹${displayCouponAmount.toFixed(0)} coupons`;
  const navigate = useNavigate();

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-4">

      {/* Greeting */}
      <div className="space-y-1">
        {/* Greeting + name on one line */}
        <p className="text-base font-extrabold text-gray-900 dark:text-white leading-tight px-0.5">
          {greetingWord()}, {name || 'there'}
        </p>

        {/* Row 3: role subtitle — full width */}
        <p className="text-xs text-gray-500 dark:text-slate-400 px-0.5 whitespace-nowrap">
          {ROLE_MESSAGES[role || 'staff'] || ROLE_MESSAGES.staff}
        </p>
      </div>

      {/* Date range chips */}
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        <DateRangeChips active={scheduledView ? '' : range} onSelect={handleRangeSelect}
          showCustomInputs={false} />
        <ScheduledFilterButton active={scheduledView} count={scheduledCount}
          onClick={() => setScheduledView(true)} />
      </div>
      <CustomDateInputs active={scheduledView ? '' : range} from={customFrom} to={customTo}
        onFromChange={setCustomFrom} onToChange={setCustomTo} />

      {/* KPI cards */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${canSeeCustomers ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 items-stretch`}>
        {[
          { label: 'Total Orders',  value: kpis.total,                    sub: `${kpis.delivered} delivered · ${kpis.cancelled} cancelled`, icon: ClipboardList, gradient: 'from-emerald-500 to-emerald-600', href: '/orders' },
          { label: 'In-progress',   value: kpis.inProgress,               sub: inProgressSub, icon: Clock, gradient: 'from-amber-500 to-amber-600', href: null },
          { label: scheduledView ? 'Scheduled Value' : 'Revenue', value: `₹${displayRevenue.toFixed(0)}`, sub: revenueSub, icon: TrendingUp, gradient: 'from-blue-500 to-blue-600', href: null },
          ...(canSeeCustomers ? [{ label: 'Unique Customers', value: displayCustomerAgg.totalCustomers, sub: scheduledView ? `${displayCustomerAgg.totalCustomers} scheduled` : `${displayCustomerAgg.newCustomers} new · ${displayCustomerAgg.repeatCustomers} repeat`, icon: Users, gradient: 'from-cyan-500 to-cyan-600', href: null }] : []),
        ].map(k => {
          const inner = (
            <div onClick={() => k.href && navigate(k.href)}
              className={`kpi-card group h-full ${!k.href ? 'cursor-default hover:border-gray-200 dark:hover:border-slate-700' : 'cursor-pointer'}`}>
              <div className="flex items-center gap-3 w-full min-w-0">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${k.gradient} flex items-center justify-center flex-shrink-0`}>
                  <k.icon className="w-4 h-4 text-white" />
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{k.value}</p>
              </div>
              <div className="min-w-0 w-full">
                <p className="text-xs font-semibold text-gray-600 dark:text-slate-300">{k.label}</p>
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 mt-1">{k.sub}</p>
              </div>
            </div>
          );
          return k.href
            ? <Link key={k.label} to={k.href} className="h-full block">{inner}</Link>
            : <div key={k.label} className="h-full">{inner}</div>;
        })}
      </div>

      {/* Order status chart sits above Recent Orders */}
      <div className="flex flex-col gap-4">

        {/* Recent orders */}
        <div className="order-2 page-card">
          <div className="page-card-header">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-gray-500 dark:text-slate-400" />
              <h2 className="page-card-title">Recent Orders</h2>
            <span className="text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{scheduledView ? 'Scheduled' : rangeLabel}</span>
            </div>
            <Link to="/orders" className="text-xs font-medium text-emerald-600 hover:text-emerald-700">View all →</Link>
          </div>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-slate-400">
              <ShoppingBag className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No orders for this period</p>
            </div>
          ) : (
            <div>
              <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <div className="col-span-2">Order</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Customer</div>
                <div className="col-span-2">Phone</div>
                <div className="col-span-1">Payment</div>
                <div className="col-span-1 text-right">Items</div>
                <div className="col-span-1 text-right">Total</div>
              </div>
              {filtered.slice(0, 8).map(order => (
                <div key={order.id} className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors items-center">
                  <div className="sm:hidden flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">Order #{order.orderNumber}</p>
                        <span className={`badge ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>{order.status.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{orderDisplayName(order)} · {order.guestPhone} · {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">₹{order.total}</p>
                  </div>
                  <div className="hidden sm:block col-span-2">
                    <p className="text-xs font-bold text-gray-900 dark:text-white">Order #{order.orderNumber}</p>
                    <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
                      {new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="hidden sm:block col-span-2">
                    <span className={`badge ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>{order.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="hidden sm:block col-span-3">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{orderDisplayName(order)}</p>
                    <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate">{order.guestAddress?.split(',')[0]}</p>
                  </div>
                  <div className="hidden sm:block col-span-2 text-xs text-gray-600 dark:text-slate-400">{order.guestPhone}</div>
                  <div className="hidden sm:block col-span-1 text-xs text-gray-600 dark:text-slate-400">{PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</div>
                  <div className="hidden sm:block col-span-1 text-right text-xs text-gray-500 dark:text-slate-400">{(order.items || []).reduce((s: number, i: any) => s + i.quantity, 0)}</div>
                  <div className="hidden sm:block col-span-1 text-right text-sm font-bold text-gray-900 dark:text-white">₹{order.total}</div>
                </div>
              ))}
              {filtered.length > 8 && (
                <div className="px-4 py-3 text-center border-t border-gray-50 dark:border-slate-700">
                  <Link to="/orders" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                    +{filtered.length - 8} more orders → View all
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Order status breakdown — vertical bar chart */}
        <div className="order-1 page-card">
          <div className="page-card-header">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gray-500 dark:text-slate-400" />
              <h2 className="page-card-title">Order Status</h2>
            </div>
            <span className="text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{rangeLabel}</span>
          </div>
          <div className="p-4">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-gray-500 dark:text-slate-400">
                <XCircle className="w-6 h-6 mb-1 opacity-30" />
                <p className="text-xs">No orders for this period</p>
              </div>
            ) : (() => {
              const bars = range === 'today'
                ? [
                    { label: 'Pending',    keys: ['pending'],                                                    color: 'bg-amber-400',   textColor: 'text-amber-600 dark:text-amber-400' },
                    { label: 'Confirmed',  keys: ['confirmed'],                                                  color: 'bg-blue-400',    textColor: 'text-blue-600 dark:text-blue-400' },
                    { label: 'Preparing',  keys: ['preparing', 'ready_to_pickup'],                              color: 'bg-indigo-400',  textColor: 'text-indigo-600 dark:text-indigo-400' },
                    { label: 'On Way',     keys: ['out_for_delivery', 'picked_up'],                             color: 'bg-violet-400',  textColor: 'text-violet-600 dark:text-violet-400' },
                    { label: 'Delivered',  keys: ['delivered'],                                                  color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Cancelled',  keys: ['cancelled', 'failed_delivery', 'terminated'],                color: 'bg-red-400',     textColor: 'text-red-500 dark:text-red-400' },
                  ]
                : [
                    { label: 'Delivered',  keys: ['delivered'],                                                  color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Cancelled',  keys: ['cancelled', 'failed_delivery', 'terminated'],                color: 'bg-red-400',     textColor: 'text-red-500 dark:text-red-400' },
                    { label: 'In Progress',keys: ['pending','confirmed','preparing','ready_to_pickup','out_for_delivery','picked_up'], color: 'bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400' },
                  ];

              const counts = bars.map(b => ({
                ...b,
                count: filtered.filter(o => b.keys.includes(o.status)).length,
              }));
              const maxCount = Math.max(...counts.map(b => b.count), 1);
              return (
                <>
                  {/* Chart area */}
                  <div className="flex items-end justify-center gap-3 h-32 mb-3">
                    {counts.map(bar => {
                      const heightPct = bar.count > 0 ? Math.max((bar.count / maxCount) * 100, 8) : 0;
                      return (
                        <div key={bar.label} className="flex flex-col items-center gap-1 w-14">
                          {/* Count on top */}
                          <span className={`text-xs font-bold ${bar.count > 0 ? bar.textColor : 'text-gray-500 dark:text-slate-400'}`}>
                            {bar.count}
                          </span>
                          {/* Bar */}
                          <div className="w-full flex items-end" style={{ height: '80px' }}>
                            <div
                              className={`w-full rounded-t-lg transition-all duration-700 ${bar.count > 0 ? bar.color : 'bg-gray-100 dark:bg-slate-700'}`}
                              style={{ height: bar.count > 0 ? `${heightPct}%` : '4px' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Labels */}
                  <div className="flex justify-center gap-3">
                    {counts.map(bar => (
                      <div key={bar.label} className="w-14 text-center">
                        <p className="text-[9px] font-semibold text-gray-500 dark:text-slate-400 leading-tight">{bar.label}</p>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
