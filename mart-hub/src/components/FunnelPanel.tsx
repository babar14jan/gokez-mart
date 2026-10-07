import { useEffect, useState } from 'react';
import { AlertTriangle, Filter, Repeat2, TrendingDown, UserPlus } from 'lucide-react';
import { customerLeadsApi } from '../services/api';
import type { FunnelRange, FunnelSummary } from '../services/api';

const RANGES: Array<{ id: FunnelRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
  { id: 'all', label: 'All time' },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

interface FunnelPanelProps {
  range?: FunnelRange;
  from?: string;
  to?: string;
  onRangeChange?: (range: FunnelRange) => void;
  onDateRangeChange?: (from: string, to: string) => void;
}

const todayInIst = () => {
  const parts = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

export default function FunnelPanel({ range: controlledRange, from: controlledFrom, to: controlledTo, onRangeChange, onDateRangeChange }: FunnelPanelProps) {
  const [internalRange, setInternalRange] = useState<FunnelRange>('today');
  const [internalFrom, setInternalFrom] = useState(todayInIst);
  const [internalTo, setInternalTo] = useState(todayInIst);
  const range = controlledRange ?? internalRange;
  const setRange = onRangeChange ?? setInternalRange;
  const from = controlledFrom ?? internalFrom;
  const to = controlledTo ?? internalTo;
  const setDates = (nextFrom: string, nextTo: string) => {
    if (onDateRangeChange) onDateRangeChange(nextFrom, nextTo);
    else { setInternalFrom(nextFrom); setInternalTo(nextTo); }
  };
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    customerLeadsApi.getFunnel(range, from, to)
      .then(response => setSummary(response.data.data))
      .catch(() => setError('Could not load the funnel. Please try again.'))
      .finally(() => setLoading(false));
  }, [range, from, to]);

  const canonical = summary?.analytics;
  const stages = canonical?.sessionFunnel ?? summary?.stages ?? [];
  const newVisitorShare = canonical ? pct(canonical.acquisition.newVisitors, canonical.acquisition.uniqueVisitors) : 0;
  const returningVisitorShare = canonical ? pct(canonical.acquisition.returningVisitors, canonical.acquisition.uniqueVisitors) : 0;
  const deliveredCustomers = canonical
    ? canonical.customerLifecycle.newCustomers + canonical.customerLifecycle.returningCustomers
    : 0;
  const newCustomerShare = canonical ? pct(canonical.customerLifecycle.newCustomers, deliveredCustomers) : 0;
  const returningCustomerShare = canonical ? pct(canonical.customerLifecycle.returningCustomers, deliveredCustomers) : 0;
  const channelRows = canonical
    ? canonical.channels.map(row => ({ channel: `${row.source} / ${row.medium}`, campaign: row.campaign, sessions: row.sessions, carts: row.cartSessions, checkout: row.checkoutSessions, ordered: row.orders }))
    : (summary?.channels ?? []).map(row => ({ ...row, campaign: null as string | null, carts: null as number | null, checkout: null as number | null }));
  // Bars scale against the largest stage, not the first one. Keying off
  // stages[0] collapses every bar to its 6% floor on a period where nobody
  // requested an OTP but later stages still have counts.
  const barMax = Math.max(1, ...stages.map(s => s.count));
  // Scales against the largest of the three series so visits, which outnumber
// leads on any given day, do not flatten the other two into invisibility.
const peak = Math.max(1, ...(summary?.daily ?? []).flatMap(d => [d.visits, d.requested, d.ordered]));
const eventMax = Math.max(1, ...(summary?.eventStages ?? []).map(s => s.sessions));

  // The empty state must consider every signal the panel renders, not just the
  // first stage. "Number entered" counts OTP requests, so a day with visits,
  // carts and orders but nobody reaching the login step reported zero there and
  // blanked the whole panel -- which is the normal shape of a single day.
  const hasActivity = Boolean(
    summary &&
    (stages.some(s => s.count > 0) ||
    channelRows.some(c => c.sessions > 0) ||
     summary.eventStages.some(s => s.sessions > 0) ||
     summary.cart.carts > 0 ||
     summary.cart.reachedCheckout > 0 ||
     summary.daily.some(d => d.requested > 0 || d.ordered > 0)),
  );

  return (
    <section className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Customer journey</h2>
        </div>
        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900/40 sm:w-auto">
          {RANGES.map(item => (
            <button key={item.id} type="button" onClick={() => {
              if (item.id === 'custom' && (!from || !to)) {
                const today = todayInIst();
                setDates(today, today);
              }
              setRange(item.id);
            }}
              className={`min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${range === item.id ? 'bg-emerald-500 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300">From
            <input type="date" value={from} max={to} onChange={event => setDates(event.target.value, to)} className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300">To
            <input type="date" value={to} min={from} max={todayInIst()} onChange={event => setDates(from, event.target.value)} className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
        </div>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>
      ) : !summary || !hasActivity ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">No activity in this period yet.</p>
      ) : (
        <>
          {canonical && (
            <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Sessions', value: canonical.acquisition.sessions, definition: 'Unique browsing sessions during the selected period.' },
                { label: 'Unique visitors', value: canonical.acquisition.uniqueVisitors, definition: 'Distinct anonymous browser visitors during the selected period.' },
                { label: 'Orders placed', value: canonical.orders.placed, definition: 'Orders created during the selected period.' },
                { label: 'Orders delivered', value: canonical.orders.delivered, definition: 'Orders currently recorded as delivered from this order cohort.' },
                { label: 'Orders paid', value: canonical.orders.paid, definition: 'Orders with cash or UPI payment collected on delivery.' },
                { label: 'GMV', value: `₹${canonical.orders.gmv.toFixed(0)}`, definition: 'Non-cancelled order value from the authoritative orders table.' },
              ].map(metric => (
                <div key={metric.label} title={metric.definition} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{metric.value}</p>
                  <p className="text-[10px] leading-tight text-gray-500 dark:text-slate-400">{metric.label}</p>
                </div>
              ))}
            </div>
            <div className="mb-5 grid grid-cols-2 gap-2" aria-label="Visitor mix in the selected period">
              <div title="New visitors: their first recorded visit was in the selected period." className="flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 dark:border-sky-900/60 dark:bg-sky-950/25">
                <UserPlus className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{canonical.acquisition.newVisitors} <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">{newVisitorShare}%</span></p>
                  <p className="text-[10px] leading-tight text-gray-600 dark:text-slate-300">New visitors</p>
                </div>
              </div>
              <div title="Returning visitors: they visited before the selected period and returned during it." className="flex items-center gap-2 rounded-md border border-violet-100 bg-violet-50 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/25">
                <Repeat2 className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{canonical.acquisition.returningVisitors} <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{returningVisitorShare}%</span></p>
                  <p className="text-[10px] leading-tight text-gray-600 dark:text-slate-300">Returning visitors</p>
                </div>
              </div>
            </div>
            <div className="mb-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Delivered customer mix</p>
              <div className="grid grid-cols-2 gap-2" aria-label="New and returning delivered customers in the selected period">
                <div title="New customers: their first delivered order was in the selected period. Guest checkouts are excluded because they cannot be reliably identified across orders." className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 dark:border-emerald-900/60 dark:bg-emerald-950/25">
                  <UserPlus className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{canonical.customerLifecycle.newCustomers} <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{newCustomerShare}%</span></p>
                    <p className="text-[10px] leading-tight text-gray-600 dark:text-slate-300">New customers</p>
                  </div>
                </div>
                <div title="Returning customers: they had a delivered order before the selected period and another delivery in it. Guest checkouts are excluded because they cannot be reliably identified across orders." className="flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/25">
                  <Repeat2 className="h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{canonical.customerLifecycle.returningCustomers} <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{returningCustomerShare}%</span></p>
                    <p className="text-[10px] leading-tight text-gray-600 dark:text-slate-300">Returning customers</p>
                  </div>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">Based on identified customers with a delivered order in the selected period.</p>
            </div>
            </>
          )}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Customer funnel · unique sessions</p>
          {canonical && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div title="Sessions that started but had no category, search, product, cart, or checkout interaction." className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/25">
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{canonical.nonEngagedSessions}</p>
                <p className="text-[10px] leading-tight text-amber-800 dark:text-amber-200">Non-engaged sessions</p>
              </div>
              {canonical.largestDrop && (
                <div title={`${canonical.largestDrop.count} sessions dropped between these two stages.`} className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 dark:border-rose-900/60 dark:bg-rose-950/25">
                  <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{canonical.largestDrop.percent}% dropped</p>
                  <p className="truncate text-[10px] leading-tight text-rose-800 dark:text-rose-200">Largest drop: {canonical.largestDrop.from} to {canonical.largestDrop.to}</p>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            {stages.map((stage, i) => {
              const prev = i === 0 ? stage.count : stages[i - 1].count;
              const width = stage.count > 0 ? Math.max(6, Math.round((stage.count / barMax) * 100)) : 0;
              return (
                <div key={stage.key}>
                  {i > 0 && (
                    <p className="mb-1 ml-1 flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                      <TrendingDown className="h-3 w-3" />
                      {pct(stage.count, prev)}% continued from {stages[i - 1].label.toLowerCase()}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="h-8 flex-1 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-700/60">
                      <div className="flex h-full items-center rounded-md bg-emerald-500 px-2 text-xs font-bold text-white transition-all dark:bg-emerald-600"
                        style={{ width: `${width}%` }}>
                        <span className="truncate">{stage.label}</span>
                      </div>
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-gray-900 dark:text-white">{stage.count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {canonical && canonical.reconciliation.unattributedOrderCount > 0 && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-200">
              {canonical.reconciliation.unattributedOrderCount} of {canonical.reconciliation.orderTableCount} orders cannot be linked to a session. They are retained in order totals but excluded from channel conversion until attribution is available.
            </p>
          )}

          {canonical && (
            <>
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Product discovery</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    { label: 'Category interactions', value: canonical.productDiscovery.categoryInteractionSessions, definition: 'Unique sessions with a category interaction.' },
                    { label: 'Search interactions', value: canonical.productDiscovery.searchInteractionSessions, definition: 'Unique sessions that searched.' },
                    { label: 'Product view sessions', value: canonical.productDiscovery.productViewSessions, definition: 'Unique sessions with a product view.' },
                    { label: 'Product view events', value: canonical.productDiscovery.productViewEvents, definition: 'Total product-view events; repeated views are included.' },
                    { label: 'Zero-result searches', value: canonical.productDiscovery.zeroResultSearches, definition: 'Total searches that showed no matching product; search text is never recorded.' },
                  ].map(metric => (
                    <div key={metric.label} title={metric.definition} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{metric.value}</p>
                      <p className="text-[10px] leading-tight text-gray-500 dark:text-slate-400">{metric.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">OTP funnel</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Mobile interactions', value: canonical.otp.mobileInteractions },
                    { label: 'OTP requests', value: canonical.otp.otpRequests },
                    { label: 'OTP verified', value: canonical.otp.otpVerified },
                  ].map(metric => (
                    <div key={metric.label} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{metric.value}</p>
                      <p className="text-[10px] leading-tight text-gray-500 dark:text-slate-400">{metric.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">Mobile interactions and verified are unique sessions; OTP requests are attempts.</p>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Order fulfilment · authoritative orders</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Orders placed', value: canonical.orders.placed },
                    { label: 'Accepted', value: canonical.orders.accepted },
                    { label: 'Preparing', value: canonical.orders.preparing },
                    { label: 'Out for delivery', value: canonical.orders.outForDelivery },
                    { label: 'Delivered', value: canonical.orders.delivered },
                    { label: 'Paid', value: canonical.orders.paid },
                    { label: 'Cancelled', value: canonical.orders.cancelled },
                  ].map(metric => (
                    <div key={metric.label} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{metric.value}</p>
                      <p className="text-[10px] leading-tight text-gray-500 dark:text-slate-400">{metric.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!canonical && <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/25">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-xs leading-snug text-amber-900 dark:text-amber-200">
                <span className="font-bold">{summary.dropoff.retriedNeverVerified}</span> requested an OTP more than once and never verified
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/25">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-400" />
              <p className="text-xs leading-snug text-amber-900 dark:text-amber-200">
                <span className="font-bold">{summary.dropoff.verifiedNeverOrdered}</span> verified the number but never placed an order
              </p>
            </div>
          </div>}

          {!canonical && summary.daily.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Traffic, OTP starts and orders, by day
                </p>
                <p className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-slate-400">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-400 dark:bg-blue-600" />Visits</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Entered</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-400 dark:bg-slate-500" />Ordered</span>
                </p>
              </div>
              <div className="flex h-14 items-end gap-px">
                {summary.daily.map(point => (
                  <div key={point.date} className="group relative flex flex-1 flex-col justify-end gap-px"
                    title={`${point.date}: ${point.visits} visits, ${point.requested} entered, ${point.ordered} ordered`}>
                    <div className="w-full rounded-sm bg-slate-400 dark:bg-slate-500"
                      style={{ height: `${Math.round((point.ordered / peak) * 100)}%` }} />
                    <div className="w-full rounded-sm bg-emerald-500"
                      style={{ height: `${Math.round((point.requested / peak) * 100)}%` }} />
                    <div className="w-full rounded-sm bg-blue-400 dark:bg-blue-600"
                      style={{ height: `${Math.round((point.visits / peak) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                Traffic is anonymous sessions, while OTP starts are phone numbers. They are shown together for context, not as one person-by-person funnel. All dates use India time.
              </p>
            </div>
          )}

          {channelRows.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Marketing attribution · unique sessions
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-700">
                <table className="min-w-[640px] w-full text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-900/40 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Channel</th>
                      <th className="px-3 py-2 font-semibold">Campaign</th>
                      <th className="px-3 py-2 text-right font-semibold">Visits</th>
                      <th className="px-3 py-2 text-right font-semibold">Carts</th>
                      <th className="px-3 py-2 text-right font-semibold">Checkout</th>
                      <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {channelRows.map(row => (
                      <tr key={row.channel}>
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-slate-200">
                          {row.channel}
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{row.campaign || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.sessions}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.carts ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.checkout ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.ordered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                Visits, carts, and checkout are unique sessions. Orders are attributed only when their linked session has attribution; genuinely unassigned orders remain in reconciliation.
              </p>
            </div>
          )}

          {!canonical && summary.eventStages.some(stage => stage.sessions > 0) && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Tracked journey, by session
              </p>
              <div className="space-y-1">
                {summary.eventStages.filter(s => s.sessions > 0).map(stage => (
                  <div key={stage.key} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate text-xs text-gray-600 dark:text-slate-300">{stage.label}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-gray-100 dark:bg-slate-700/60">
                      <div className="h-full rounded-sm bg-blue-500 dark:bg-blue-600"
                        style={{ width: `${Math.round((stage.sessions / eventMax) * 100)}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-800 dark:text-slate-200">{stage.sessions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!canonical && summary.cart.carts > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Carts started', value: summary.cart.carts },
                { label: 'Reached checkout', value: summary.cart.reachedCheckout },
                { label: 'Ordered', value: summary.cart.converted },
                { label: 'Abandoned at checkout', value: summary.cart.abandoned },
              ].map(card => (
                <div key={card.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{card.value}</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">{card.label}</p>
                </div>
              ))}
            </div>
          )}

          {!canonical && summary.attribution.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Campaign attribution
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-900/40 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Campaign</th>
                      <th className="px-3 py-2 text-right font-semibold">First touch</th>
                      <th className="px-3 py-2 text-right font-semibold">Last touch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {summary.attribution.map(row => (
                      <tr key={row.campaignId}>
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-slate-200">
                          {row.campaignName}
                          {row.code && <span className="ml-1 text-gray-400">{row.code}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.firstTouchOrders}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.lastTouchOrders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] text-gray-500 dark:text-slate-400">
            Average OTP requests per number: <span className="font-bold">{summary.dropoff.avgOtpRequests}</span>. An order is counted
            against a number whether it was placed logged-in or as a guest with the same mobile.
          </p>
        </>
      )}
    </section>
  );
}
