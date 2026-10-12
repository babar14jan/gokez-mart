import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, ClipboardList, TrendingUp, Clock, XCircle, Calendar, Store, Users } from 'lucide-react';
import { ordersApi, settingsApi, customersApi, type OrderSummary, type CustomerAggregates } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { orderDisplayName } from '../utils/orderName';
import { getActiveStoreId } from '../utils/store';
import { onOrderEvent, onOrderStreamConnect } from '../services/realtime';

type Range = 'today' | '7d' | '30d' | 'custom' | 'all';

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
  if (r === 'today') return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: null };
  if (r === '7d')    return { start: new Date(now.getTime() - 7 * 86400000), end: null };
  if (r === '30d')   return { start: new Date(now.getTime() - 30 * 86400000), end: null };
  if (r === 'custom') return {
    start: from ? new Date(`${from}T00:00:00`) : null,
    end:   to   ? new Date(`${to}T23:59:59.999`) : null,
  };
  return { start: null, end: null };
}

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 Days' },
  { id: '30d',   label: '30 Days' },
  { id: 'all',   label: 'All Time' },
  { id: 'custom',label: 'Custom' },
];

export default function DashboardPage() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('today');
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));
  const [storeName, setStoreName] = useState('');
  const [summary, setSummary] = useState<OrderSummary>({ placed: 0, pending: 0, delivered: 0, cancelled: 0, revenue: 0, avgOrderValue: 0, deliveryCollected: 0, freeDeliveries: 0, couponOrders: 0, couponAmount: 0 });
  const [customerAgg, setCustomerAgg] = useState<CustomerAggregates>({ totalCustomers: 0, newCustomers: 0, repeatCustomers: 0, avgOrders: 0, top: [] });
  const { name, role } = useAuthStore();
  const canSeeCustomers = !!role && ['super_admin', 'store_owner', 'store_manager'].includes(role);

  useEffect(() => {
    settingsApi.getAll(getActiveStoreId())
      .then(r => {
        const s = (r.data.data || []).find((x: any) => x.key === 'store_name');
        if (s?.value) setStoreName(s.value);
      })
      .catch(() => {});
  }, []);

  const reqId = useRef(0);
  const EMPTY_AGG = { totalCustomers: 0, newCustomers: 0, repeatCustomers: 0, avgOrders: 0, top: [] };

  const loadAllOrders = useCallback(() =>
    ordersApi.getAll({ storeId: getActiveStoreId(), limit: 500 } as any)
      .then(o => setAllOrders(o.data.data || []))
      .catch(() => {}), []);

  // One loader for both the initial paint and every live refresh. A request id
  // guards against out-of-order responses: switching range/date fires a new
  // request immediately, and a slow reply from the previous params is dropped
  // instead of overwriting the newer figures (which looked like "data not
  // refreshing").
  const loadSummary = useCallback(() => {
    const custom = range === 'custom';
    if (custom && (!customFrom || !customTo)) return;
    const id = ++reqId.current;
    const params = { storeId: getActiveStoreId(), range, from: custom ? customFrom : undefined, to: custom ? customTo : undefined };
    ordersApi.getSummary(params)
      .then(r => { if (id === reqId.current) setSummary(r.data.data); })
      .catch(() => {});
    if (canSeeCustomers) {
      customersApi.getAggregates(params)
        .then(r => { if (id === reqId.current) setCustomerAgg(r.data.data || EMPTY_AGG); })
        .catch(() => {});
    }
  }, [range, customFrom, customTo, canSeeCustomers]);

  useEffect(() => { loadAllOrders().finally(() => setLoading(false)); }, [loadAllOrders]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const refreshLive = useCallback(() => { loadAllOrders(); loadSummary(); }, [loadAllOrders, loadSummary]);

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
    const { start, end } = rangeBounds(range, customFrom, customTo);
    return allOrders.filter(o => {
      const d = new Date(o.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [allOrders, range, customFrom, customTo]);

  const kpis = useMemo(() => ({
    total:     summary.placed,
    pending:   summary.pending,
    delivered: summary.delivered,
    cancelled: summary.cancelled,
    revenue:   summary.revenue,
  }), [summary]);

  const rangeLabel = range === 'custom'
    ? `${customFrom || '…'} – ${customTo || '…'}`
    : RANGES.find(r => r.id === range)?.label || '';
  const navigate = useNavigate();

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Greeting */}
      <div className="space-y-1">
        {/* Row 1: greeting word — store badge stays parallel to this */}
        <div className="flex items-center justify-between gap-3 px-0.5">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 leading-tight">
            {greetingWord()},
          </p>
          {storeName && (
            <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-full">
              <Store className="w-3 h-3" />
              {storeName}
            </span>
          )}
        </div>

        {/* Row 2: name — full width */}
        <p className="text-base font-extrabold text-gray-900 dark:text-white leading-tight px-0.5">
          {name || 'there'}
        </p>

        {/* Row 3: role subtitle — full width */}
        <p className="text-xs text-gray-500 dark:text-slate-400 px-0.5 whitespace-nowrap">
          {ROLE_MESSAGES[role || 'staff'] || ROLE_MESSAGES.staff}
        </p>
      </div>

      {/* Date range tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {RANGES.map(r => (
          <button key={r.id} onClick={() => setRange(r.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              range === r.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}>
            {r.id === 'custom' && <Calendar className="w-3 h-3" />}
            {r.label}
          </button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${canSeeCustomers ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 items-stretch`}>
        {[
          { label: 'Total Orders',  value: kpis.total,                    sub: `${kpis.delivered} delivered · ${kpis.cancelled} cancelled`, icon: ClipboardList, gradient: 'from-emerald-500 to-emerald-600', href: '/orders' },
          { label: 'Pending',       value: Math.max(kpis.total - kpis.delivered - kpis.cancelled, 0), sub: `${kpis.pending} awaiting confirmation`, icon: Clock, gradient: 'from-amber-500 to-amber-600', href: '/orders' },
          { label: 'Revenue',       value: `₹${kpis.revenue.toFixed(0)}`, sub: `₹${(kpis.revenue + summary.couponAmount).toFixed(0)} order value − ₹${summary.couponAmount.toFixed(0)} coupons`, icon: TrendingUp, gradient: 'from-blue-500 to-blue-600', href: null },
          ...(canSeeCustomers ? [{ label: 'Unique Customers', value: customerAgg.totalCustomers, sub: `${customerAgg.newCustomers} new · ${customerAgg.repeatCustomers} repeat`, icon: Users, gradient: 'from-cyan-500 to-cyan-600', href: null }] : []),
        ].map(k => {
          const inner = (
            <div onClick={() => k.href && navigate(k.href)}
              className={`kpi-card group h-full ${!k.href ? 'cursor-default hover:border-gray-200 dark:hover:border-slate-700' : 'cursor-pointer'}`}>
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${k.gradient} flex items-center justify-center flex-shrink-0`}>
                <k.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">{k.value}</p>
                <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mt-1">{k.label}</p>
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
              <span className="text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{rangeLabel}</span>
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
