import { useEffect, useState } from 'react';
import { Lightbulb, MapPin, MessageCircle, Repeat, Sparkles, UserPlus } from 'lucide-react';
import { suggestionsApi, type ProductSuggestion, type SuggestionStatus, type BuyerTypeFilter, type SuggestionInsights, type FunnelRange } from '../services/api';
import { useAuthStore } from '../store/authStore';

const RANGES: { value: FunnelRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

const STATUS_STYLES: Record<SuggestionStatus, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  reviewing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  added: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  declined: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
};

const STATUS_LABELS: Record<SuggestionStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  added: 'Added',
  declined: 'Declined',
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-';

export default function SuggestionsPage() {
  const { isSuperAdmin } = useAuthStore();
  const canAccess = isSuperAdmin();

  const [range, setRange] = useState<FunnelRange>('30d');
  const [status, setStatus] = useState<SuggestionStatus | 'all'>('all');
  const [buyerType, setBuyerType] = useState<BuyerTypeFilter | 'all'>('all');
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [insights, setInsights] = useState<SuggestionInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      setError('Product suggestions are only available to super admins.');
      return;
    }
    setLoading(true);
    setError('');
    Promise.all([
      suggestionsApi.getAll({ status, buyerType }, range),
      suggestionsApi.getInsights(range),
    ])
      .then(([listRes, insightsRes]) => {
        setSuggestions(listRes.data.data || []);
        setInsights(insightsRes.data.data || null);
      })
      .catch(() => setError('Could not load suggestions. Please try again.'))
      .finally(() => setLoading(false));
  }, [range, status, buyerType, canAccess]);

  const changeStatus = async (id: string, next: SuggestionStatus) => {
    const current = suggestions.find(row => row.id === id);
    if (!current || current.status === next) return;
    // Optimistic: reflect the change immediately. If a status filter is active,
    // a row that no longer matches the filter is removed rather than left in a
    // list it no longer belongs to.
    const keepsFilter = status === 'all' || status === next;
    setSuggestions(rows => keepsFilter
      ? rows.map(row => (row.id === id ? { ...row, status: next } : row))
      : rows.filter(row => row.id !== id));
    try {
      await suggestionsApi.updateStatus(id, next);
      // The byStatus rollup is a separate query, so refresh it rather than
      // leaving the counts stale after a change.
      const insightsRes = await suggestionsApi.getInsights(range);
      setInsights(insightsRes.data.data || null);
    } catch {
      // Roll back only the touched row, so any other change made in the
      // meantime is not clobbered by a whole-list snapshot.
      setSuggestions(rows => rows.some(row => row.id === id)
        ? rows.map(row => (row.id === id ? { ...row, status: current.status } : row))
        : [...rows, current].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      setError('Could not update that suggestion. Please try again.');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          What shoppers have asked us to stock, captured with the delivery area, store and buyer type at submit time. Use this to decide what to bring in next. Reporting uses India time.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map(r => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRange(r.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              range === r.value
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {r.label}
          </button>
        ))}
        <select
          value={status}
          onChange={e => setStatus(e.target.value as SuggestionStatus | 'all')}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">All statuses</option>
          {(['new', 'reviewing', 'added', 'declined'] as SuggestionStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          value={buyerType}
          onChange={e => setBuyerType(e.target.value as BuyerTypeFilter | 'all')}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">All buyers</option>
          <option value="new">New buyers</option>
          <option value="repeat">Repeat buyers</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {insights && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 items-stretch">
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Total asks" value={insights.counts.total} sub="in this period" gradient="from-emerald-500 to-emerald-600" />
          <StatCard icon={<UserPlus className="h-4 w-4" />} label="New buyers" value={insights.counts.newBuyers} sub="first-time askers" gradient="from-violet-500 to-violet-600" />
          <StatCard icon={<Repeat className="h-4 w-4" />} label="Repeat buyers" value={insights.counts.repeatBuyers} sub="already ordered" gradient="from-amber-500 to-amber-600" />
          <StatCard icon={<MapPin className="h-4 w-4" />} label="Zones asking" value={insights.topZones.length} sub="distinct areas" gradient="from-blue-500 to-blue-600" />
        </div>
      )}

      {insights && insights.topProducts.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Most requested</p>
          <div className="flex flex-wrap gap-2">
            {insights.topProducts.map(item => (
              <span key={item.product} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                {item.product}
                <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-emerald-700 dark:bg-slate-900/50 dark:text-emerald-300">{item.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse" aria-live="polite">
          <span className="sr-only">Loading suggestions...</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white py-16 text-center text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Lightbulb className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">No product suggestions in this period yet.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 md:hidden" role="list" aria-label="Product suggestions list">
            {suggestions.map(s => (
              <SuggestionCard key={s.id} suggestion={s} onStatusChange={changeStatus} />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">Suggested product</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Buyer</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Zone / store</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Received</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {suggestions.map(s => (
                  <SuggestionRow key={s.id} suggestion={s} onStatusChange={changeStatus} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, gradient }: { icon: React.ReactNode; label: string; value: number; sub: string; gradient: string }) {
  return (
    <div className="kpi-card h-full cursor-default">
      <div className="flex items-center gap-3 w-full min-w-0">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
          <span className="text-white">{icon}</span>
        </div>
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
      </div>
      <div className="min-w-0 w-full">
        <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 truncate">{label}</p>
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 mt-1 truncate">{sub}</p>
      </div>
    </div>
  );
}

function StatusSelect({ value, onChange }: { value: SuggestionStatus; onChange: (next: SuggestionStatus) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as SuggestionStatus)}
      className={`rounded-full px-2 py-1 text-[11px] font-bold ${STATUS_STYLES[value]} border-0 focus:ring-2 focus:ring-emerald-500`}
      aria-label="Update suggestion status"
    >
      {(['new', 'reviewing', 'added', 'declined'] as SuggestionStatus[]).map(s => (
        <option key={s} value={s} className="bg-white text-gray-900 dark:bg-slate-800 dark:text-white">{STATUS_LABELS[s]}</option>
      ))}
    </select>
  );
}

function BuyerBadge({ suggestion }: { suggestion: ProductSuggestion }) {
  return suggestion.buyerType === 'repeat' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      <Repeat className="h-3 w-3" aria-hidden="true" />Repeat · {suggestion.orderCount}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
      <UserPlus className="h-3 w-3" aria-hidden="true" />New
    </span>
  );
}

/**
 * Name plus a one-tap WhatsApp action, shown only when the customer opted in
 * ("Contact me if this product is added"). Without consent no number and no
 * button are shown, so staff can never initiate outreach with someone who
 * declined. Guests have no name, so the number is the only way back to them.
 */
function ContactLine({ suggestion }: { suggestion: ProductSuggestion }) {
  const digits = (suggestion.phone || '').replace(/\D/g, '');
  const waNumber = digits.length === 10 ? `91${digits}` : digits;
  const consented = Boolean(suggestion.contactConsent);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span>{consented ? (suggestion.name ? `${suggestion.name} · ${suggestion.phone}` : suggestion.phone || 'Guest') : suggestion.name || 'Guest'}</span>
      {consented && waNumber && (
        <a
          href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi! "${suggestion.suggestedProduct}" is now available at Gokez Mart — order it on the app. Thanks for suggesting it!`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
          aria-label={`WhatsApp ${suggestion.phone || waNumber}`}
        >
          <MessageCircle className="h-3 w-3" aria-hidden="true" />WhatsApp
        </a>
      )}
      {consented && (
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">consented</span>
      )}
    </span>
  );
}

function SuggestionCard({ suggestion, onStatusChange }: { suggestion: ProductSuggestion; onStatusChange: (id: string, next: SuggestionStatus) => void }) {
  return (
    <div className="space-y-2 p-4" role="listitem">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{suggestion.suggestedProduct}</p>
          {suggestion.detail && <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{suggestion.detail}</p>}
        </div>
        <StatusSelect value={suggestion.status} onChange={next => onStatusChange(suggestion.id, next)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BuyerBadge suggestion={suggestion} />
        {suggestion.zoneName && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            <MapPin className="h-3 w-3" aria-hidden="true" />{suggestion.zoneName}
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        <ContactLine suggestion={suggestion} /> · {formatDate(suggestion.createdAt)}
      </p>
    </div>
  );
}

function SuggestionRow({ suggestion, onStatusChange }: { suggestion: ProductSuggestion; onStatusChange: (id: string, next: SuggestionStatus) => void }) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-semibold text-gray-900 dark:text-white">{suggestion.suggestedProduct}</p>
        {suggestion.detail && <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{suggestion.detail}</p>}
      </td>
      <td className="px-4 py-3">
        <BuyerBadge suggestion={suggestion} />
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400"><ContactLine suggestion={suggestion} /></p>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
        <p>{suggestion.zoneName || '-'}</p>
        <p className="text-xs text-gray-400 dark:text-slate-500">{suggestion.storeName || '-'}</p>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDate(suggestion.createdAt)}</td>
      <td className="px-4 py-3">
        <StatusSelect value={suggestion.status} onChange={next => onStatusChange(suggestion.id, next)} />
      </td>
    </tr>
  );
}
