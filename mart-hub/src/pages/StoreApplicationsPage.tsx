import { useEffect, useState } from 'react';
import { Store, CheckCircle, XCircle, Clock, Phone, MapPin, User, MessageSquare, Loader2 } from 'lucide-react';
import { storeApplicationsApi } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface Application {
  id: string;
  storeName: string;
  ownerName: string;
  phone: string;
  area: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',     icon: Clock },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',             icon: XCircle },
};

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

export default function StoreApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [confirm, setConfirm] = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null);

  const load = async () => {
    try { const r = await storeApplicationsApi.getAll(); setApplications(r.data.data || []); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAction = async (id: string, status: 'approved' | 'rejected') => {
    setProcessing(id);
    try { await storeApplicationsApi.update(id, status); await load(); }
    catch { alert('Failed to update application'); }
    finally { setProcessing(null); setConfirm(null); }
  };

  const filtered = applications.filter(a => filter === 'all' || a.status === filter);
  const counts = {
    all: applications.length,
    pending: applications.filter(a => a.status === 'pending').length,
    approved: applications.filter(a => a.status === 'approved').length,
    rejected: applications.filter(a => a.status === 'rejected').length,
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'pending', 'approved', 'rejected'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filter === f
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
            }`}>
            <span className="capitalize">{f}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${filter === f ? 'bg-emerald-400 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}`}>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="page-card text-center py-12 text-gray-400 dark:text-slate-500">
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No {filter === 'all' ? '' : filter} applications.</p>
          {filter === 'pending' && (
            <p className="text-xs mt-1">Share <strong>hub.gokez.com/apply</strong> with store owners to get applications.</p>
          )}
        </div>
      ) : (
        <div className="page-card overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {filtered.map(app => {
              const cfg = STATUS_CONFIG[app.status];
              const StatusIcon = cfg.icon;
              return (
                <div key={app.id} className="px-4 py-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Store className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{app.storeName}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">
                          {new Date(app.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${cfg.color}`}>
                      <StatusIcon className="w-3 h-3" />{cfg.label}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 pl-13">
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                      <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      {app.ownerName}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                      <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      {app.phone}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 sm:col-span-2">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      {app.area}
                    </div>
                    {app.message && (
                      <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-slate-400 sm:col-span-2 bg-gray-50 dark:bg-slate-700/50 rounded-xl p-2.5">
                        <MessageSquare className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                        <span className="italic">{app.message}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions — only for pending */}
                  {app.status === 'pending' && (
                    <div className="flex gap-2 pt-3 border-t border-gray-50 dark:border-slate-700">
                      <button onClick={() => setConfirm({ id: app.id, action: 'rejected' })}
                        disabled={processing === app.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                      <button onClick={() => setConfirm({ id: app.id, action: 'approved' })}
                        disabled={processing === app.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50">
                        {processing === app.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <CheckCircle className="w-3.5 h-3.5" />}
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'approved' ? 'Approve Application' : 'Reject Application'}
          message={confirm.action === 'approved'
            ? 'Approve this store? You can then create their store and account from the Stores page.'
            : 'Reject this application?'}
          confirmLabel={confirm.action === 'approved' ? 'Approve' : 'Reject'}
          danger={confirm.action === 'rejected'}
          onConfirm={() => handleAction(confirm.id, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
