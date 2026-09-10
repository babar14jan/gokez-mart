import { useState, useEffect } from 'react';
import { ArrowRight, ShoppingBag, MapPin, TrendingUp, Users, Zap, BarChart3, Menu, X } from 'lucide-react';

const USPS = [
  { icon: ShoppingBag, title: 'No app to build. No marketing to do.', desc: 'Gokez Mart is already on your customers\' phones. You just fulfill the orders.' },
  { icon: MapPin, title: 'Serve your own neighbourhood.', desc: 'We assign you a delivery zone. Orders from your area come to you — not a distant warehouse.' },
  { icon: TrendingUp, title: 'Earn from every order.', desc: 'Small platform fee. You keep the rest. The more you fulfill, the more you earn.' },
  { icon: Users, title: 'Your loyal customers, now online.', desc: 'Customers who already trust your store can now order from home.' },
  { icon: Zap, title: 'Go live fast.', desc: 'Apply today. We set up your store on Gokez Mart. You start receiving orders.' },
  { icon: BarChart3, title: 'Simple dashboard.', desc: 'Manage orders, products and your team from Gokez Hub. No tech knowledge needed.' },
];

const STEPS = [
  { num: '1', title: 'Apply', desc: 'Tell us about your store. Takes 2 minutes.' },
  { num: '2', title: 'We set you up', desc: 'Your store goes live on Gokez Mart.' },
  { num: '3', title: 'Receive & fulfill orders', desc: 'Customers order, you deliver, you earn.' },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* Header */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/90 backdrop-blur-xl border-b border-slate-200/60 shadow-sm' : 'bg-white border-b border-slate-100'
      }`}>
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 relative">
            <a href="/hub"><img src="/mart_hub_brand_logo.png" alt="Gokez Hub" className="h-10 w-auto object-contain" /></a>

            {/* Desktop nav — centered */}
            <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
              <a href="#why" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">Why Join</a>
              <a href="#how" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all">How it Works</a>
            </div>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-4">
              <a href="tel:+918777376280" className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                +91 87773 76280
              </a>
              <a href="/login" className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-sm transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                Sign In
              </a>
            </div>

            {/* Mobile toggle */}
            <button className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors" onClick={() => setMobileOpen(p => !p)}>
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute top-0 right-0 h-full w-72 bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <img src="/mart_hub_brand_logo.png" alt="Gokez Hub" className="h-8 w-auto object-contain" />
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <a href="#why" onClick={() => setMobileOpen(false)} className="px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">Why Join</a>
              <a href="#how" onClick={() => setMobileOpen(false)} className="px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">How it Works</a>
              <div className="h-px bg-slate-100 my-2" />
              <a href="tel:+918777376280" className="px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">📞 +91 87773 76280</a>
              <a href="/login" className="mx-1 flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                Sign In
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            🟢 Now accepting store partners in Kolkata
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight tracking-tight mb-6">
            Sell on Gokez Mart.<br />
            <span className="text-emerald-400">Manage from Gokez Hub.</span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed mb-10">
            Customers in your area order on Gokez Mart — you receive and fulfill from your store. Stay competitive, serve your neighbourhood, and keep the trust you've built over years.
          </p>
          <div className="flex flex-row items-center justify-center gap-3 flex-wrap">
            <a href="/apply" className="flex items-center gap-1.5 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-emerald-900/40">
              Apply to Join <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a href="/login" className="flex items-center gap-1.5 px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-sm transition-all border border-white/20">
              Sign In
            </a>
          </div>
        </div>
      </section>

      {/* Why Join */}
      <section id="why" className="py-16 sm:py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Why join Gokez Mart?</h2>
            <p className="mt-3 text-slate-500 text-sm max-w-xl mx-auto">
              Built for local stores — so you can serve your neighbourhood and grow your business.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {USPS.map((u, i) => (
              <div key={i} className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-emerald-200 hover:-translate-y-0.5 transition-all duration-200">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center mb-4">
                  <u.icon className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1.5">{u.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-16 sm:py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">How it works</h2>
            <p className="mt-3 text-slate-500 text-sm">Three simple steps to start receiving orders.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-14 h-14 bg-emerald-500 text-white text-xl font-extrabold rounded-full flex items-center justify-center mx-auto mb-4 shadow-md shadow-emerald-200">
                  {s.num}
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 bg-slate-900 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-xl font-bold text-white mb-2">Still have questions?</h2>
          <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto">
            We're happy to help. Reach out and we'll get back to you within a few hours.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="https://wa.me/918777376280?text=Hi%2C%20I%20want%20to%20know%20more%20about%20joining%20Gokez%20Mart%20as%20a%20store%20partner"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm transition-all shadow-sm">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Chat on WhatsApp
            </a>
            <a href="mailto:support@gokez.com"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold rounded-xl text-sm transition-all">
              ✉️ support@gokez.com
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/mart_hub_brand_logo.png" alt="Gokez Hub" className="h-7 w-auto object-contain" />
          <p className="text-xs text-slate-400 text-center">
            Built for local stores. Powered by <span className="font-semibold text-slate-500">Gokez Technologies Pvt. Ltd.</span>
          </p>
          <div className="flex items-center gap-5 text-xs text-slate-400">
            <a href="/login" className="hover:text-emerald-600 transition-colors">Sign In</a>
            <a href="/apply" className="hover:text-emerald-600 transition-colors">Apply</a>
            <a href="https://gokez.com" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 transition-colors">gokez.com</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
