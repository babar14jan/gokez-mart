import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { feedbackApi } from '../services/api';

const CATEGORIES = [
  { value: 'delivery',        label: '🛵 Delivery',       desc: 'Speed, rider, packaging' },
  { value: 'product_quality', label: '📦 Product Quality', desc: 'Freshness, accuracy' },
  { value: 'pricing',         label: '💰 Pricing',         desc: 'Value for money' },
  { value: 'store_service',   label: '🏪 Store Service',   desc: 'Staff, responsiveness' },
  { value: 'app_experience',  label: '📱 App Experience',  desc: 'Ease of use, bugs' },
  { value: 'suggestion',      label: '💡 Suggestion',      desc: 'Ideas to improve' },
  { value: 'other',           label: '💬 Other',           desc: 'Anything else' },
];

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

interface Props { storeId?: string; orderId?: string; }

export default function FeedbackPage({ storeId, orderId }: Props) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!rating || !category) return;
    setSubmitting(true); setError('');
    try {
      await feedbackApi.submit({ rating, category, message: message.trim() || undefined, storeId, orderId });
      setDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to submit. Please try again.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.history.back()} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900 dark:text-white">Share Feedback</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 pb-36 space-y-5">
        {done ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🎉</div>
            <p className="text-lg font-bold text-gray-900 dark:text-white mb-2">Thank you!</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">Your feedback helps us improve Gokez Mart for everyone.</p>
            <button onClick={() => window.history.back()}
              className="mt-6 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-colors">
              Back
            </button>
          </div>
        ) : (
          <>
            {/* Star rating */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 text-center">
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">How was your experience?</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">Tap a star to rate</p>
              <div className="flex items-center justify-center gap-2 mb-2">
                {[1,2,3,4,5].map(i => (
                  <button key={i}
                    onClick={() => setRating(i)}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(0)}
                    className="transition-transform active:scale-90">
                    <Star
                      className={`w-9 h-9 transition-colors ${
                        i <= (hovered || rating)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-gray-200 dark:text-slate-600'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {(hovered || rating) > 0 && (
                <p className="text-sm font-bold text-amber-500">{STAR_LABELS[hovered || rating]}</p>
              )}
            </div>

            {/* Category */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5">
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-3">What's your feedback about?</p>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(cat => (
                  <button key={cat.value} onClick={() => setCategory(cat.value)}
                    className={`flex flex-col items-start p-3 rounded-xl border-2 text-left transition-all ${
                      category === cat.value
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-600'
                    }`}>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{cat.label}</span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{cat.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5">
              <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Tell us more <span className="text-gray-400 font-normal text-xs">(optional)</span></p>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Share your experience in detail..."
                rows={3}
                className="w-full mt-2 px-3 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 resize-none transition-all"
              />
            </div>

            {error && <p className="text-xs text-red-500 text-center">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={!rating || !category || submitting}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : 'Submit Feedback'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
