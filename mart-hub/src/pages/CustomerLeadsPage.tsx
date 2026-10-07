import { useEffect, useState, useMemo } from 'react';
import { Download, Phone, Users } from 'lucide-react';
import { customerLeadsApi, type FunnelRange } from '../services/api';
import FunnelPanel from '../components/FunnelPanel';
import { useAuthStore } from '../store/authStore';

type LeadFilter = 'all' | 'unverified' | 'verified' | 'guest';

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  otpRequestCount: number;
  firstOtpRequestedAt: string;
  lastOtpRequestedAt: string;
  verifiedAt: string | null;
  lastSuccessfulLoginAt: string | null;
  marketingConsent: boolean;
}

interface Counts {
  total: number;
  unverified: number;
  verified: number;
  guest: number;
}

type LeadStatus = 'verified' | 'unverified' | 'guest';

interface StatusConfig {
  label: string;
  className: string;
}

const STATUS_CONFIG: Record<LeadStatus, StatusConfig> = {
  verified: { label: 'Verified', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  unverified: { label: 'Unverified', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  guest: { label: 'Checkout-only', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
};

const getLeadStatus = (lead: Lead): LeadStatus => {
  if (lead.verifiedAt) return 'verified';
  if (lead.otpRequestCount === 0) return 'guest';
  return 'unverified';
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-';

const getLastActivityDate = (lead: Lead): string | null => {
  const status = getLeadStatus(lead);
  return status === 'verified' ? lead.lastSuccessfulLoginAt : lead.lastOtpRequestedAt;
};

const getLastActivityLabel = (lead: Lead): string => {
  const status = getLeadStatus(lead);
  if (status === 'verified') return 'Last login';
  if (status === 'guest') return 'Placed first order';
  return 'Last OTP request';
};

export default function CustomerLeadsPage() {
  const { isSuperAdmin } = useAuthStore();
  const isSuper = isSuperAdmin();
  const canAccessLeads = isSuper;

  const [filter, setFilter] = useState<LeadFilter>('all');
  const [range, setRange] = useState<FunnelRange>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, unverified: 0, verified: 0, guest: 0 });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canAccessLeads) {
      setLoading(false);
      setError('Customer leads and funnel analytics are only available to super admins.');
      return;
    }
    setLoading(true);
    setError('');
    customerLeadsApi.getAll(filter, range, customFrom || undefined, customTo || undefined)
      .then(response => {
        setLeads(response.data.data || []);
        setCounts(response.data.counts || { total: 0, unverified: 0, verified: 0, guest: 0 });
      })
      .catch(() => setError('Could not load customer leads. Please try again.'))
      .finally(() => setLoading(false));
  }, [filter, range, customFrom, customTo, canAccessLeads]);

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

  const filters = useMemo(() => [
    { id: 'all' as LeadFilter, label: 'All', count: counts.total },
    { id: 'guest' as LeadFilter, label: 'Checkout-only', count: counts.guest },
    { id: 'unverified' as LeadFilter, label: 'OTP not completed', count: counts.unverified },
    { id: 'verified' as LeadFilter, label: 'Verified', count: counts.verified },
  ], [counts]);

  const statusConfig = (lead: Lead) => STATUS_CONFIG[getLeadStatus(lead)];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Customer Leads</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Checkout-only orders, OTP progress and conversion. A checkout-only order can still use a verified mobile number. Reporting uses India time.</p>
        </div>
        <button
          type="button"
          onClick={downloadMarketingCsv}
          disabled={downloading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Download marketing consented leads as CSV"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloading ? 'Preparing CSV...' : 'Download consented list'}
        </button>
      </div>

      <FunnelPanel
        range={range}
        from={customFrom}
        to={customTo}
        onRangeChange={setRange}
        onDateRangeChange={(from, to) => { setCustomFrom(from); setCustomTo(to); }}
      />

      <div
        className="inline-flex w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800 sm:w-auto"
        role="tablist"
        aria-label="Lead status filters"
      >
        {filters.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`min-w-0 flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors sm:flex-none ${
              filter === item.id
                ? 'bg-emerald-500 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {item.label} <span className="ml-1 text-xs opacity-80" aria-hidden="true">{item.count}</span>
          </button>
        ))}
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
        <div className="flex h-64 items-center justify-center" aria-live="polite">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" aria-hidden="true" />
          <span className="sr-only">Loading leads...</span>
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white py-16 text-center text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <Users className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="text-sm">No {filter === 'all' ? '' : `${filter} `}leads yet.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 md:hidden" role="list" aria-label="Leads list">
            {leads.map(lead => (
              <LeadCard key={lead.id} lead={lead} statusConfig={statusConfig(lead)} />
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">Lead</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Status</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Last activity</th>
                  <th className="px-4 py-3 font-semibold" scope="col">OTP requests</th>
                  <th className="px-4 py-3 font-semibold" scope="col">Marketing consent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {leads.map(lead => (
                  <LeadRow key={lead.id} lead={lead} statusConfig={statusConfig(lead)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-gray-500 dark:text-slate-400">The download includes only verified customers who granted marketing consent.</p>
    </div>
  );
}

function LeadCard({ lead, statusConfig }: { lead: Lead; statusConfig: StatusConfig }) {
  return (
    <div className="space-y-2 p-4" role="listitem">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{lead.name || 'Unidentified lead'}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400">
            <Phone className="h-3 w-3" aria-hidden="true" />{lead.phone}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${statusConfig.className}`}>{statusConfig.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500 dark:text-slate-400">{getLastActivityLabel(lead)}</p>
          <p className="mt-0.5 font-medium text-gray-800 dark:text-slate-200">{formatDate(getLastActivityDate(lead))}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-slate-400">OTP requests</p>
          <p className="mt-0.5 font-medium text-gray-800 dark:text-slate-200">{lead.otpRequestCount}</p>
        </div>
      </div>
    </div>
  );
}

function LeadRow({ lead, statusConfig }: { lead: Lead; statusConfig: StatusConfig }) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-semibold text-gray-900 dark:text-white">{lead.name || 'Unidentified lead'}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{lead.phone}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusConfig.className}`}>{statusConfig.label}</span>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDate(getLastActivityDate(lead))}</td>
      <td className="px-4 py-3 font-semibold text-gray-800 dark:text-slate-200">{lead.otpRequestCount}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
        {lead.verifiedAt ? (lead.marketingConsent ? 'Granted' : 'Not granted') : '-'}
      </td>
    </tr>
  );
}