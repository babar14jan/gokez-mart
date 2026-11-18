import { useEffect, useMemo, useState } from 'react';
import {
  Gift, CheckCircle2, Clock3, Landmark, Receipt, TrendingUp, Info,
} from 'lucide-react';
import {
  referralAdminApi,
  type ReferralSummary, type ConversionReportRow, type OrdersReportRow,
} from '../services/referralAdminApi';
import {
  KpiCard, BarChart, HorizontalBars, DateRangeFilter, PanelHeader, fmtDate, fmtMoney,
} from '../components/referralUi';
import PageSkeleton from '../components/PageSkeleton';

const EMPTY_SUMMARY: ReferralSummary = {
  referrals: 0, rewarded: 0, pending: 0, capped: 0, rejected: 0, expired: 0,
  qualifyingValue: 0, rewardsIssued: 0, liability: 0, redeemed: 0, credits: 0,
};

export default function ReferralOverviewPage({ embedded = false }: { embedded?: boolean }) {
  const [summary, setSummary] = useState<ReferralSummary>(EMPTY_SUMMARY);
  const [conversion, setConversion] = useState<ConversionReportRow[]>([]);
  const [orders, setOrders] = useState<OrdersReportRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      referralAdminApi.getSummary({ from: from || undefined, to: to || undefined }),
      referralAdminApi.getReport('conversion', { from: from || undefined, to: to || undefined }),
      referralAdminApi.getReport('orders', { from: from || undefined, to: to || undefined }),
    ]).then(([s, c, o]) => {
      if (cancelled) return;
      setSummary(s || EMPTY_SUMMARY);
      setConversion((c.items || []) as ConversionReportRow[]);
      setOrders((o.items || []) as OrdersReportRow[]);
    }).catch(() => {
      if (!cancelled) setError('Could not load referral analytics. Please try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  // The backend's summary is campaign-to-date; the date pickers narrow the
  // day-bucketed orders chart here. Reports are fetched fresh on every change.
  const filteredOrders = useMemo(() => orders.filter(row => {
    const day = String(row.day || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }), [orders, from, to]);

  const rate = summary.referrals > 0 ? Math.round((summary.rewarded / summary.referrals) * 1000) / 10 : 0;
  const chartData = [...filteredOrders].reverse().map(row => ({
    label: String(row.day || '').slice(5, 10),
    fullLabel: fmtDate(row.day, false),
    value: Number(row.orders || 0),
  }));

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PanelHeader embedded={embedded} title="Referral Overview"
        subtitle="Campaign-to-date performance of the Referral &amp; Earn programme."
        actions={<DateRangeFilter from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />} />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Referrals" value={summary.referrals} sub="all attributions" icon={<Gift className="w-4 h-4" />} gradient="from-emerald-500 to-emerald-600" />
        <KpiCard label="Qualified / Rewarded" value={summary.rewarded} sub={`${fmtMoney(summary.qualifyingValue)} qualifying value`} icon={<CheckCircle2 className="w-4 h-4" />} gradient="from-blue-500 to-blue-600" />
        <KpiCard label="Pending" value={summary.pending} sub="awaiting first delivery" icon={<Clock3 className="w-4 h-4" />} gradient="from-amber-400 to-amber-600" />
        <KpiCard label="Conversion Rate" value={`${rate}%`} sub={`${summary.rewarded} of ${summary.referrals} referrals`} icon={<TrendingUp className="w-4 h-4" />} gradient="from-lime-500 to-emerald-600" />
        <KpiCard label="Available Liability" value={fmtMoney(summary.liability)} sub={`${summary.credits.toLocaleString('en-IN')} credits available + reserved`} icon={<Landmark className="w-4 h-4" />} gradient="from-indigo-500 to-indigo-600" />
        <KpiCard label="Redeemed" value={fmtMoney(summary.redeemed)} sub="credits used on orders" icon={<Receipt className="w-4 h-4" />} gradient="from-cyan-500 to-cyan-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Referrals by Status</p>
          {conversion.length === 0
            ? <p className="text-xs text-gray-500 text-center py-8">No referral statuses recorded yet</p>
            : <HorizontalBars rows={conversion.map(row => ({
                label: row.status,
                value: Number(row.count || 0),
                detail: `${row.delivered || 0} delivered`,
              }))} />}
        </div>
        <div className="page-card p-4">
          <p className="text-xs font-bold text-gray-700 dark:text-slate-300 mb-4">Qualifying Orders by Day {from || to ? '(filtered)' : ''}</p>
          {chartData.length === 0
            ? <p className="text-xs text-gray-500 text-center py-8">No qualifying orders in this period</p>
            : <BarChart data={chartData} color="bg-emerald-500" />}
        </div>
      </div>

      {filteredOrders.length > 0 && (
        <div className="page-card">
          <div className="page-card-header"><p className="page-card-title">Qualifying Orders</p></div>
          <div className="hidden sm:grid grid-cols-3 gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>Day</div><div className="text-center">Orders</div><div className="text-right">Value</div>
          </div>
          {filteredOrders.slice(0, 14).map(row => (
            <div key={row.day} className="grid grid-cols-3 gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 last:border-0 text-xs">
              <div className="font-medium text-gray-900 dark:text-white">{fmtDate(row.day, false)}</div>
              <div className="text-center text-gray-600 dark:text-slate-400">{row.orders}</div>
              <div className="text-right font-bold text-gray-900 dark:text-white">{fmtMoney(row.value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          <span className="font-bold">Refunded after delivery:</span> rewards unlock on the first qualifying delivered order.
          If that order is later refunded, cancelled or fails delivery, the backend reverses the issued rewards and writes
          reversal entries to the ledger; reversed credits no longer count toward available liability.
        </p>
      </div>
    </div>
  );
}
