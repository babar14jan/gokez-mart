import { useState } from 'react';
import { Store, CheckCircle, ArrowRight, Loader2, Phone, MapPin, User, MessageSquare } from 'lucide-react';
import { api } from '../services/api';

const inp = 'w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-600 transition-all';

const BENEFITS = [
  { icon: '📱', title: 'Your store on every phone', sub: 'Customers order from you without leaving home' },
  { icon: '🏘️', title: 'Zone exclusivity', sub: 'Your area is yours — no competing store in your zone' },
  { icon: '💰', title: 'Keep majority revenue', sub: 'Small platform fee, rest is yours' },
  { icon: '🤝', title: 'Your customers stay yours', sub: 'We never use your customer data for other stores' },
  { icon: '⚡', title: 'Go live in minutes', sub: 'Simple setup — no tech knowledge needed' },
  { icon: '📊', title: 'Real-time dashboard', sub: 'Track orders, revenue and customers live' },
];

export default function ApplyPage() {
  const [form, setForm] = useState({ storeName: '', ownerName: '', phone: '', area: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.storeName.trim() || !form.ownerName.trim() || !form.phone.trim() || !form.area.trim()) {
      setError('Please fill all required fields'); return;
    }
    if (form.phone.replace(/\D/g, '').length < 10) { setError('Enter a valid 10-digit phone number'); return; }
    setLoading(true); setError('');
    try {
      await api.post('/store-applications', form);
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit. Please try again.');
    } finally { setLoading(false); }
  };

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Application Submitted! 🎉</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">
          Thank you, <strong className="text-gray-900 dark:text-white">{form.ownerName}</strong>!
        </p>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          We'll review your application and contact you on <strong className="text-gray-900 dark:text-white">{form.phone}</strong> within 2-3 business days.
        </p>
        <a href="https://mart.gokez.com" className="block w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all text-sm">
          Visit Gokez Mart →
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Gokez Hub</p>
            <p className="text-xs text-gray-400">Store Partner Programme</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* Hero */}
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white leading-tight">
            Bring your store online.<br />
            <span className="text-emerald-500">Keep your customers.</span>
          </h1>
          <p className="mt-3 text-sm text-gray-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            While big apps fly in from warehouses, we help local stores deliver to their own neighbourhood. Join Gokez Mart as a store partner.
          </p>
        </div>

        {/* Benefits */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {BENEFITS.map((b, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4">
              <span className="text-2xl">{b.icon}</span>
              <p className="text-xs font-bold text-gray-900 dark:text-white mt-2 leading-tight">{b.title}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{b.sub}</p>
            </div>
          ))}
        </div>

        {/* Application form */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-50 dark:border-slate-700">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Apply to join</h2>
            <p className="text-xs text-gray-400 mt-0.5">We'll review and contact you within 2-3 business days</p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl">{error}</div>}

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" /> Store Name *
              </label>
              <input type="text" value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))}
                className={inp} placeholder="e.g. Arman Fresh Store" required />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Your Name *
              </label>
              <input type="text" value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))}
                className={inp} placeholder="Store owner's name" required />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Phone Number *
              </label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inp} placeholder="10-digit mobile number" required />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Store Area *
              </label>
              <input type="text" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
                className={inp} placeholder="e.g. Gobra, Kolkata" required />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Tell us about your store (optional)
              </label>
              <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                className={`${inp} resize-none`} rows={3}
                placeholder="What do you sell? How long have you been running? Any questions?" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-sm text-sm">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : <>Submit Application <ArrowRight className="w-4 h-4" /></>}
            </button>

            <p className="text-[10px] text-gray-400 text-center">
              By applying you agree to our{' '}
              <a href="https://gokez.com" target="_blank" rel="noopener noreferrer" className="underline">Terms</a>.
              We'll never share your information.
            </p>
          </form>
        </div>

        {/* Already a partner */}
        <div className="text-center pb-8">
          <p className="text-xs text-gray-400">Already a store partner?{' '}
            <a href="/login" className="text-emerald-600 font-semibold hover:underline">Sign in to Gokez Hub →</a>
          </p>
        </div>
      </div>
    </div>
  );
}
