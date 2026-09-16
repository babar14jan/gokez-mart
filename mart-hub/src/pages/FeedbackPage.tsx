import { useEffect, useState } from 'react';
import { Star, MessageSquare, Filter } from 'lucide-react';
import { feedbackApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';
import { useAuthStore } from '../store/authStore';

const CATEGORY_LABELS: Record<string, string> = {
  delivery:        '🛵 Delivery',
  product_quality: '📦 Product Quality',
  pricing:         '💰 Pricing',
  store_service:   '🏪 Store Service',
  app_experience:  '📱 App Experience',
  suggestion:      '💡 Suggestion',
  other:           '💬 Other',
};

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 dark:text-slate-600'}`} />
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const { role } = useAuthStore();
  const storeId = getActiveStoreId();
  const [feedback, setFeedback] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterRating, setFilterRating] = useState<number | ''>('');
  const [filterCategory, setFilterCategory] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await feedbackApi.getAll({
        storeId: role !== 'super_admin' ? storeId : undefined,
        rating: filterRating || undefined,
        category: filterCategory || undefined,
        limit: 100,
      });
      setFeedback(res.data.data || []);
      setStats(res.data.stats || null);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterRating, filterCategory]);

  return (
    <div className="space-y-4">

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-3 text-center">
            <p className="text-xl font-black text-amber-500">{stats.avg_rating ?? '—'}</p>
            <div className="flex justify-center mt-0.5">
              <StarDisplay rating={Math.round(stats.avg_rating || 0)} />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Avg Rating</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-3 text-center">
            <p className="text-xl font-black text-gray-900 dark:text-white">{stats.total}</p>
            <p className="text-[10px] text-gray-500 mt-1">Total Reviews</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 px-3 py-3 text-center">
            <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{stats.five_star}</p>
            <p className="text-[10px] text-gray-500 mt-1">5 Star</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        <select value={filterRating} onChange={e => setFilterRating(e.target.value ? parseInt(e.target.value) : '')}
          className="text-xs border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500">
          <option value="">All Ratings</option>
          {[5,4,3,2,1].map(r => <option key={r} value={r}>{r} Star{r > 1 ? 's' : ''}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="text-xs border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500">
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : feedback.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No feedback yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {feedback.map(f => (
            <div key={f.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StarDisplay rating={f.rating} />
                    <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                      {CATEGORY_LABELS[f.category] || f.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                    {f.customerName || 'Anonymous'} {f.customerPhone ? `· ${f.customerPhone}` : ''}
                    {f.storeName ? ` · ${f.storeName}` : ''}
                  </p>
                </div>
                <span className="text-[10px] text-gray-500 dark:text-slate-400 flex-shrink-0">
                  {new Date(f.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
              </div>
              {f.message && (
                <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{f.message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
