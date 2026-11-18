import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import {
  referralAdminApi, downloadReferralCsv, apiErrorMessage,
  type ReferralLedgerEntry,
} from '../services/referralAdminApi';
import {
  Pagination, EmptyState, StatusBadge, PanelHeader, FilterBar, SearchField,
  DateRangeFilter, ClearButton, useDebounced, filterClass, fmtMoney, fmtDate,
} from '../components/referralUi';

const PAGE_SIZE = 20;
const TYPES = ['issue', 'reserve', 'restore', 'redeem', 'expire', 'reverse', 'admin_adjust'];

export default function ReferralRewardsLedgerPage({ embedded = false }: { embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [customerId, setCustomerId] = useState(params.get('customerId') || '');
  const [type, setType] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const query = useDebounced(queryInput).trim();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ReferralLedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await referralAdminApi.getLedger({
        customerId: customerId || undefined,
        type: type || undefined,
        query: query || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load the rewards ledger.'));
      setItems([]);
      setTotal(0);
    } finally { setLoading(false); }
  }, [customerId, type, query, from, to, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [query, customerId, type, from, to]);

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try { await downloadReferralCsv('ledger', { from: from || undefined, to: to || undefined }); }
    catch (e) { setError(apiErrorMessage(e, 'Could not download the ledger export.')); }
    finally { setExporting(false); }
  };

  const clearFilters = () => {
    setCustomerId(''); setType(''); setQueryInput(''); setFrom(''); setTo(''); setOffset(0);
    setParams({ tab: 'ledger' }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PanelHeader embedded={embedded} title="Rewards Ledger"
        subtitle="Append-only history of every reward, credit, redemption and adjustment."
        actions={<button onClick={exportCsv} disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> {exporting ? 'Preparing…' : 'Export CSV'}
        </button>} />

      <FilterBar>
        <SearchField value={queryInput} onChange={setQueryInput} placeholder="Search reference, reason or ID" />
        <input value={customerId} onChange={e => setCustomerId(e.target.value.trim())}
          placeholder="Customer ID" className={`${filterClass} w-32`} />
        <select value={type} onChange={e => setType(e.target.value)} className={`${filterClass} w-auto`}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <DateRangeFilter from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
        {(customerId || type || queryInput || from || to) && <ClearButton onClick={clearFilters} />}
      </FilterBar>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="page-card">
        <div className="hidden xl:grid grid-cols-[1fr_1.1fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>Type / Reference</div><div>Reason</div><div>Customer</div><div>Referral / Order</div><div className="text-right">Amount</div><div className="text-right">Balance after</div>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : items.length === 0 ? (
          <EmptyState message="No ledger entries found" hint="Try clearing a filter or exporting the full ledger." />
        ) : items.map(tx => (
          <div key={tx.id} className="grid grid-cols-2 xl:grid-cols-[1fr_1.1fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0">
            <div className="col-span-2 xl:col-span-1 min-w-0">
              <StatusBadge status={tx.type} />
              <p className="text-[10px] font-mono text-gray-500 mt-1 truncate">{tx.reference}</p>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-slate-400 truncate">{tx.reason || '—'}</p>
            <p className="text-[10px] font-mono text-gray-500 truncate">{tx.customerId || '—'}</p>
            <p className="text-[10px] font-mono text-gray-500 truncate">
              {tx.referralId ? `R:${tx.referralId.slice(0, 8)}` : ''}{tx.referralId && tx.orderId ? ' · ' : ''}{tx.orderId ? `O:${tx.orderId.slice(0, 8)}` : ''}{!tx.referralId && !tx.orderId ? '—' : ''}
            </p>
            <p className={`text-xs font-bold text-right ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {tx.amount >= 0 ? '+' : ''}{fmtMoney(tx.amount)}
            </p>
            <p className="text-xs text-right text-gray-900 dark:text-white">
              {fmtMoney(tx.balanceAfter)}
              <span className="block text-[9px] font-normal text-gray-400">{fmtDate(tx.createdAt)}</span>
            </p>
          </div>
        ))}
        {!loading && total > 0 && <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-slate-400">
        The ledger is immutable. Corrections are recorded as new <span className="font-mono">admin_adjust</span> entries.
      </p>
    </div>
  );
}
