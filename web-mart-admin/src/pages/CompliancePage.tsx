import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, MessageSquare } from 'lucide-react';
import { complianceApi } from '../services/api';

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';

const GRIEVANCE_STATUS_COLORS: Record<string, string> = {
  open:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  resolved:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  closed:      'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
};

const DELETION_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

type Tab = 'grievances' | 'deletions';

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>('grievances');
  const [grievances, setGrievances] = useState<any[]>([]);
  const [deletions, setDeletions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [responseStatus, setResponseStatus] = useState('resolved');
  const [activeGrievance, setActiveGrievance] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [gr, dr] = await Promise.all([
      complianceApi.getGrievances().catch(() => ({ data: { data: [] } })),
      complianceApi.getDeletions().catch(() => ({ data: { data: [] } })),
    ]);
    setGrievances(gr.data.data || []);
    setDeletions(dr.data.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRespond = async (id: string) => {
    if (!responseText.trim()) return;
    setResponding(id);
    try {
      await complianceApi.respondGrievance(id, responseText.trim(), responseStatus);
      setActiveGrievance(null); setResponseText('');
      await load();
    } finally { setResponding(null); }
  };

  const handleDeletion = async (id: string, action: 'approved' | 'rejected') => {
    setResponding(id);
    try { await complianceApi.processDeletion(id, action); await load(); }
    finally { setResponding(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-slate-700">
        {([['grievances', 'Grievances', grievances.filter(g => g.status === 'open').length],
           ['deletions',  'Deletion Requests', deletions.filter(d => d.status === 'pending').length]] as const).map(([id, label, count]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all ${
              tab === id ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}>
            {label}
            {count > 0 && <span className="text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">{count}</span>}
          </button>
        ))}
      </div>

      {/* Grievances */}
      {tab === 'grievances' && (
        <div className="space-y-3">
          {grievances.length === 0 ? (
            <div className="page-card text-center py-12 text-gray-400 dark:text-slate-500">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No grievances yet.</p>
            </div>
          ) : grievances.map(g => (
            <div key={g.id} className="page-card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{g.subject}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${GRIEVANCE_STATUS_COLORS[g.status] || ''}`}>{g.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{g.customerName || 'Unknown'} · {g.customerPhone} · {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-400 mb-3">{g.description}</p>
              {g.response && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl px-3 py-2 mb-3">
                  <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">Your Response</p>
                  <p className="text-xs text-gray-700 dark:text-slate-300">{g.response}</p>
                </div>
              )}
              {g.status !== 'closed' && g.status !== 'resolved' && (
                activeGrievance === g.id ? (
                  <div className="space-y-2">
                    <textarea value={responseText} onChange={e => setResponseText(e.target.value)}
                      className={`${inp} resize-none`} rows={3} placeholder="Write your response..." />
                    <div className="flex gap-2 items-center">
                      <select value={responseStatus} onChange={e => setResponseStatus(e.target.value)} className={`${inp} flex-shrink-0 w-auto`}>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                      <button onClick={() => handleRespond(g.id)} disabled={responding === g.id || !responseText.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-colors">
                        {responding === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Send'}
                      </button>
                      <button onClick={() => { setActiveGrievance(null); setResponseText(''); }} className="px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setActiveGrievance(g.id)} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                    Respond →
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deletion requests */}
      {tab === 'deletions' && (
        <div className="space-y-3">
          {deletions.length === 0 ? (
            <div className="page-card text-center py-12 text-gray-400 dark:text-slate-500">
              <p className="text-sm">No deletion requests.</p>
            </div>
          ) : deletions.map(d => (
            <div key={d.id} className="page-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{d.customerName || 'Unknown'}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${DELETION_STATUS_COLORS[d.status] || ''}`}>{d.status}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{d.customerPhone} · {new Date(d.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  {d.reason && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">Reason: {d.reason}</p>}
                  {d.notes && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Notes: {d.notes}</p>}
                </div>
                {d.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => handleDeletion(d.id, 'approved')} disabled={responding === d.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-colors">
                      {responding === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Approve
                    </button>
                    <button onClick={() => handleDeletion(d.id, 'rejected')} disabled={responding === d.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl hover:bg-red-100 disabled:opacity-50 transition-colors">
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
