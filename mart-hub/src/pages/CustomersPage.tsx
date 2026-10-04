import { useEffect, useState } from 'react';
import { ShieldCheck, ShoppingBag, Users } from 'lucide-react';
import { customersApi } from '../services/api';

interface Customer {
  id: string; phone: string; name: string | null; address: string | null;
  orderCount: number; totalSpent: number; createdAt: string;
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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<CustomerIdentity>('all');
  const [counts, setCounts] = useState<CustomerCounts>({ total: 0, signedIn: 0, guestCheckout: 0 });
  const [pagination, setPagination] = useState<CustomerPagination>({ offset: 0, total: 0, hasMore: false });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    customersApi.getAll({ identity: activeTab, limit: PAGE_SIZE, offset: 0 })
      .then(r => {
        if (cancelled) return;
        setCustomers(r.data.data || []);
        setCounts(r.data.counts || { total: 0, signedIn: 0, guestCheckout: 0 });
        setPagination(r.data.pagination || { offset: 0, total: 0, hasMore: false });
      })
      .catch(() => { if (!cancelled) setError('Could not load customers. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const loadMore = async () => {
    if (loadingMore || !pagination.hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await customersApi.getAll({ identity: activeTab, limit: PAGE_SIZE, offset: customers.length });
      setCustomers(current => [...current, ...(response.data.data || [])]);
      setCounts(response.data.counts || counts);
      setPagination(response.data.pagination || pagination);
    } catch {
      setError('Could not load more customers. Please try again.');
    } finally { setLoadingMore(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  const tabs = [
    { id: 'all' as const, label: 'All', count: counts.total },
    { id: 'signed_in' as const, label: 'Signed in', count: counts.signedIn },
    { id: 'guest_checkout' as const, label: 'Guest checkout', count: counts.guestCheckout },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Customers <span className="text-sm font-normal text-gray-500 dark:text-slate-400">({counts.total})</span></h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Separate OTP-signed-in customers from direct guest checkout customers.</p>
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
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</div>}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {customers.length === 0 ? (
          <div className="text-center py-16 text-gray-500 dark:text-slate-400"><Users className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="text-sm">No {activeTab === 'all' ? '' : activeTab === 'signed_in' ? 'signed-in ' : 'guest checkout '}customers yet.</p></div>
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
                  <p className="text-xs text-gray-500 dark:text-slate-400">{c.orderCount} order{c.orderCount !== 1 ? 's' : ''}</p>
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
