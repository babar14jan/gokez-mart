import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, ShoppingBag, Users, Search, X, ChevronDown,
  TrendingUp, Repeat, UserPlus, ClipboardList,
} from 'lucide-react';
import { customersApi, type CustomerSort, type CustomerStats } from '../services/api';

interface Customer {
  id: string; phone: string; name: string | null; address: string | null;
  orderCount: number; completedOrders: number; canceledOrders: number;
  totalSpent: number; createdAt: string;
  identityType: 'signed_in' | 'guest_checkout';
}

type CustomerIdentity = 'all' | Customer['identityType'];

interface CustomerCounts {
  total: number;
  signedIn: number;
  guestCheckout: number;
}

interface CustomerPagination {
  offset: number;
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

const SORT_OPTIONS: { id: CustomerSort; label: string }[] = [
  { id: 'orders_desc', label: 'Most orders' },
  { id: 'spend_desc', label: 'Highest spend' },
  { id: 'name_asc', label: 'Name (A–Z)' },
  { id: 'newest', label: 'Newest' },
];

const EMPTY_STATS: CustomerStats = {
  totalCustomers: 0, totalRevenue: 0, totalOrders: 0,
  repeatCustomers: 0, newCustomers: 0, avgOrders: 0,
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<CustomerIdentity>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<CustomerSort>('orders_desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [counts, setCounts] = useState<CustomerCounts>({ total: 0, signedIn: 0, guestCheckout: 0 });
  const [stats, setStats] = useState<CustomerStats>(EMPTY_STATS);
  const [pagination, setPagination] = useState<CustomerPagination>({ offset: 0, total: 0, hasMore: false });
  const [error, setError] = useState('');

  // Debounce the search text so we don't fire a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setRefreshing(true);
    customersApi.getAll({ identity: activeTab, search: debouncedSearch, sort, limit: PAGE_SIZE, offset: 0 })
      .then(r => {
        if (cancelled) return;
        setCustomers(r.data.data || []);
        setCounts(r.data.counts || { total: 0, signedIn: 0, guestCheckout: 0 });
        setStats(r.data.stats || EMPTY_STATS);
        setPagination(r.data.pagination || { offset: 0, total: 0, hasMore: false });
      })
      .catch(() => { if (!cancelled) setError('Could not load customers. Please try again.'); })
      .finally(() => { if (!cancelled) { setRefreshing(false); setLoading(false); } });
    return () => { cancelled = true; };
  }, [activeTab, sort, debouncedSearch]);

  const loadMore = async () => {
    if (loadingMore || !pagination.hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await customersApi.getAll({ identity: activeTab, search: debouncedSearch, sort, limit: PAGE_SIZE, offset: customers.length });
      setCustomers(current => [...current, ...(response.data.data || [])]);
      setCounts(response.data.counts || counts);
      setStats(response.data.stats || stats);
      setPagination(response.data.pagination || pagination);
    } catch {
      setError('Could not load more customers. Please try again.');
    } finally { setLoadingMore(false); }
  };

  const repeatShare = stats.totalCustomers > 0 ? Math.round((stats.repeatCustomers / stats.totalCustomers) * 100) : 0;

  const kpis = useMemo(() => ([
    { label: 'Total Customers', value: stats.totalCustomers.toLocaleString('en-IN'), sub: `${counts.signedIn} signed in · ${counts.guestCheckout} guest`, icon: Users, gradient: 'from-cyan-500 to-cyan-600' },
    { label: 'New Customers', value: stats.newCustomers.toLocaleString('en-IN'), sub: 'last 30 days', icon: UserPlus, gradient: 'from-violet-500 to-violet-600' },
    { label: 'Returning Customers', value: stats.repeatCustomers.toLocaleString('en-IN'), sub: `${repeatShare}% · all-time repeat buyers`, icon: Repeat, gradient: 'from-amber-500 to-amber-600' },
    { label: 'Avg Orders', value: stats.avgOrders, sub: 'per customer', icon: ClipboardList, gradient: 'from-blue-500 to-blue-600' },
  ]), [stats, repeatShare, counts]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  const tabs = [
    { id: 'all' as const, label: 'All', count: counts.total },
    { id: 'signed_in' as const, label: 'Signed In', count: counts.signedIn },
    { id: 'guest_checkout' as const, label: 'Guest', count: counts.guestCheckout },
  ];

  const activeSort = SORT_OPTIONS.find(o => o.id === sort) || SORT_OPTIONS[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Customers <span className="text-sm font-normal text-gray-500 dark:text-slate-400">({counts.total})</span></h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Separate OTP-signed-in customers from direct guest checkout customers.</p>
      </div>

      {/* Analytics KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-stretch">
        {kpis.map(k => (
          <div key={k.label} className="kpi-card h-full cursor-default">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${k.gradient} flex items-center justify-center flex-shrink-0`}>
              <k.icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{k.value}</p>
              <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mt-1 truncate">{k.label}</p>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 mt-1 truncate">{k.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="inline-flex w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800 sm:w-auto" role="tablist" aria-label="Customer identity filters">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`min-w-0 flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors sm:flex-none ${
              activeTab === tab.id
                ? 'bg-emerald-500 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label} <span className="ml-1 text-xs opacity-80">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Sort button + search box on the same line */}
      <div className="flex items-center gap-2">
        <div className="relative inline-block flex-shrink-0">
          <button
            type="button"
            onClick={() => setSortOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-gray-400 transition-all"
          >
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            Sort: {activeSort.label}
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
              <div className="absolute top-full mt-1.5 left-0 w-48 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-1.5 z-20">
                {SORT_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => { setSort(option.id); setSortOpen(false); }}
                    className={`w-full flex items-center px-3 py-2 text-xs font-semibold transition-colors ${
                      sort === option.id
                        ? 'bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white'
                        : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span className="flex-1 text-left">{option.label}</span>
                    {sort === option.id && <span className="text-emerald-500">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or mobile"
            className="w-full pl-9 pr-8 py-2 text-xs bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</div>}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {refreshing && customers.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-500 dark:text-slate-400 border-b border-gray-50 dark:border-slate-700">
            <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            Updating…
          </div>
        )}
        {customers.length === 0 ? (
          <div className="text-center py-16 text-gray-500 dark:text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {debouncedSearch
                ? `No customers match “${debouncedSearch}”.`
                : `No ${activeTab === 'all' ? '' : activeTab === 'signed_in' ? 'signed-in ' : 'guest checkout '}customers yet.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {customers.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${c.identityType === 'signed_in' ? 'bg-emerald-100' : 'bg-violet-100'}`}>
                  <span className={`text-sm font-bold ${c.identityType === 'signed_in' ? 'text-emerald-700' : 'text-violet-700'}`}>{(c.name || c.phone)[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name || 'Customer'}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.identityType === 'signed_in' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'}`}>
                      {c.identityType === 'signed_in' ? <ShieldCheck className="h-3 w-3" /> : <ShoppingBag className="h-3 w-3" />}
                      {c.identityType === 'signed_in' ? 'Signed in' : 'Guest checkout'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{c.phone}{c.address ? ` · ${c.address}` : ''}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">₹{c.totalSpent.toFixed(0)}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {c.completedOrders} completed · {c.canceledOrders} canceled
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {customers.length > 0 && pagination.hasMore && (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore}
            className="min-h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            {loadingMore ? 'Loading...' : `Load more (${customers.length} of ${pagination.total})`}
          </button>
        </div>
      )}
    </div>
  );
}
