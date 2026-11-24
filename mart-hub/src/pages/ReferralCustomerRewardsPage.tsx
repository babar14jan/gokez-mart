import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Users, ExternalLink, SlidersHorizontal } from 'lucide-react';
import {
  referralAdminApi, apiErrorMessage,
  type ReferralCustomer, type ReferralLedgerEntry, type ReferralRecord,
} from '../services/referralAdminApi';
import {
  Pagination, EmptyState, PanelHeader, FilterBar, SearchField, ClearButton, StatusBadge, useDebounced,
  fmtMoney, fmtDate, inputClass, filterClass,
} from '../components/referralUi';
import ConfirmDialog from '../components/ConfirmDialog';

const PAGE_SIZE = 20;

const CUSTOMER_FILTERS = [
  { value: 'all', label: 'All customers', countLabel: 'customers' },
  { value: 'referred', label: 'Has referred', countLabel: 'with referrals' },
  { value: 'rewarded', label: 'Rewarded', countLabel: 'rewarded' },
  { value: 'pending', label: 'Pending rewards', countLabel: 'with pending' },
  { value: 'unlocked', label: 'Unlocked credits', countLabel: 'with unlocked' },
  { value: 'none', label: 'No referrals', countLabel: 'without referrals' },
];

type LedgerTotals = {
  issued: number; redeemed: number; expired: number; reversed: number; adjusted: number; balance: number;
};

function totalsFromLedger(entries: ReferralLedgerEntry[]): LedgerTotals {
  const sum = (type: string) => entries
    .filter(tx => tx.type === type)
    .reduce((total, tx) => total + Number(tx.amount || 0), 0);
  return {
    issued: sum('issue'),
    redeemed: sum('redeem'),
    expired: sum('expire'),
    reversed: Math.abs(sum('reverse')),
    adjusted: sum('admin_adjust'),
    balance: entries.length ? Number(entries[0].balanceAfter || 0) : 0,
  };
}

export default function ReferralCustomerRewardsPage({ embedded = false }: { embedded?: boolean }) {
  const [params] = useSearchParams();
  const [deepLinkCustomerId, setDeepLinkCustomerId] = useState(() => params.get('customerId') || '');
  const [searchInput, setSearchInput] = useState('');
  const query = useDebounced(searchInput).trim();
  const [filter, setFilter] = useState('all');
  const [customers, setCustomers] = useState<ReferralCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReferralCustomer | null>(null);
  const [ledger, setLedger] = useState<ReferralLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [network, setNetwork] = useState<ReferralRecord[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await referralAdminApi.getCustomers(query, PAGE_SIZE, offset, deepLinkCustomerId || undefined, filter);
      setCustomers(response.items || []);
      setTotal(response.total || 0);
    } catch {
      setError('Could not search referral customers.');
      setCustomers([]);
    } finally { setLoading(false); }
  }, [query, filter, offset, deepLinkCustomerId]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => { setOffset(0); }, [query, filter]);

  const loadLedger = async (customerId: string) => {
    setLedgerLoading(true);
    try {
      const response = await referralAdminApi.getLedger({ customerId, limit: 500 });
      setLedger(response.items || []);
    } catch {
      setLedger([]);
    } finally { setLedgerLoading(false); }
  };

  const loadNetwork = async (customerId: string) => {
    setNetworkLoading(true);
    setNetworkError('');
    try {
      const response = await referralAdminApi.getRecords({ referrerId: customerId, limit: 100 });
      setNetwork(response.items || []);
    } catch {
      setNetwork([]);
      setNetworkError('Could not load the people they referred.');
    } finally { setNetworkLoading(false); }
  };

  const selectCustomer = (customer: ReferralCustomer) => {
    setSelected(customer);
    setAmount('');
    setReason('');
    setNotice('');
    loadLedger(customer.id);
    loadNetwork(customer.id);
  };

  useEffect(() => {
    if (!deepLinkCustomerId || loading || customers.length === 0) return;
    const match = customers.find(customer => customer.id === deepLinkCustomerId) || customers[0];
    if (match) selectCustomer(match);
    setDeepLinkCustomerId('');
  }, [deepLinkCustomerId, loading, customers]);

  const totals = useMemo(() => totalsFromLedger(ledger), [ledger]);
  const activeFilter = CUSTOMER_FILTERS.find(option => option.value === filter) || CUSTOMER_FILTERS[0];

  const submitAdjustment = async () => {
    if (!selected || !amount.trim() || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await referralAdminApi.adjust(selected.id, Number(amount), reason.trim());
      setNotice(`Adjustment saved. New balance ${fmtMoney(result.balanceAfter)}.`);
      setAmount('');
      setReason('');
      setConfirming(false);
      await Promise.all([loadLedger(selected.id), loadCustomers()]);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save the adjustment.'));
      setConfirming(false);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <PanelHeader embedded={embedded} title="Referral People"
        subtitle="Search a customer to see who they referred, reward totals, pending and unlocked credits, and their full ledger." />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search by name, mobile or referral code" />
        <select aria-label="Filter customers" value={filter}
          onChange={e => setFilter(e.target.value)} className={`${filterClass} w-auto`}>
          {CUSTOMER_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {total.toLocaleString('en-IN')} {activeFilter.countLabel}
        </span>
        {(searchInput || filter !== 'all') && (
          <ClearButton onClick={() => { setSearchInput(''); setFilter('all'); setOffset(0); }} />
        )}
      </FilterBar>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-4">
        <div className="page-card">
          <div className="hidden sm:grid grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_0.8fr_0.7fr] gap-2 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>Customer</div><div className="text-center">Referred</div><div className="text-right">Earned</div>
            <div className="text-right">Pending</div><div className="text-right">Unlocked</div><div className="text-right">Code</div>
          </div>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
          ) : customers.length === 0 ? (
            <EmptyState message="No customers found" hint="Search by name, mobile number or referral code." />
          ) : customers.map(c => (
            <button key={c.id} onClick={() => selectCustomer(c)}
              className={`w-full grid grid-cols-2 sm:grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_0.8fr_0.7fr] gap-2 items-center px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 text-left transition-colors ${
                selected?.id === c.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/40'
              }`}>
              <div className="col-span-2 sm:col-span-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{c.name || 'Customer'}</p>
                <p className="text-[10px] text-gray-500">{c.phone || '—'}</p>
              </div>
              <p className="text-xs text-center text-gray-700 dark:text-slate-300">{c.successfulReferrals}</p>
              <p className="text-xs text-right font-semibold text-gray-900 dark:text-white">{fmtMoney(c.totalEarned)}</p>
              <p className="text-xs text-right text-amber-600 dark:text-amber-400">{fmtMoney(c.pendingAmount)}</p>
              <p className="text-xs text-right text-emerald-600 dark:text-emerald-400">{fmtMoney(c.unlockedAmount)}</p>
              <p className="text-[10px] font-mono text-right text-indigo-600 dark:text-indigo-400 truncate">{c.code || '—'}</p>
            </button>
          ))}
          {!loading && total > 0 && <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />}
        </div>

        {!selected ? (
          <div className="page-card p-8 text-center text-gray-400">
            <Users className="w-9 h-9 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select a customer to review reward totals and adjustments.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="page-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{selected.name || 'Customer'}</p>
                  <p className="text-[11px] text-gray-500">{selected.phone || '—'} · {selected.code || 'No code'}</p>
                </div>
                <Link to={`/referrals?tab=ledger&customerId=${encodeURIComponent(selected.id)}`}
                  className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex-shrink-0">
                  Ledger <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                {[
                  ['People referred', String(selected.successfulReferrals)],
                  ['Rewarded', String(selected.rewardedReferrals)],
                  ['Total earned', fmtMoney(selected.totalEarned)],
                  ['Pending', fmtMoney(selected.pendingAmount)],
                  ['Unlocked', fmtMoney(selected.unlockedAmount)],
                  ['Redeemed', fmtMoney(selected.redeemedAmount)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 px-3 py-2">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                    <p className="text-xs font-bold text-gray-900 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                Total earned counts available, pending and redeemed credits. Pending is reserved for an order;
                unlocked credits are ready to spend. The ledger totals below remain available for audit.
              </p>
            </div>

            <div className="page-card">
              <div className="page-card-header">
                <p className="page-card-title">People referred by {selected.name || selected.phone || 'this customer'}</p>
                <span className="text-[11px] text-gray-500">{network.length} shown</span>
              </div>
              {networkLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
              ) : networkError ? (
                <p className="px-4 py-6 text-xs text-red-500">{networkError}</p>
              ) : network.length === 0 ? (
                <EmptyState message="No referred customers yet" hint="Referrals made by this customer will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-slate-700">
                        <th className="px-4 py-2 text-left font-semibold">Referred customer</th>
                        <th className="px-4 py-2 text-left font-semibold">Status</th>
                        <th className="px-4 py-2 text-left font-semibold">Referred on</th>
                        <th className="px-4 py-2 text-right font-semibold">Order value</th>
                        <th className="px-4 py-2 text-right font-semibold">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {network.map(record => (
                        <tr key={record.id} className="border-b border-gray-50 dark:border-slate-700/50 last:border-0">
                          <td className="px-4 py-2.5">
                            <p className="text-xs font-semibold text-gray-900 dark:text-white">{record.referredName || 'Customer'}</p>
                            <p className="text-[10px] text-gray-500">{record.referredPhone || '—'} · {record.code || 'No code'}</p>
                          </td>
                          <td className="px-4 py-2.5"><StatusBadge status={record.status} /></td>
                          <td className="px-4 py-2.5 text-[11px] text-gray-600 dark:text-slate-400">{fmtDate(record.attributedAt)}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-slate-300">{fmtMoney(record.qualifyingOrderValue || 0)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <p className="text-xs font-bold text-gray-900 dark:text-white">{fmtMoney(record.creditAmount)}</p>
                            <p className="text-[9px] text-gray-400">Pending {fmtMoney(record.pendingAmount)} · Unlocked {fmtMoney(record.unlockedAmount)}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="page-card p-4">
              <p className="text-xs font-bold text-gray-900 dark:text-white mb-3">Reward ledger totals</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Issued', fmtMoney(totals.issued)],
                  ['Redeemed', fmtMoney(totals.redeemed)],
                  ['Expired', fmtMoney(totals.expired)],
                  ['Reversed', fmtMoney(totals.reversed)],
                  ['Adjustments', fmtMoney(totals.adjusted)],
                  ['Balance', fmtMoney(totals.balance)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 px-3 py-2">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                    <p className="text-xs font-bold text-gray-900 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {ledgerLoading ? (
              <div className="page-card flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
            ) : ledger.length > 0 && (
              <div className="page-card">
                <div className="page-card-header"><p className="page-card-title">Recent Ledger Activity</p></div>
                {ledger.slice(0, 8).map(tx => (
                  <div key={tx.id} className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-slate-700 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-900 dark:text-white capitalize">{tx.type.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-gray-500 truncate">{tx.reason || tx.reference}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-bold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{tx.amount >= 0 ? '+' : ''}{fmtMoney(tx.amount)}</p>
                      <p className="text-[9px] text-gray-400">{fmtDate(tx.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="page-card p-4 space-y-3">
              <p className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-emerald-500" /> Manual adjustment
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customer ID</label>
                  <input readOnly value={selected.id} className={`${inputClass} text-[10px] bg-gray-50 dark:bg-slate-700`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹, negative to deduct)</label>
                  <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Reason *</label>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Required for audit" className={inputClass} />
                </div>
              </div>
              <button onClick={() => setConfirming(true)} disabled={!amount.trim() || !reason.trim() || Number(amount) === 0}
                className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50">
                Review adjustment
              </button>
              <p className="text-[10px] text-gray-400">Adjustments append a ledger entry and cannot be edited or deleted.</p>
            </div>
          </div>
        )}
      </div>

      {confirming && selected && (
        <ConfirmDialog
          title="Confirm manual adjustment"
          message={`Apply ${fmtMoney(Number(amount))} to ${selected.name || selected.phone}? Reason: ${reason}`}
          confirmLabel="Apply adjustment"
          onConfirm={submitAdjustment}
          onCancel={() => setConfirming(false)}
        />
      )}
      {saving && <p className="sr-only">Saving adjustment</p>}
    </div>
  );
}
