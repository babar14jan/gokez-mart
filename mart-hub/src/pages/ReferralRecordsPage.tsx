import { useCallback, useEffect, useState } from 'react';
import { Search, X, Loader2, FileText } from 'lucide-react';
import {
  referralAdminApi,
  type ReferralRecord, type ReferralRecordDetail, type ReferralAuditEntry,
} from '../services/referralAdminApi';
import {
  StatusBadge, Pagination, DetailDrawer, FieldRow, EmptyState,
  fmtDate, fmtMoney, inputClass,
} from '../components/referralUi';

const PAGE_SIZE = 20;
const STATUSES = ['pending', 'qualified', 'rewarded', 'capped', 'rejected', 'expired'];

export default function ReferralRecordsPage() {
  const [items, setItems] = useState<ReferralRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ReferralRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [audit, setAudit] = useState<ReferralAuditEntry[]>([]);

  const dateFiltered = Boolean(from || to);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (dateFiltered) {
        // The records endpoint has no date parameters. For a date range we pull
        // the largest allowed page and narrow it in the browser, then paginate
        // that narrowed set so the pager still reflects what is on screen.
        const response = await referralAdminApi.getRecords({ status: status || undefined, search: search || undefined, limit: 500, offset: 0 });
        const matching = (response.items || []).filter(row => {
          const day = String(row.attributedAt || '').slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        });
        setTotal(matching.length);
        setItems(matching.slice(offset, offset + PAGE_SIZE));
      } else {
        const response = await referralAdminApi.getRecords({
          status: status || undefined,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setItems(response.items || []);
        setTotal(response.total || 0);
      }
    } catch {
      setError('Could not load referral records.');
      setItems([]);
      setTotal(0);
    } finally { setLoading(false); }
  }, [dateFiltered, status, search, from, to, offset]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetail(null);
    setAudit([]);
    setDetailLoading(true);
    try {
      const [record, log] = await Promise.all([
        referralAdminApi.getRecord(id),
        referralAdminApi.getAudit({ entityType: 'referral', entityId: id, limit: 100 }),
      ]);
      setDetail(record);
      setAudit(log.items || []);
    } catch {
      setError('Could not load this referral record.');
    } finally { setDetailLoading(false); }
  };

  const submitSearch = () => { setOffset(0); setSearch(searchInput.trim()); };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Referral Records</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">Attributions, qualification state and reward lifecycle per referral.</p>
      </div>

      <div className="page-card p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-[220px]">
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
            placeholder="Search phone, code, referrer or referee"
            className={inputClass} />
          <button onClick={submitSearch} className="p-2 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 flex-shrink-0" title="Search">
            <Search className="w-4 h-4" />
          </button>
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}
          className={`${inputClass} w-auto text-xs py-2`}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} aria-label="From date"
          className={`${inputClass} w-auto text-xs py-2`} />
        <span className="text-xs text-gray-500">to</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0); }} aria-label="To date"
          className={`${inputClass} w-auto text-xs py-2`} />
        {(search || status || from || to) && (
          <button onClick={() => { setSearch(''); setSearchInput(''); setStatus(''); setFrom(''); setTo(''); setOffset(0); }}
            className="text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="page-card">
        <div className="hidden lg:grid grid-cols-[1.2fr_1fr_1fr_1fr_0.8fr_auto] gap-3 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          <div>Code / Phones</div><div>Status</div><div>Campaign</div><div>Attributed</div><div className="text-right">Order value</div><div />
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : items.length === 0 ? (
          <EmptyState message="No referral records found" hint="Try a different search or status filter." />
        ) : items.map(row => (
          <button key={row.id} onClick={() => openDetail(row.id)}
            className="w-full grid grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_0.8fr_auto] gap-3 items-center px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700/40 text-left">
            <div className="col-span-2 lg:col-span-1 min-w-0">
              <p className="text-xs font-bold text-gray-900 dark:text-white font-mono">{row.code || '—'}</p>
              <p className="text-[10px] text-gray-500 truncate">{row.referrerPhone || '—'} → {row.referredPhone || '—'}</p>
            </div>
            <StatusBadge status={row.status} />
            <p className="text-[11px] text-gray-600 dark:text-slate-400 truncate">{row.campaignName || '—'} {row.campaignVersion ? `v${row.campaignVersion}` : ''}</p>
            <p className="text-[11px] text-gray-500">{fmtDate(row.attributedAt)}</p>
            <p className="text-xs font-semibold text-gray-900 dark:text-white text-right">{row.qualifyingOrderValue != null ? fmtMoney(row.qualifyingOrderValue) : '—'}</p>
            <FileText className="w-4 h-4 text-gray-400 col-span-2 lg:col-span-1 justify-self-end" />
          </button>
        ))}
        {!loading && total > 0 && <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />}
      </div>

      {dateFiltered && (
        <p className="text-[10px] text-gray-500 dark:text-slate-400">
          Date range is applied to the attribution timestamp. The backend records endpoint filters by status and search only,
          so ranges are narrowed from the most recent 500 records.
        </p>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-sm">
          <div className="w-full sm:max-w-xl bg-white dark:bg-slate-800 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          </div>
        </div>
      )}

      {detail && !detailLoading && (
        <DetailDrawer title="Referral Record" subtitle={detail.id} onClose={() => setDetail(null)}>
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-1">
              <FieldRow label="Status"><StatusBadge status={detail.status} /></FieldRow>
              <FieldRow label="Code">{detail.code || '—'}</FieldRow>
              <FieldRow label="Attribution source">{detail.attribution_source || '—'}</FieldRow>
              <FieldRow label="Campaign">{detail.campaignName || '—'} {detail.campaignVersion ? `v${detail.campaignVersion}` : ''}</FieldRow>
              <FieldRow label="Attributed">{fmtDate(detail.attributed_at)}</FieldRow>
              <FieldRow label="Qualified">{fmtDate(detail.qualified_at)}</FieldRow>
              <FieldRow label="Rewarded">{fmtDate(detail.rewarded_at)}</FieldRow>
              <FieldRow label="Qualifying order">{detail.qualifying_order_id || '—'}</FieldRow>
              <FieldRow label="Qualifying value">{detail.qualifying_order_value != null ? fmtMoney(detail.qualifying_order_value) : '—'}</FieldRow>
              <FieldRow label="Notes">{detail.notes || '—'}</FieldRow>
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Rewards</p>
              {detail.rewards?.length ? (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-400 border-b border-gray-100 dark:border-slate-700"><th className="py-1.5 font-semibold">Role</th><th className="py-1.5 font-semibold text-right">Amount</th><th className="py-1.5 font-semibold text-right">State</th></tr></thead>
                  <tbody>{detail.rewards.map(r => (
                    <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
                      <td className="py-2 capitalize">{r.role}</td>
                      <td className="py-2 text-right font-semibold">{fmtMoney(r.amount)}</td>
                      <td className="py-2 text-right"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-xs text-gray-400">No rewards issued.</p>}
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Credits</p>
              {detail.credits?.length ? (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-400 border-b border-gray-100 dark:border-slate-700"><th className="py-1.5 font-semibold">Amount</th><th className="py-1.5 font-semibold">State</th><th className="py-1.5 font-semibold text-right">Order</th></tr></thead>
                  <tbody>{detail.credits.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 dark:border-slate-700/50">
                      <td className="py-2 font-semibold">{fmtMoney(c.amount)}</td>
                      <td className="py-2"><StatusBadge status={c.status} /></td>
                      <td className="py-2 text-right font-mono text-[10px] text-gray-500">{c.orderId || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-xs text-gray-400">No credits issued.</p>}
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Ledger</p>
              {detail.ledger?.length ? detail.ledger.map(tx => (
                <div key={tx.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-50 dark:border-slate-700/50">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-900 dark:text-white capitalize">{tx.type.replace(/_/g, ' ')}</p>
                    <p className="text-[10px] text-gray-500">{tx.reason || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-bold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{tx.amount >= 0 ? '+' : ''}{fmtMoney(tx.amount)}</p>
                    <p className="text-[9px] text-gray-400">{fmtDate(tx.createdAt)}</p>
                  </div>
                </div>
              )) : <p className="text-xs text-gray-400">No ledger entries.</p>}
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Audit trail</p>
              {audit.length === 0 ? <p className="text-xs text-gray-400">No audit entries.</p> : audit.map(entry => (
                <div key={entry.id} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 px-3 py-2 mb-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-gray-900 dark:text-white capitalize">{entry.action.replace(/_/g, ' ')}</p>
                    <p className="text-[9px] text-gray-400">{fmtDate(entry.createdAt)}</p>
                  </div>
                  {entry.reason && <p className="text-[10px] text-gray-500 mt-0.5">{entry.reason}</p>}
                </div>
              ))}
            </div>
          </div>
        </DetailDrawer>
      )}
    </div>
  );
}
