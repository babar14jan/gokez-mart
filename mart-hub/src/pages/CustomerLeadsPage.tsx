import { useEffect, useState } from 'react';
import { Calendar, Download, Phone, Users } from 'lucide-react';
import { customerLeadsApi, type FunnelRange } from '../services/api';
import FunnelPanel from '../components/FunnelPanel';
import { useAuthStore } from '../store/authStore';

type LeadRange = FunnelRange | 'yesterday';

const RANGES: { id: LeadRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

const todayInIst = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const yesterdayInIst = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() - 86400000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  otpRequestCount: number;
  firstOtpRequestedAt: string;
  lastOtpRequestedAt: string;
}

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-';

export default function CustomerLeadsPage() {
  const { isSuperAdmin } = useAuthStore();
  const canAccessLeads = isSuperAdmin();

  const [range, setRange] = useState<FunnelRange>('today');
  const [customFrom, setCustomFrom] = useState(todayInIst);
  const [customTo, setCustomTo] = useState(todayInIst);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canAccessLeads) {
      setLoading(false);
      setError('Leads and funnel analytics are only available to super admins.');
      return;
    }
    setLoading(true);
    setError('');
    // Only "OTP not completed" prospects belong here. Verified customers and
    // checkout-only contacts are customers, and already live on the Customers page.
    customerLeadsApi.getAll(
      'unverified',
      range,
      range === 'custom' ? customFrom || undefined : undefined,
      range === 'custom' ? customTo || undefined : undefined,
    )
      .then(response => {
        setLeads(response.data.data || []);
        setTotal(response.data.counts?.unverified ?? 0);
      })
      .catch(() => setError('Could not load leads. Please try again.'))
      .finally(() => setLoading(false));
  }, [range, customFrom, customTo, canAccessLeads]);

  const handleRangeClick = (id: LeadRange) => {
    if (id === 'yesterday') {
      const yesterday = yesterdayInIst();
      setCustomFrom(yesterday);
      setCustomTo(yesterday);
      setRange('custom');
      return;
    }
    if (id === 'custom' && (!customFrom || !customTo)) {
      const today = todayInIst();
      setCustomFrom(today);
      setCustomTo(today);
    }
    setRange(id as FunnelRange);
  };

  const isRangeActive = (id: LeadRange) => id === 'yesterday'
    ? range === 'custom' && customFrom === yesterdayInIst() && customTo === yesterdayInIst()
    : range === id;

  const downloadMarketingCsv = async () => {
    setDownloading(true);
    try {
      const response = await customerLeadsApi.downloadMarketingCsv();
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'gokez-marketing-leads.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the marketing list. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Compact date filter + marketing download, same pattern as the other pages */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map(r => (
          <button key={r.id} type="button" onClick={() => handleRangeClick(r.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isRangeActive(r.id)
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}>
            {r.id === 'custom' && <Calendar className="w-3 h-3" />}
            {r.label}
          </button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
            <input type="date" value={customTo} min={customFrom} max={todayInIst()} onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={downloadMarketingCsv}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          title="Download verified customers who granted marketing consent as CSV"
          aria-label="Download verified customers who granted marketing consent as CSV"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {downloading ? 'Preparing...' : 'Marketing list'}
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-slate-400">
        Shoppers who entered their number but never verified OTP. Prospects, not customers — see the Customers page for verified and guest buyers. Times are India time.
      </p>

      <FunnelPanel
        hideControls
        range={range}
        from={customFrom}
        to={customTo}
        onRangeChange={setRange}
        onDateRangeChange={(from, to) => { setCustomFrom(from); setCustomTo(to); }}
      />

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">OTP not completed</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{total}</span>
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse" aria-live="polite">
          <span className="sr-only">Loading leads...</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white py-16 text-center text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Users className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">No pending leads yet.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 md:hidden" role="list" aria-label="Pending leads list">
            {leads.map(lead => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 md:block">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">Lead</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Last OTP request</th>
                  <th className="px-4 py-3 font-semibold" scope="col">OTP requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {leads.map(lead => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-2 p-4" role="listitem">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{lead.name || 'Unidentified lead'}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400">
            <Phone className="h-3 w-3" aria-hidden="true" />{lead.phone}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">OTP pending</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500 dark:text-slate-400">Last OTP request</p>
          <p className="mt-0.5 font-medium text-gray-800 dark:text-slate-200">{formatDate(lead.lastOtpRequestedAt)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-slate-400">OTP requests</p>
          <p className="mt-0.5 font-medium text-gray-800 dark:text-slate-200">{lead.otpRequestCount}</p>
        </div>
      </div>
    </div>
  );
}

function LeadRow({ lead }: { lead: Lead }) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-semibold text-gray-900 dark:text-white">{lead.name || 'Unidentified lead'}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{lead.phone}</p>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDate(lead.lastOtpRequestedAt)}</td>
      <td className="px-4 py-3 font-semibold text-gray-800 dark:text-slate-200">{lead.otpRequestCount}</td>
    </tr>
  );
}
