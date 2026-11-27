import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { TrendingUp, ShoppingBag, CreditCard, Wallet, Smartphone, CheckCircle, XCircle, Package, Tag, Calendar } from 'lucide-react';
import { ordersApi, productsApi, topSellingApi, type CategoryTotal, type OrderInsights, type OrderSummary, type ProductLeader, type SummaryRange } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { onOrderEvent, onOrderStreamConnect } from '../services/realtime';
import PageSkeleton from '../components/PageSkeleton';
import { DateRangeChips, istDay } from '../components/DateRangeFilter';

type Tab = 'revenue' | 'orders' | 'products';
type DateRange = 'today' | 'yesterday' | 'all' | 'custom';

const mapDateRange = (r: DateRange): SummaryRange =>
  r === 'today' ? 'today' : r === 'all' ? 'all' : 'custom';

function getYesterdayStr() {
  return istDay(-1);
}

const reportParams = (range: DateRange, customFrom: string, customTo: string) => ({
  storeId: getActiveStoreId(),
  range: mapDateRange(range),
  from: range === 'yesterday' ? getYesterdayStr() : range === 'custom' ? (customFrom || undefined) : undefined,
  to: range === 'yesterday' ? getYesterdayStr() : range === 'custom' ? (customTo || undefined) : undefined,
});

const hasValidCustomRange = (range: DateRange, customFrom: string, customTo: string) =>
  range !== 'custom' || (Boolean(customFrom) && Boolean(customTo) && customFrom <= customTo);

const PAGE_SIZE = 50;

const EMPTY_SUMMARY: OrderSummary = { placed: 0, pending: 0, confirmed: 0, delivered: 0, cancelled: 0, preparing: 0, readyToPickup: 0, outForDelivery: 0, pickedUp: 0, revenue: 0, avgOrderValue: 0, deliveryCollected: 0, freeDeliveries: 0, couponOrders: 0, couponAmount: 0, scheduledValue: 0, scheduledCouponAmount: 0, paymentBreakdown: [] };

// Live refresh for tab cards: instant on order events (weak-network friendly)
// plus a quiet 30s poll so a lost event can never leave stale figures up.
// Live refreshes pass fresh=true so they bypass the navigation cache.
function useLivePoll(refresh: (fresh?: boolean) => void) {
  useEffect(() => {
    let lastRefresh = 0;
    const onEvent = () => {
      const now = Date.now();
      if (now - lastRefresh < 2000) return;
      lastRefresh = now;
      refresh(true);
    };
    const offEvent = onOrderEvent(onEvent);
    const offConnect = onOrderStreamConnect(() => refresh(true));
    const poll = setInterval(() => refresh(true), 30000);
    return () => { offEvent(); offConnect(); clearInterval(poll); };
  }, [refresh]);
}

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe', unknown: 'Unknown' };
const PAYMENT_COLORS: Record<string, string> = {
  cod: 'bg-emerald-500', upi: 'bg-blue-500', phonepay: 'bg-violet-500', unknown: 'bg-slate-500',
};
const PAYMENT_ICONS: Record<string, React.ReactNode> = {
  cod: <Wallet className="w-3.5 h-3.5" />,
  upi: <Smartphone className="w-3.5 h-3.5" />,
  phonepay: <CreditCard className="w-3.5 h-3.5" />,
  unknown: <Package className="w-3.5 h-3.5" />,
};

function SummaryCard({ label, value, sub, icon, gradient }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; gradient: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0`}>{icon}</div>
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
      </div>
      <p className="text-xs text-gray-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function BarChart({ data, color = 'bg-emerald-500', valuePrefix = '' }: { data: Array<{ label: string; value: number; fullLabel?: string }>; color?: string; valuePrefix?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-28">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
            <div className={`w-full rounded-t-sm ${color} hover:opacity-80 transition-all duration-300`}
              style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}px`, opacity: d.value > 0 ? 1 : 0.1 }} />
            {d.value > 0 && (
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                {d.fullLabel || d.label}: {valuePrefix}{d.value}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-0.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            {d.label && <span className="text-[8px] text-gray-500 dark:text-slate-400">{d.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DateSelector({ range, setRange, customFrom, setCustomFrom, customTo, setCustomTo }: {
  range: DateRange; setRange: (r: DateRange) => void;
  customFrom: string; setCustomFrom: (s: string) => void;
  customTo: string; setCustomTo: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DateRangeChips active={range} onSelect={setRange}
        from={customFrom} to={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} />
    </div>
  );
}


// ── Revenue Tab ───────────────────────────────────────────────────────────────
function RevenueTab({ range, customFrom, customTo }: { range: DateRange; customFrom: string; customTo: string }) {
  const [summary, setSummary] = useState<OrderSummary>(EMPTY_SUMMARY);
  const [insights, setInsights] = useState<OrderInsights>({ daily: [], weekly: [] });
  const [insightsRefresh, setInsightsRefresh] = useState(0);
  const summaryReqId = useRef(0);
  const refreshInsights = useCallback(() => setInsightsRefresh(value => value + 1), []);

  const loadSummary = useCallback((fresh = false) => {
    const id = ++summaryReqId.current;
    if (!hasValidCustomRange(range, customFrom, customTo)) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    ordersApi.getSummary({ ...reportParams(range, customFrom, customTo), dateBasis: 'browse' }, { fresh })
      .then(r => { if (id === summaryReqId.current) setSummary(r.data.data || EMPTY_SUMMARY); })
      .catch(() => {});
  }, [range, customFrom, customTo]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useLivePoll(loadSummary);

  useEffect(() => { setInsights({ daily: [], weekly: [] }); }, [range, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    if (!hasValidCustomRange(range, customFrom, customTo)) {
      setInsights({ daily: [], weekly: [] });
      return () => { cancelled = true; };
    }
    ordersApi.getInsights({ ...reportParams(range, customFrom, customTo), limit: 1000 }, { fresh: true })
      .then(r => { if (!cancelled) setInsights(r.data.data || { daily: [], weekly: [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [range, customFrom, customTo, insightsRefresh]);
  useLivePoll(refreshInsights);

  const chartRows = useMemo(() => [...insights.daily].reverse(), [insights.daily]);
  const showLabel = (i: number) => chartRows.length <= 7 || i % Math.ceil(chartRows.length / 7) === 0;
  const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const dailyRevenue = chartRows.map((row, i) => ({
    label: showLabel(i) ? dayLabel(row.date) : '',
    fullLabel: dayLabel(row.date),
    value: Math.round(row.revenue),
  }));

  const totalRevenue = summary.revenue;
  const paymentBreakdown = (summary.paymentBreakdown || []).filter(p => p.count > 0);
  const onlineRevenue = paymentBreakdown.filter(p => p.method === 'upi' || p.method === 'phonepay').reduce((s, p) => s + p.revenue, 0);
  const codRevenue = paymentBreakdown.filter(p => p.method === 'cod').reduce((s, p) => s + p.revenue, 0);
  const onlinePct = totalRevenue > 0 ? Math.round((onlineRevenue / totalRevenue) * 100) : 0;
  const peakDay = dailyRevenue.reduce(
    (best, row) => (row.value > best.value ? row : best),
    { label: '', fullLabel: '', value: 0 },
  );

  const dailyTable = chartRows.map(row => ({
    date: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
    orders: row.delivered,
    revenue: row.revenue,
    avg: row.delivered ? Math.round(row.revenue / row.delivered) : 0,
  })).filter(row => row.orders > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Delivered Revenue" value={`₹${Math.round(totalRevenue).toLocaleString('en-IN')}`} sub={`${summary.delivered} delivered orders`} icon={<Wallet className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard label="Avg Order Value" value={`₹${summary.avgOrderValue.toFixed(0)}`} sub="per delivered order" icon={<TrendingUp className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
        <SummaryCard label="Online Payment Share" value={`${onlinePct}%`} sub={`App (Cash) ₹${Math.round(codRevenue).toLocaleString('en-IN')} · Online ₹${Math.round(onlineRevenue).toLocaleString('en-IN')}`} icon={<Smartphone className="w-4 h-4" />} gradient="from-violet-500 to-violet-600" />
        <SummaryCard label="Peak Revenue Day" value={`₹${peakDay.value.toLocaleString('en-IN')}`} sub={peakDay.fullLabel} icon={<Calendar className="w-4 h-4" />} gradient="from-amber-500 to-amber-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Revenue by Day</p>
          {dailyRevenue.every(d => d.value === 0) ? <p className="text-xs text-gray-500 text-center py-8">No delivered orders in this period</p> : <BarChart data={dailyRevenue} color="bg-emerald-500" valuePrefix="₹" />}
        </div>
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Payment Method Breakdown</p>
          {paymentBreakdown.length === 0 ? <p className="text-xs text-gray-500 text-center py-8">No delivered orders in this period</p> : (
            <div className="space-y-4">
              {paymentBreakdown.map(p => (
                <div key={p.method}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-lg ${PAYMENT_COLORS[p.method]} flex items-center justify-center text-white`}>{PAYMENT_ICONS[p.method]}</div>
                      <span className="text-xs font-semibold text-gray-700">{PAYMENT_LABELS[p.method]}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">₹{p.revenue.toFixed(0)}</span>
                      <span className="text-[10px] text-gray-500 ml-1.5">{p.count} orders · {totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0}%</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-600 overflow-hidden">
                    <div className={`h-full ${PAYMENT_COLORS[p.method]} rounded-full transition-all duration-500`} style={{ width: `${totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {dailyTable.length > 0 && (
        <div className="page-card">
          <div className="page-card-header"><p className="page-card-title">Revenue by Day</p></div>
          <div className="hidden sm:grid grid-cols-4 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>Date</div><div className="text-center">Delivered</div><div className="text-center">Avg Value</div><div className="text-right">Revenue</div>
          </div>
          {dailyTable.slice(0, 14).map((r, i) => (
            <div key={i} className="grid grid-cols-3 sm:grid-cols-4 gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs">
              <div className="font-medium text-gray-900 dark:text-white">{r.date}</div>
              <div className="text-right sm:text-center text-gray-600 dark:text-slate-400">{r.orders} delivered</div>
              <div className="hidden sm:block text-center text-gray-600 dark:text-slate-400">₹{r.avg}</div>
              <div className="text-right font-bold text-gray-900 dark:text-white">₹{r.revenue.toFixed(0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Orders Tab ────────────────────────────────────────────────────────────────
function OrdersTab({ range, customFrom, customTo }: { range: DateRange; customFrom: string; customTo: string }) {
  const [summary, setSummary] = useState<OrderSummary>(EMPTY_SUMMARY);
  const [insights, setInsights] = useState<OrderInsights>({ daily: [], weekly: [] });
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [page, setPage] = useState(0);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [insightsRefresh, setInsightsRefresh] = useState(0);
  const summaryReqId = useRef(0);
  const refreshInsights = useCallback(() => setInsightsRefresh(value => value + 1), []);

  useEffect(() => { setPage(0); }, [range, customFrom, customTo]);

  useEffect(() => {
    setInsights({ daily: [], weekly: [] });
    setPagination({ total: 0, hasMore: false });
  }, [range, customFrom, customTo, page]);

  useEffect(() => {
    let cancelled = false;
    setInsightsLoading(true);
    setInsightsError('');
    if (!hasValidCustomRange(range, customFrom, customTo)) {
      setInsights({ daily: [], weekly: [] });
      setPagination({ total: 0, hasMore: false });
      setInsightsError('Choose a valid custom date range.');
      setInsightsLoading(false);
      return () => { cancelled = true; };
    }
    ordersApi.getInsights({ ...reportParams(range, customFrom, customTo), limit: PAGE_SIZE, offset: page * PAGE_SIZE }, { fresh: true })
      .then(r => {
        if (cancelled) return;
        setInsights(r.data.data || { daily: [], weekly: [] });
        setPagination(r.data.pagination || { total: 0, hasMore: false });
      })
      .catch(() => {
        if (cancelled) return;
        setInsightsError('Could not load daily orders.');
      })
      .finally(() => { if (!cancelled) setInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [range, customFrom, customTo, page, insightsRefresh]);

  const loadSummary = useCallback((fresh = false) => {
    const id = ++summaryReqId.current;
    if (!hasValidCustomRange(range, customFrom, customTo)) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    ordersApi.getSummary({ ...reportParams(range, customFrom, customTo), dateBasis: 'browse' }, { fresh })
      .then(r => { if (id === summaryReqId.current) setSummary(r.data.data || EMPTY_SUMMARY); })
      .catch(() => {});
  }, [range, customFrom, customTo]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useLivePoll(loadSummary);
  useLivePoll(refreshInsights);

  const completionRate = summary.placed ? Math.round((summary.delivered / summary.placed) * 100) : 0;

  const weekBars = insights.weekly;
  const prevWeek = weekBars.length > 1 ? weekBars[weekBars.length - 2].value : 0;
  const thisWeek = weekBars.length ? weekBars[weekBars.length - 1].value : 0;
  const growth = prevWeek === 0 ? null : Math.round(((thisWeek - prevWeek) / prevWeek) * 100);

  const chartDaily = useMemo(() => [...insights.daily].reverse(), [insights.daily]);
  const showLabel = (i: number) => chartDaily.length <= 7 || i % Math.ceil(chartDaily.length / 7) === 0;

  const dailyOrders = chartDaily.map((row, index) => {
    const label = new Date(`${row.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return {
      label: showLabel(index) ? label : '',
      fullLabel: label,
      value: row.total,
    };
  });

  const dailyTable = insights.daily;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Orders" value={summary.placed} sub="in selected period" icon={<ShoppingBag className="w-4 h-4" />} gradient="from-slate-500 to-slate-600" />
        <SummaryCard label="Delivered" value={summary.delivered} sub={`${completionRate}% completion`} icon={<CheckCircle className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard label="Not Completed" value={summary.cancelled} sub="cancelled · failed · terminated" icon={<XCircle className="w-4 h-4" />} gradient="from-red-400 to-red-500" />
        <SummaryCard label="Completion Rate" value={`${completionRate}%`} sub="delivered / placed" icon={<TrendingUp className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Daily Orders</p>
          {dailyOrders.every(d => d.value === 0) ? <p className="text-xs text-gray-500 text-center py-8">No orders in this period</p> : <BarChart data={dailyOrders} color="bg-emerald-500" />}
        </div>
        <div className="page-card p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold text-gray-700">Week-over-Week Growth</p>
            {growth !== null && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {growth >= 0 ? '+' : ''}{growth}% vs last week
              </span>
            )}
          </div>
          {weekBars.every(w => w.value === 0) ? <p className="text-xs text-gray-500 text-center py-8">No orders in the last 8 weeks</p> : <BarChart data={weekBars} color="bg-blue-500" />}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {weekBars.slice(-3).map(w => (
              <div key={w.label} className="text-center bg-gray-50 dark:bg-slate-700 rounded-xl p-2">
                <p className="text-base font-bold text-gray-900 dark:text-white">{w.value}</p>
                <p className="text-[10px] text-gray-500 dark:text-slate-400">{w.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(dailyTable.length > 0 || insightsError) && (
        <div className="page-card">
          <div className="page-card-header">
            <p className="page-card-title">Orders by Day</p>
            {insightsLoading && <span className="text-[10px] text-gray-500">Updating…</span>}
          </div>
          {insightsError && <p className="px-4 py-2 text-xs text-red-600" role="alert">{insightsError}</p>}
          <div className="hidden sm:grid grid-cols-5 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>Date</div><div className="text-center">Total</div><div className="text-center">Delivered</div><div className="text-center">Cancelled</div><div className="text-right">Revenue</div>
          </div>
          {dailyTable.map(r => (
            <div key={r.date} className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs items-center">
              <div className="font-medium text-gray-900 dark:text-white">{new Date(`${r.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}</div>
              <div className="text-right sm:text-center font-semibold text-gray-900 dark:text-white">{r.total}</div>
              <div className="hidden sm:block text-center text-emerald-600 font-semibold">{r.delivered}</div>
              <div className="hidden sm:block text-center text-red-500">{r.cancelled}</div>
              <div className="hidden sm:block text-right font-bold text-gray-900 dark:text-white">₹{r.revenue.toFixed(0)}</div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              {pagination.total === 0 ? '0' : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, pagination.total)} of {pagination.total} days
            </p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || insightsLoading} onClick={() => setPage(p => p - 1)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Previous
              </button>
              <button type="button" disabled={!pagination.hasMore || insightsLoading} onClick={() => setPage(p => p + 1)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Products Tab ──────────────────────────────────────────────────────────────
function ProductsTab({ products, range, customFrom, customTo }: { products: any[]; range: DateRange; customFrom: string; customTo: string }) {
  const [category, setCategory] = useState('');
  const [leaders, setLeaders] = useState<ProductLeader[]>([]);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotal[]>([]);
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [leadersError, setLeadersError] = useState('');
  const [leadersRefresh, setLeadersRefresh] = useState(0);
  const refreshLeaders = useCallback(() => setLeadersRefresh(value => value + 1), []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p: any) => p.categoryName).filter(Boolean))).sort(),
    [products],
  );

  useEffect(() => {
    setLeaders([]);
    setCategoryTotals([]);
  }, [range, customFrom, customTo, category]);

  useEffect(() => {
    let cancelled = false;
    setLeadersLoading(true);
    setLeadersError('');
    if (!hasValidCustomRange(range, customFrom, customTo)) {
      setLeaders([]);
      setCategoryTotals([]);
      setLeadersError('Choose a valid custom date range.');
      setLeadersLoading(false);
      return () => { cancelled = true; };
    }
    topSellingApi.getLeaders({ ...reportParams(range, customFrom, customTo), category: category || undefined, limit: 20 }, { fresh: true })
      .then(r => {
        if (cancelled) return;
        setLeaders((r.data.data?.products || []) as ProductLeader[]);
        setCategoryTotals((r.data.data?.categoryTotals || []) as CategoryTotal[]);
      })
      .catch(() => {
        if (cancelled) return;
        setLeaders([]);
        setCategoryTotals([]);
        setLeadersError('Could not load top products.');
      })
      .finally(() => { if (!cancelled) setLeadersLoading(false); });
    return () => { cancelled = true; };
  }, [range, customFrom, customTo, category, leadersRefresh]);

  useLivePoll(refreshLeaders);

  const topCats = categoryTotals.slice(0, 5).map(c => [c.categoryName, c.quantitySold] as [string, number]);
  const maxCat = Math.max(...topCats.map(c => c[1]), 1);

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card">
          <div className="page-card-header flex-wrap gap-2">
            <div className="flex items-center gap-2"><Package className="w-4 h-4 text-gray-500 dark:text-slate-400" /><p className="page-card-title">Top 20 Products by Units Sold</p></div>
            <select value={category} onChange={e => setCategory(e.target.value)}
              aria-label="Filter products by category"
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {leadersError && <p className="px-4 py-2 text-xs text-red-600" role="alert">{leadersError}</p>}
          {leadersLoading && <p className="px-4 py-1 text-[10px] text-gray-500">Updating…</p>}
          {leaders.length === 0 ? <p className="text-xs text-gray-500 text-center py-8">No delivered orders yet</p> : (
            <div>
              {leaders.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-bold text-gray-500 w-5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-slate-400">{p.quantitySold} units · {p.categoryName}</p>
                  </div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">₹{p.revenue.toFixed(0)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="page-card">
          <div className="page-card-header">
            <div className="flex items-center gap-2"><Tag className="w-4 h-4 text-gray-500 dark:text-slate-400" /><p className="page-card-title">Orders by Category</p></div>
          </div>
          {topCats.length === 0 ? <p className="text-xs text-gray-500 text-center py-8">No delivered orders yet</p> : (
            <div>
              {topCats.map(([name, count], i) => (
                <div key={name} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-bold text-gray-500 w-5">#{i + 1}</span>
                  <p className="flex-1 text-xs font-semibold text-gray-900 dark:text-white truncate">{name}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-gray-100 dark:bg-slate-600 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(count / maxCat) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-900 w-6 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState(istDay());
  const [customTo, setCustomTo] = useState(istDay());

  useEffect(() => {
    productsApi.getAll()
      .then(r => setProducts(r.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSkeleton />;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'revenue',   label: 'Revenue',   icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'orders',    label: 'Orders',    icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'products',  label: 'Products',  icon: <Package className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">

      {/* Tab strip */}
      <div className="flex border-b border-gray-200 dark:border-slate-700 -mt-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all ${
              tab === t.id
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Single shared date filter — synced across all tabs */}
      <DateSelector
        range={range} setRange={setRange}
        customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo} setCustomTo={setCustomTo}
      />

      {tab === 'revenue'   && <RevenueTab   range={range} customFrom={customFrom} customTo={customTo} />}
      {tab === 'orders'    && <OrdersTab    range={range} customFrom={customFrom} customTo={customTo} />}
      {tab === 'products'  && <ProductsTab  products={products} range={range} customFrom={customFrom} customTo={customTo} />}
    </div>
  );
}
