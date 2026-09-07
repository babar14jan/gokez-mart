import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, ShoppingBag, Users, CreditCard, Wallet, Smartphone, CheckCircle, XCircle, Star, Package, Tag, Calendar } from 'lucide-react';
import { ordersApi, productsApi, customersApi, categoriesApi } from '../services/api';

type Tab = 'revenue' | 'orders' | 'customers';
type DateRange = 'today' | 'week' | 'month' | 'last_month' | 'custom';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe' };
const PAYMENT_COLORS: Record<string, string> = {
  cod: 'bg-emerald-500', upi: 'bg-blue-500', phonepay: 'bg-violet-500',
};
const PAYMENT_ICONS: Record<string, React.ReactNode> = {
  cod: <Wallet className="w-3.5 h-3.5" />,
  upi: <Smartphone className="w-3.5 h-3.5" />,
  phonepay: <CreditCard className="w-3.5 h-3.5" />,
};

function SummaryCard({ label, value, sub, icon, gradient }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; gradient: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-3`}>{icon}</div>
      <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
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
            {d.label && <span className="text-[8px] text-gray-400 dark:text-slate-500">{d.label}</span>}
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
  const tabs: { id: DateRange; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: '7 Days' },
    { id: 'month', label: '30 Days' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'custom', label: 'Custom' },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {tabs.map(t => (
        <button key={t.id} onClick={() => setRange(t.id)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${range === t.id ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'}`}>
          {t.id === 'custom' && <Calendar className="w-3 h-3" />}{t.label}
        </button>
      ))}
      {range === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          <span className="text-xs text-gray-400 dark:text-slate-500">to</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
        </div>
      )}
    </div>
  );
}

function getDateBounds(range: DateRange, customFrom: string, customTo: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000 - 1);
    return { start, end };
  }
  if (range === 'week') return { start: new Date(now.getTime() - 7 * 86400000), end: null };
  if (range === 'month') return { start: new Date(now.getTime() - 30 * 86400000), end: null };
  if (range === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { start, end };
  }
  if (range === 'custom' && customFrom && customTo) {
    const end = new Date(customTo); end.setHours(23, 59, 59, 999);
    return { start: new Date(customFrom), end };
  }
  return { start: null, end: null };
}

function filterByDate(orders: any[], range: DateRange, customFrom: string, customTo: string) {
  const { start, end } = getDateBounds(range, customFrom, customTo);
  return orders.filter(o => {
    const d = new Date(o.createdAt);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

function getDays(range: DateRange, customFrom: string, customTo: string): Date[] {
  const { start, end } = getDateBounds(range, customFrom, customTo);
  const now = new Date();
  const s = start || new Date(now.getTime() - 30 * 86400000);
  const e = end || now;
  const days: Date[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  while (cur <= e) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  return days;
}


// ── Revenue Tab ───────────────────────────────────────────────────────────────
function RevenueTab({ orders }: { orders: any[] }) {
  const [range, setRange] = useState<DateRange>('month');
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));

  const filtered = useMemo(() => filterByDate(orders, range, customFrom, customTo), [orders, range, customFrom, customTo]);
  const delivered = filtered.filter(o => o.status === 'delivered');
  const totalRevenue = delivered.reduce((s, o) => s + o.total, 0);
  const avgOrderValue = delivered.length ? totalRevenue / delivered.length : 0;
  const deliveryRevenue = filtered.reduce((s, o) => s + (o.deliveryCharge || 0), 0);
  const freeDeliveries = filtered.filter(o => o.deliveryCharge === 0).length;

  const days = useMemo(() => getDays(range, customFrom, customTo), [range, customFrom, customTo]);
  const showLabel = (i: number) => days.length <= 7 || i % Math.ceil(days.length / 7) === 0;

  const dailyRevenue = days.map(d => ({
    label: showLabel(days.indexOf(d)) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
    fullLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    value: Math.round(delivered.filter(o => new Date(o.createdAt).toDateString() === d.toDateString()).reduce((s, o) => s + o.total, 0)),
  }));

  const paymentBreakdown = ['cod', 'upi', 'phonepay'].map(m => ({
    method: m,
    count: delivered.filter(o => o.paymentMethod === m).length,
    revenue: delivered.filter(o => o.paymentMethod === m).reduce((s, o) => s + o.total, 0),
  })).filter(p => p.count > 0);

  const dailyTable = days.map(d => {
    const dayOrders = filtered.filter(o => new Date(o.createdAt).toDateString() === d.toDateString());
    const dayDelivered = dayOrders.filter(o => o.status === 'delivered');
    return {
      date: d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
      orders: dayOrders.length,
      revenue: dayDelivered.reduce((s, o) => s + o.total, 0),
      avg: dayDelivered.length ? Math.round(dayDelivered.reduce((s, o) => s + o.total, 0) / dayDelivered.length) : 0,
    };
  }).filter(r => r.orders > 0).reverse();

  return (
    <div className="space-y-6">
      <DateSelector range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Revenue" value={`₹${totalRevenue.toFixed(0)}`} sub="delivered orders" icon={<TrendingUp className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard label="Avg Order Value" value={`₹${avgOrderValue.toFixed(0)}`} sub="per delivered order" icon={<TrendingUp className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
        <SummaryCard label="Delivery Collected" value={`₹${deliveryRevenue.toFixed(0)}`} sub="delivery charges" icon={<TrendingUp className="w-4 h-4" />} gradient="from-violet-500 to-violet-600" />
        <SummaryCard label="Free Deliveries" value={freeDeliveries} sub="orders above threshold" icon={<CheckCircle className="w-4 h-4" />} gradient="from-amber-500 to-amber-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Revenue by Day</p>
          {dailyRevenue.every(d => d.value === 0) ? <p className="text-xs text-gray-400 text-center py-8">No delivered orders in this period</p> : <BarChart data={dailyRevenue} color="bg-emerald-500" valuePrefix="₹" />}
        </div>
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Payment Method Breakdown</p>
          {paymentBreakdown.length === 0 ? <p className="text-xs text-gray-400 text-center py-8">No delivered orders in this period</p> : (
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
                      <span className="text-[10px] text-gray-400 ml-1.5">{p.count} orders · {totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0}%</span>
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
          <div className="hidden sm:grid grid-cols-4 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            <div>Date</div><div className="text-center">Orders</div><div className="text-center">Avg Value</div><div className="text-right">Revenue</div>
          </div>
          {dailyTable.slice(0, 14).map((r, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs">
              <div className="font-medium text-gray-900 dark:text-white">{r.date}</div>
              <div className="sm:text-center text-gray-600 text-right sm:text-left">{r.orders} orders</div>
              <div className="hidden sm:block text-center text-gray-600 dark:text-slate-400">₹{r.avg}</div>
              <div className="hidden sm:block text-right font-bold text-gray-900 dark:text-white">₹{r.revenue.toFixed(0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Orders Tab ────────────────────────────────────────────────────────────────
function OrdersTab({ orders }: { orders: any[] }) {
  const [range, setRange] = useState<DateRange>('month');
  const [customFrom, setCustomFrom] = useState(toDateStr(new Date()));
  const [customTo, setCustomTo] = useState(toDateStr(new Date()));

  const filtered = useMemo(() => filterByDate(orders, range, customFrom, customTo), [orders, range, customFrom, customTo]);
  const delivered = filtered.filter(o => o.status === 'delivered').length;
  const cancelled = filtered.filter(o => o.status === 'cancelled').length;
  const completionRate = filtered.length ? Math.round((delivered / filtered.length) * 100) : 0;

  const now = new Date();
  const thisWeek = orders.filter(o => new Date(o.createdAt) >= new Date(now.getTime() - 7 * 86400000)).length;
  const lastWeek = orders.filter(o => { const d = new Date(o.createdAt); return d >= new Date(now.getTime() - 14 * 86400000) && d < new Date(now.getTime() - 7 * 86400000); }).length;
  const twoWeeksAgo = orders.filter(o => { const d = new Date(o.createdAt); return d >= new Date(now.getTime() - 21 * 86400000) && d < new Date(now.getTime() - 14 * 86400000); }).length;
  const growth = lastWeek === 0 ? null : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

  const days = useMemo(() => getDays(range, customFrom, customTo), [range, customFrom, customTo]);
  const showLabel = (i: number) => days.length <= 7 || i % Math.ceil(days.length / 7) === 0;

  const dailyOrders = days.map(d => ({
    label: showLabel(days.indexOf(d)) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
    fullLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    value: filtered.filter(o => new Date(o.createdAt).toDateString() === d.toDateString()).length,
  }));

  const weekBars = [
    { label: '2w ago', value: twoWeeksAgo },
    { label: 'Last wk', value: lastWeek },
    { label: 'This wk', value: thisWeek },
  ];

  const dailyTable = days.map(d => {
    const dayOrders = filtered.filter(o => new Date(o.createdAt).toDateString() === d.toDateString());
    return {
      date: d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
      total: dayOrders.length,
      delivered: dayOrders.filter(o => o.status === 'delivered').length,
      cancelled: dayOrders.filter(o => o.status === 'cancelled').length,
      revenue: dayOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0),
    };
  }).filter(r => r.total > 0).reverse();

  return (
    <div className="space-y-6">
      <DateSelector range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Orders" value={filtered.length} sub="in selected period" icon={<ShoppingBag className="w-4 h-4" />} gradient="from-slate-500 to-slate-600" />
        <SummaryCard label="Delivered" value={delivered} sub={`${completionRate}% completion`} icon={<CheckCircle className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard label="Cancelled" value={cancelled} sub="not completed" icon={<XCircle className="w-4 h-4" />} gradient="from-red-400 to-red-500" />
        <SummaryCard label="Completion Rate" value={`${completionRate}%`} sub="delivered / total" icon={<TrendingUp className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Daily Orders</p>
          {dailyOrders.every(d => d.value === 0) ? <p className="text-xs text-gray-400 text-center py-8">No orders in this period</p> : <BarChart data={dailyOrders} color="bg-emerald-500" />}
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
          <BarChart data={weekBars} color="bg-blue-500" />
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[{ label: '2 weeks ago', value: twoWeeksAgo }, { label: 'Last week', value: lastWeek }, { label: 'This week', value: thisWeek }].map(w => (
              <div key={w.label} className="text-center bg-gray-50 dark:bg-slate-700 rounded-xl p-2">
                <p className="text-base font-bold text-gray-900 dark:text-white">{w.value}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500">{w.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {dailyTable.length > 0 && (
        <div className="page-card">
          <div className="page-card-header"><p className="page-card-title">Orders by Day</p></div>
          <div className="hidden sm:grid grid-cols-5 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            <div>Date</div><div className="text-center">Total</div><div className="text-center">Delivered</div><div className="text-center">Cancelled</div><div className="text-right">Revenue</div>
          </div>
          {dailyTable.slice(0, 14).map((r, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 text-xs items-center">
              <div className="font-medium text-gray-900 dark:text-white">{r.date}</div>
              <div className="text-right sm:text-center font-semibold text-gray-900 dark:text-white">{r.total}</div>
              <div className="hidden sm:block text-center text-emerald-600 font-semibold">{r.delivered}</div>
              <div className="hidden sm:block text-center text-red-500">{r.cancelled}</div>
              <div className="hidden sm:block text-right font-bold text-gray-900 dark:text-white">₹{r.revenue.toFixed(0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Customers Tab ─────────────────────────────────────────────────────────────
function CustomersTab({ orders, customers, products }: { orders: any[]; customers: any[]; products: any[]; categories?: any[] }) {
  const repeatCustomers = customers.filter((c: any) => c.orderCount >= 2).length;
  const avgOrders = customers.length ? (customers.reduce((s: number, c: any) => s + c.orderCount, 0) / customers.length).toFixed(1) : '0';
  const topCustomers = [...customers].sort((a: any, b: any) => b.totalSpent - a.totalSpent).slice(0, 10);

  const productCount: Record<string, { name: string; units: number; revenue: number }> = {};
  for (const order of orders) {
    for (const item of (order.items || [])) {
      if (!productCount[item.productName]) productCount[item.productName] = { name: item.productName, units: 0, revenue: 0 };
      productCount[item.productName].units += item.quantity;
      productCount[item.productName].revenue += item.total;
    }
  }
  const topProducts = Object.values(productCount).sort((a, b) => b.units - a.units).slice(0, 5);

  const catCount: Record<string, number> = {};
  for (const order of orders) {
    for (const item of (order.items || [])) {
      const prod = products.find((p: any) => p.name === item.productName);
      const cat = prod?.categoryName || 'Others';
      catCount[cat] = (catCount[cat] || 0) + item.quantity;
    }
  }
  const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCat = Math.max(...topCats.map(c => c[1]), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Total Customers" value={customers.length} sub="registered via orders" icon={<Users className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
        <SummaryCard label="Repeat Customers" value={repeatCustomers} sub="ordered 2+ times" icon={<Star className="w-4 h-4" />} gradient="from-amber-500 to-amber-600" />
        <SummaryCard label="Avg Orders" value={avgOrders} sub="per customer" icon={<ShoppingBag className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="page-card">
          <div className="page-card-header">
            <div className="flex items-center gap-2"><Package className="w-4 h-4 text-gray-400 dark:text-slate-500" /><p className="page-card-title">Top Products by Units Sold</p></div>
          </div>
          {topProducts.length === 0 ? <p className="text-xs text-gray-400 text-center py-8">No order data yet</p> : (
            <div>
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">{p.units} units sold</p>
                  </div>
                  <p className="text-xs font-bold text-gray-900 dark:text-white">₹{p.revenue.toFixed(0)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="page-card">
          <div className="page-card-header">
            <div className="flex items-center gap-2"><Tag className="w-4 h-4 text-gray-400 dark:text-slate-500" /><p className="page-card-title">Orders by Category</p></div>
          </div>
          {topCats.length === 0 ? <p className="text-xs text-gray-400 text-center py-8">No order data yet</p> : (
            <div>
              {topCats.map(([name, count], i) => (
                <div key={name} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
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

      <div className="page-card">
        <div className="page-card-header"><div className="flex items-center gap-2"><Users className="w-4 h-4 text-gray-400 dark:text-slate-500" /><p className="page-card-title">Top Customers by Spend</p></div></div>
        {topCustomers.length === 0 ? <p className="text-xs text-gray-400 text-center py-8">No customers yet</p> : (
          <div>
            <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700 border-b border-gray-100 dark:border-slate-600 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <div className="col-span-1">#</div><div className="col-span-4">Customer</div><div className="col-span-3">Phone</div><div className="col-span-2 text-center">Orders</div><div className="col-span-2 text-right">Spent</div>
            </div>
            {topCustomers.map((c: any, i: number) => (
              <div key={c.id} className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/50 items-center">
                <div className="sm:hidden flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-emerald-700">{(c.name || c.phone)[0].toUpperCase()}</span>
                    </div>
                    <div><p className="text-xs font-semibold text-gray-900 dark:text-white">{c.name || 'Guest'}</p><p className="text-[10px] text-gray-400 dark:text-slate-500">{c.phone} · {c.orderCount} orders</p></div>
                  </div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">₹{c.totalSpent.toFixed(0)}</p>
                </div>
                <div className="hidden sm:block col-span-1 text-xs font-bold text-gray-400 dark:text-slate-500">#{i + 1}</div>
                <div className="hidden sm:flex col-span-4 items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-emerald-700">{(c.name || c.phone)[0].toUpperCase()}</span>
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{c.name || 'Guest'}</p>
                </div>
                <div className="hidden sm:block col-span-3 text-xs text-gray-600 dark:text-slate-400">{c.phone}</div>
                <div className="hidden sm:block col-span-2 text-center text-xs font-semibold text-gray-900 dark:text-white">{c.orderCount}</div>
                <div className="hidden sm:block col-span-2 text-right text-sm font-bold text-gray-900 dark:text-white">₹{c.totalSpent.toFixed(0)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [data, setData] = useState({ orders: [], products: [], customers: [], categories: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      ordersApi.getAll({ limit: 500 } as any),
      productsApi.getAll(),
      customersApi.getAll(),
      categoriesApi.getAll(),
    ]).then(([o, p, c, cat]) => {
      setData({ orders: o.data.data || [], products: p.data.data || [], customers: c.data.data || [], categories: cat.data.data || [] });
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'revenue',   label: 'Revenue',   icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'orders',    label: 'Orders',    icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'customers', label: 'Customers', icon: <Users className="w-4 h-4" /> },
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

      {tab === 'revenue'   && <RevenueTab   orders={data.orders} />}
      {tab === 'orders'    && <OrdersTab    orders={data.orders} />}
      {tab === 'customers' && <CustomersTab orders={data.orders} customers={data.customers} products={data.products} categories={data.categories} />}
    </div>
  );
}
