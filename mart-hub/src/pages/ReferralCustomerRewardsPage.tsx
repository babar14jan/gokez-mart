import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Users, ExternalLink, SlidersHorizontal } from 'lucide-react';
import {
  referralAdminApi, apiErrorMessage,
  type ReferralCustomer, type ReferralLedgerEntry,
} from '../services/referralAdminApi';
import {
  Pagination, EmptyState, PanelHeader, FilterBar, SearchField, useDebounced,
  fmtMoney, fmtDate, inputClass,
} from '../components/referralUi';
import ConfirmDialog from '../components/ConfirmDialog';

const PAGE_SIZE = 20;

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
  const [searchInput, setSearchInput] = useState('');
  const query = useDebounced(searchInput).trim();
  const [customers, setCustomers] = useState<ReferralCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReferralCustomer | null>(null);
  const [ledger, setLedger] = useState<ReferralLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
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
      const response = await referralAdminApi.getCustomers(query, PAGE_SIZE, offset);
      setCustomers(response.items || []);
      setTotal(response.total || 0);
    } catch {
      setError('Could not search referral customers.');
      setCustomers([]);
    } finally { setLoading(false); }
  }, [query, offset]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => { setOffset(0); }, [query]);

  const loadLedger = async (customerId: string) => {
    setLedgerLoading(true);
    try {
      const response = await referralAdminApi.getLedger({ customerId, limit: 500 });
      setLedger(response.items || []);
    } catch {
      setLedger([]);
    } finally { setLedgerLoading(false); }
  };

  const selectCustomer = (customer: ReferralCustomer) => {
    setSelected(customer);
    setAmount('');
    setReason('');
    setNotice('');
    loadLedger(customer.id);
  };

  const totals = useMemo(() => totalsFromLedger(ledger), [ledger]);

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
      <PanelHeader embedded={embedded} title="Customer Rewards"
        subtitle="Search customers, review their referral rewards and apply manual adjustments." />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search by phone, name or referral code" />
        <span className="text-[11px] text-gray-500">{total.toLocaleString('en-IN')} customers</span>
      </FilterBar>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="page-card">
          <div className="hidden sm:grid grid-cols-[1.5fr_0.7fr_0.8fr_0.8fr] gap-2 px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            <div>Customer</div><div className="text-center">Referrals</div><div className="text-center">Credits</div><div className="text-right">Code</div>
          </div>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
          ) : customers.length === 0 ? (
            <EmptyState message="No customers found" hint="Search by phone number, name or referral code." />
          ) : customers.map(c => (
            <button key={c.id} onClick={() => selectCustomer(c)}
              className={`w-full grid grid-cols-2 sm:grid-cols-[1.5fr_0.7fr_0.8fr_0.8fr] gap-2 items-center px-4 py-3 border-b border-gray-50 dark:border-slate-700 last:border-0 text-left transition-colors ${
                selected?.id === c.id ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-700/40'
              }`}>
              <div className="col-span-2 sm:col-span-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{c.name || 'Customer'}</p>
                <p className="text-[10px] text-gray-500">{c.phone || '—'}</p>
              </div>
              <p className="text-xs text-center text-gray-700 dark:text-slate-300">{c.successfulReferrals}</p>
              <p className="text-xs text-center text-gray-700 dark:text-slate-300">{c.availableCredits}</p>
              <p className="text-[10px] font-mono text-right text-indigo-600 dark:text-indigo-400">{c.code || '—'}</p>
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
                  ['Referral count', String(selected.successfulReferrals)],
                  ['Available credits', String(selected.availableCredits)],
                  ['Rewards issued', fmtMoney(totals.issued)],
                  ['Redeemed', fmtMoney(totals.redeemed)],
                  ['Expired', fmtMoney(totals.expired)],
                  ['Reversed', fmtMoney(totals.reversed)],
                  ['Adjustments', fmtMoney(totals.adjusted)],
                  ['Balance (ledger)', fmtMoney(totals.balance)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-gray-50 dark:bg-slate-700/50 px-3 py-2">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                    <p className="text-xs font-bold text-gray-900 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                Reward totals and the balance are derived from the append-only ledger. The customers endpoint supplies the
                referral count and available credit count; per-status credit balances are not exposed by the API.
              </p>
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
