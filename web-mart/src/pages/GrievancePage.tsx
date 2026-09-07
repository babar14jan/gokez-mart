import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { authApi } from '../services/api';

const inp = 'w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400';

const STATUS_COLORS: Record<string, string> = {
  open:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  resolved:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  closed:      'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
};

export default function GrievancePage() {
  const [grievances, setGrievances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authApi.getGrievances().then(r => setGrievances(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true); setError('');
    try {
      await authApi.submitGrievance(subject.trim(), description.trim());
      setSubmitted(true); setSubject(''); setDescription('');
      const r = await authApi.getGrievances();
      setGrievances(r.data.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.history.back()} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900 dark:text-white">Submit a Grievance</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 space-y-4 pb-24">

        {/* Submit form */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">
            Under the DPDP Act 2023, you have the right to raise a grievance about how your data is handled. We will respond within 30 days.
          </p>
          {submitted && <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs px-3 py-2 rounded-xl mb-3">✓ Grievance submitted successfully.</div>}
          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-xs px-3 py-2 rounded-xl mb-3">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Subject *</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={inp} placeholder="e.g. Wrong item delivered" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Description *</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} className={`${inp} resize-none`} rows={4} placeholder="Describe your concern in detail..." required />
            </div>
            <button type="submit" disabled={submitting || !subject.trim() || !description.trim()}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : 'Submit Grievance'}
            </button>
          </form>
        </div>

        {/* Past grievances */}
        {!loading && grievances.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide px-1">Past Grievances</p>
            <div className="space-y-2">
              {grievances.map(g => (
                <div key={g.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{g.subject}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[g.status] || ''}`}>{g.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">{g.description}</p>
                  {g.response && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">Our Response</p>
                      <p className="text-xs text-gray-700 dark:text-slate-300">{g.response}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-2">{new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
