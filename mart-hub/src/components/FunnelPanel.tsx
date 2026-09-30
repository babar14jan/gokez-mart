import { useEffect, useState } from 'react';
import { AlertTriangle, Filter, TrendingDown } from 'lucide-react';
import { customerLeadsApi } from '../services/api';
import type { FunnelRange, FunnelSummary } from '../services/api';

const RANGES: Array<{ id: FunnelRange; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default function FunnelPanel() {
  const [range, setRange] = useState<FunnelRange>('30d');
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    customerLeadsApi.getFunnel(range)
      .then(response => setSummary(response.data.data))
      .catch(() => setError('Could not load the funnel. Please try again.'))
      .finally(() => setLoading(false));
  }, [range]);

  const stages = summary?.stages ?? [];
  const top = stages[0]?.count ?? 0;
  const peak = Math.max(1, ...(summary?.daily ?? []).map(d => d.requested));

  return (
    <section className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Login &amp; purchase funnel</h2>
        </div>
        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900/40 sm:w-auto">
          {RANGES.map(item => (
            <button key={item.id} type="button" onClick={() => setRange(item.id)}
              className={`min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${range === item.id ? 'bg-emerald-500 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>
      ) : !summary || top === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">No login activity in this period yet.</p>
      ) : (
        <>
          <div className="space-y-2">
            {stages.map((stage, i) => {
              const prev = i === 0 ? stage.count : stages[i - 1].count;
              const width = top > 0 ? Math.max(6, Math.round((stage.count / top) * 100)) : 0;
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

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
          </div>

          {summary.daily.length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Numbers entered vs ordered, by day
                </p>
                <p className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-slate-400">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Entered</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-400 dark:bg-slate-500" />Ordered</span>
                </p>
              </div>
              <div className="flex h-12 items-end gap-px">
                {summary.daily.map(point => (
                  <div key={point.date} className="group relative flex flex-1 flex-col justify-end gap-px" title={`${point.date}: ${point.requested} entered, ${point.ordered} ordered`}>
                    <div className="w-full rounded-sm bg-slate-400 dark:bg-slate-500"
                      style={{ height: `${Math.round((point.ordered / peak) * 100)}%` }} />
                    <div className="w-full rounded-sm bg-emerald-500"
                      style={{ height: `${Math.round((point.requested / peak) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.channels.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Where visits came from
              </p>
              <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-900/40 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Channel</th>
                      <th className="px-3 py-2 text-right font-semibold">Visits</th>
                      <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {summary.channels.map(row => (
                      <tr key={row.channel}>
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-slate-200">
                          {row.channel === 'unattributed' ? 'Direct / QR (unattributed)' : row.channel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.sessions}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{row.ordered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                A visit is an anonymous session, not a unique person. Reprints carrying{' '}
                <code className="rounded bg-gray-100 px-1 dark:bg-slate-700">?ch=</code> split out automatically.
              </p>
            </div>
          )}

          {summary.eventStages.some(stage => stage.sessions > 0) && (
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
                        style={{ width: `${Math.round((stage.sessions / Math.max(1, summary.eventStages[0].sessions)) * 100)}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-800 dark:text-slate-200">{stage.sessions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.cart.carts > 0 && (
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

          {summary.attribution.length > 0 && (
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
