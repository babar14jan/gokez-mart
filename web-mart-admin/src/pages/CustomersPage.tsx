import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { customersApi } from '../services/api';

interface Customer {
  id: string; phone: string; name: string; address: string;
  orderCount: number; totalSpent: number; createdAt: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    customersApi.getAll().then(r => { setCustomers(r.data.data || []); setLoading(false); });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-gray-900 dark:text-white">Customers <span className="text-sm font-normal text-gray-400 dark:text-slate-500">({customers.length})</span></h1>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {customers.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-slate-500"><Users className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="text-sm">No customers yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {customers.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-700">{(c.name || c.phone)[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name || 'Guest'}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{c.phone}{c.address ? ` · ${c.address}` : ''}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">₹{c.totalSpent.toFixed(0)}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{c.orderCount} order{c.orderCount !== 1 ? 's' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
