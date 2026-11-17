import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Download, Loader2, X } from 'lucide-react';
import {
  referralAdminApi, downloadReferralCsv, apiErrorMessage,
  type ReferralLedgerEntry,
} from '../services/referralAdminApi';
import { Pagination, EmptyState, StatusBadge, fmtMoney, fmtDate, inputClass } from '../components/referralUi';

const PAGE_SIZE = 20;
const TYPES = ['issue', 'redeem', 'expire', 'reverse', 'admin_adjust', 'earn', 'spend'];

export default function ReferralRewardsLedgerPage() {
  const [params, setParams] = useSearchParams();
  const [customerId, setCustomerId] = useState(params.get('customerId') || '');
  const [type, setType] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
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

  const submitSearch = () => { setOffset(0); setQuery(queryInput.trim()); };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try { await downloadReferralCsv('ledger'); }
    catch (e) { setError(apiErrorMessage(e, 'Could not download the ledger export.')); }
    finally { setExporting(false); }
  };

  const clearFilters = () => {
    setCustomerId(''); setType(''); setQuery(''); setQueryInput(''); setFrom(''); setTo(''); setOffset(0);
    setParams({});
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Rewards Ledger</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Append-only history of every reward, credit, redemption and adjustment.</p>
        </div>
        <button onClick={exportCsv} disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
      </div>

      <div className="page-card p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-[200px]">
          <input value={queryInput} onChange={e => setQueryInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
            placeholder="Search reference, reason or ID" className={inputClass} />
          <button onClick={submitSearch} className="p-2 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600" title="Search">
            <Search className="w-4 h-4" />
          </button>
        </div>
        <input value={customerId} onChange={e => { setCustomerId(e.target.value.trim()); setOffset(0); }}
          placeholder="Customer ID" className={`${inputClass} w-auto text-xs py-2`} />
        <select value={type} onChange={e => { setType(e.target.value); setOffset(0); }}
          className={`${inputClass} w-auto text-xs py-2`}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} aria-label="From date"
          className={`${inputClass} w-auto text-xs py-2`} />
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0); }} aria-label="To date"
          className={`${inputClass} w-auto text-xs py-2`} />
        {(customerId || type || query || from || to) && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
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
