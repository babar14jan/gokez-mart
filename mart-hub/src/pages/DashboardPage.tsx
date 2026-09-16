import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, ClipboardList, TrendingUp, Clock, CheckCircle, XCircle, Calendar } from 'lucide-react';
import { ordersApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';

type Range = 'today' | '7d' | '30d' | 'all';

const STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  confirmed:        'bg-blue-100 text-blue-700',
  preparing:        'bg-indigo-100 text-indigo-700',
  out_for_delivery: 'bg-violet-100 text-violet-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-red-100 text-red-700',
};

const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash', upi: 'UPI', phonepay: 'PhonePe' };

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 Days' },
  { id: '30d',   label: '30 Days' },
  { id: 'all',   label: 'All Time' },
];

function rangeStart(r: Range): Date | null {
  const now = new Date();
  if (r === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (r === '7d')    return new Date(now.getTime() - 7 * 86400000);
  if (r === '30d')   return new Date(now.getTime() - 30 * 86400000);
  return null;
}

export default function DashboardPage() {
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('today');

  useEffect(() => {
    ordersApi.getAll({ storeId: getActiveStoreId(), limit: 500 } as any)
      .then(o => setAllOrders(o.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const start = rangeStart(range);
    if (!start) return allOrders;
    return allOrders.filter(o => new Date(o.createdAt) >= start);
  }, [allOrders, range]);

  const kpis = useMemo(() => {
    const total     = filtered.length;
    const pending   = filtered.filter(o => o.status === 'pending').length;
    const delivered = filtered.filter(o => o.status === 'delivered').length;
    const cancelled = filtered.filter(o => ['cancelled', 'failed_delivery', 'terminated'].includes(o.status)).length;
    const revenue   = filtered.filter(o => o.status === 'delivered').reduce((s: number, o: any) => s + (o.total || 0), 0);
    return { total, pending, delivered, cancelled, revenue };
  }, [filtered]);

  const rangeLabel = RANGES.find(r => r.id === range)?.label || '';
  const navigate = useNavigate();

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Date range tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {RANGES.map(r => (
          <button key={r.id} onClick={() => setRange(r.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              range === r.id
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}>
            {r.id === 'today' && <Calendar className="w-3 h-3" />}
            {r.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-stretch">
        {[
          { label: 'Total Orders',  value: kpis.total,                    sub: `${kpis.cancelled} cancelled`,    icon: ClipboardList, gradient: 'from-emerald-500 to-emerald-600', href: '/orders' },
          { label: 'Pending',       value: kpis.pending,                  sub: 'awaiting confirmation',           icon: Clock,         gradient: 'from-amber-500 to-amber-600',     href: '/orders' },
          { label: 'Delivered',     value: kpis.delivered,                sub: 'successfully delivered',          icon: CheckCircle,   gradient: 'from-violet-500 to-violet-600',   href: '/orders' },
          { label: 'Revenue',       value: `₹${kpis.revenue.toFixed(0)}`, sub: 'from delivered orders',           icon: TrendingUp,    gradient: 'from-blue-500 to-blue-600',       href: null },
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
                <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{k.sub}</p>
              </div>
            </div>
          );
          return k.href
            ? <Link key={k.label} to={k.href} className="h-full block">{inner}</Link>
            : <div key={k.label} className="h-full">{inner}</div>;
        })}
      </div>

      {/* Recent orders + status breakdown */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* Recent orders */}
        <div className="lg:col-span-2 page-card">
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
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{order.guestName} · {order.guestPhone} · {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</p>
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
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{order.guestName}</p>
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
        <div className="page-card">
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
              const total = filtered.length;
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

                  {/* Summary */}
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">Total orders</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{total}</span>
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
