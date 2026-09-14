import { useEffect, useState } from 'react';
import { Search, X, CheckCircle } from 'lucide-react';
import { storeApi } from './services/api';
import type { Category, Product, PublicSettings, MartZone } from './services/api';
import { useThemeStore } from './store/themeStore';
import { useCustomerStore } from './store/customerStore';
import { subscribeToPush } from './services/push';
import { getUserLocation, findMatchingZone } from './services/geofence';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import ProductCard from './components/ProductCard';
import FloatingCart from './components/FloatingCart';
import CategoriesView from './components/CategoriesView';
import LoginModal from './components/LoginModal';
import OrderHistoryPage from './pages/OrderHistoryPage';
import ProfilePage from './pages/ProfilePage';
import CheckoutPage from './pages/CheckoutPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import GrievancePage from './pages/GrievancePage';
import DeleteAccountPage from './pages/DeleteAccountPage';
import { useCustomerAuthStore } from './store/customerAuthStore';
import NamePrompt from './components/NamePrompt';
import InstallPrompt from './components/InstallPrompt';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useCartStore } from './store/cartStore';
import HomeCarousel from './components/HomeCarousel';

type View = 'home' | 'categories' | 'orders' | 'account' | 'privacy' | 'terms' | 'grievance' | 'delete-account';

const DEFAULT_SETTINGS: PublicSettings = {
  store_name: 'Gokez Mart', store_address: 'Kolkata',
  delivery_charge: '15', free_delivery_above: '150', min_order_amount: '50',
  delivery_area: 'Kolkata', store_open: 'true',
  estimated_delivery: '30-45 mins', cod_enabled: 'true',
  upi_enabled: 'true', phonepay_enabled: 'false',
  phonepay_qr_url: '', upi_phone: '', upi_id: '', whatsapp_number: '918777376280',
  support_name: '', support_phone: '',
};

export default function App() {
  const [view, setView] = useState<View>(() => {
    const path = window.location.pathname;
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/grievance') return 'grievance';
    if (path === '/delete-account') return 'delete-account';
    if (path === '/account') return 'account';
    return 'home';
  });
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [preCheckoutView, setPreCheckoutView] = useState<View>('home');
  const [successData, setSuccessData] = useState<{ num: string; preference: string; storeName?: string } | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState(false);

  const { isLoggedIn } = useCustomerAuthStore();

  // Deduplicate addresses on app load (fixes existing duplicates)
  useEffect(() => {
    useCustomerStore.getState().deduplicateAddresses();
    // Auto-subscribe to push if permission already granted
    if (Notification.permission === 'granted') {
      subscribeToPush().catch(() => {});
    }
  }, []);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  const [showOutsideWarning, setShowOutsideWarning] = useState(false);
  const [showOutsideBlock, setShowOutsideBlock] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  const [zones, setZones] = useState<MartZone[]>([]);
  const [selectedZone, setSelectedZone] = useState<MartZone | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  const cartItems = useCartStore(s => s.totalItems());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#18191a' : '#f0fdf4');
  }, [isDark]);

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/privacy') setView('privacy');
      else if (path === '/terms') setView('terms');
      else if (path === '/grievance') setView('grievance');
      else if (path === '/delete-account') setView('delete-account');
      else if (path === '/account') setView('account');
      else setView('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    Promise.all([
      storeApi.getCategories(),
      storeApi.getProducts(),
      storeApi.getSettings(),
      storeApi.getZones(),
    ]).then(([catRes, prodRes, settingsRes, zonesRes]) => {
      setCategories(catRes.data.data || []);
      setProducts(prodRes.data.data || []);
      setSettings(settingsRes.data.data || DEFAULT_SETTINGS);
      const fetchedZones = zonesRes.data.data || [];
      setZones(fetchedZones);
      // Default to first zone (Shapoorji) so UI matches what's loaded
      if (fetchedZones.length > 0) {
        setSelectedZone(fetchedZones[0]);
      }
      if (fetchedZones.length > 0) {
        // Ask location on first visit, respect app-level preference after that
        const locationEnabled = localStorage.getItem('mart_location_enabled') !== 'false';
        if (locationEnabled) {
          if (navigator.permissions) {
            navigator.permissions.query({ name: 'geolocation' }).then(async result => {
              if (result.state === 'granted') {
                // Already granted — use silently
                const loc = await getUserLocation();
                if (loc) {
                  const match = findMatchingZone(loc.lat, loc.lng, fetchedZones);
                  if (match) {
                    setSelectedZone(match.zone);
                    const [pr, sr] = await Promise.all([
                      storeApi.getProducts(undefined, match.zone.storeId),
                      storeApi.getSettings(match.zone.storeId),
                    ]);
                    setProducts(pr.data.data || []);
                    setSettings(sr.data.data || DEFAULT_SETTINGS);
                  }
                }
              } else if (result.state === 'prompt' && !localStorage.getItem('mart_location_asked')) {
                // First visit — ask once
                localStorage.setItem('mart_location_asked', '1');
                const loc = await getUserLocation();
                if (loc) {
                  localStorage.setItem('mart_location_enabled', 'true');
                  const match = findMatchingZone(loc.lat, loc.lng, fetchedZones);
                  if (match) {
                    setSelectedZone(match.zone);
                    const [pr, sr] = await Promise.all([
                      storeApi.getProducts(undefined, match.zone.storeId),
                      storeApi.getSettings(match.zone.storeId),
                    ]);
                    setProducts(pr.data.data || []);
                    setSettings(sr.data.data || DEFAULT_SETTINGS);
                  } else setShowOutsideWarning(true);
                }
              }
            }).catch(() => {});
          }
        }
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Silent refresh — products + settings for current store every 3 mins + on tab focus
  useEffect(() => {
    const refresh = async () => {
      try {
        const storeId = selectedZone?.storeId;
        const [catRes, prodRes, srRes] = await Promise.all([
          storeApi.getCategories(),
          storeApi.getProducts(undefined, storeId),
          storeApi.getSettings(storeId),
        ]);
        setCategories([...(catRes.data.data || [])]);
        setProducts([...(prodRes.data.data || [])]);
        setSettings(srRes.data.data || DEFAULT_SETTINGS);
      } catch {}
    };
    const interval = setInterval(refresh, 3 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [selectedZone]);

  const filteredProducts = products.filter(p => {
    const matchCat = activeCategoryId === 'all' || p.categoryId === activeCategoryId;
    const q = search.toLowerCase();
    const matchSearch = !search ||
      p.name.toLowerCase().includes(q) ||
      (p.localName?.toLowerCase().includes(q) ?? false);
    return matchCat && matchSearch;
  });

  // Account tab — show login modal if not logged in, but still navigate
  const handleNavChange = (v: View) => {
    if (v === 'account' && !isLoggedIn) { setShowLoginModal(true); return; }
    setView(v);
  };

  // Expose nav to footer quick links
  (window as any).__navToOrders = () => handleNavChange('orders');
  (window as any).__navToAccount = () => handleNavChange('account');

  const handleCheckout = async () => {
    setPreCheckoutView(view);
    if (!selectedZone) {
      const loc = await getUserLocation();
      if (loc) {
        const match = findMatchingZone(loc.lat, loc.lng, zones);
        if (match) { setSelectedZone(match.zone); }
        else { setShowOutsideBlock(true); return; }
      } else { setShowOutsideBlock(true); return; }
    }
    // Require login before checkout
    if (!isLoggedIn) {
      setShowLoginModal(true);
      // After login, proceed to checkout
      setPendingCheckout(true);
      return;
    }
    setCheckoutActive(true);
  };

  // Success screen
  if (successData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center px-4">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Order Placed! 🎉</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
            Order <span className="font-bold text-gray-900 dark:text-white">Order #{successData.num}</span>
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            Your order is confirmed. We&apos;ll deliver within <span className="font-semibold text-gray-900 dark:text-white">
              {successData.preference === 'within_15' ? '10-15 mins' : successData.preference === 'within_30' ? '30 mins' : '1 hour'}
            </span>.
            {successData.storeName && (
              <span className="block text-xs text-gray-400 mt-1">🏪 Fulfilled by {successData.storeName}</span>
            )}
          </p>
          <button onClick={() => { setSuccessData(null); setView('orders'); }}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all shadow-sm mb-3">
            Track My Order
          </button>
          <button onClick={() => { setSuccessData(null); setView('home'); }}
            className="w-full py-3 text-sm font-semibold text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 rounded-2xl transition-colors mb-4">
            Continue Shopping
          </button>
          {settings.whatsapp_number && (
            <a href={`https://wa.me/${settings.whatsapp_number}`} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
              Need help? Chat on WhatsApp →
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] dark:bg-slate-900 font-sans">

      {showLoginModal && <LoginModal onClose={() => { setShowLoginModal(false); setPendingCheckout(false); }} onSuccess={() => {
        setShowLoginModal(false);
        if (pendingCheckout) {
          setPendingCheckout(false);
          setCheckoutActive(true);
        } else {
          setView('home');
        }
      }} />}
      {showNamePrompt && <NamePrompt onDone={() => { setShowNamePrompt(false); setView('home'); }} />}

      {/* Outside zone — soft warning */}
      {showOutsideWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-3">📍</div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">We&apos;re not in your area yet</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
              Gokez Mart currently delivers within <strong>5km of Kolkata</strong>.
            </p>
            <p className="text-sm text-emerald-600 font-semibold mb-5">🚀 We&apos;re expanding soon — you&apos;ll be next!</p>
            <button onClick={() => setShowOutsideWarning(false)}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all">
              Continue Browsing
            </button>
            <p className="text-[11px] text-gray-400 mt-3">You can browse products but ordering is not available in your area.</p>
          </div>
        </div>
      )}

      {/* Outside zone — hard block */}
      {showOutsideBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-3">🛵</div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">Delivery not available yet</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">
              We deliver within <strong>5km of Kolkata</strong>. Your location is outside our current delivery zone.
            </p>
            <p className="text-sm text-emerald-600 font-semibold mb-5">We&apos;re coming to your area soon! 🌱</p>
            <button onClick={() => setShowOutsideBlock(false)}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-white font-bold rounded-2xl transition-all">
              Got it
            </button>
          </div>
        </div>
      )}

      <Navbar
        zones={zones}
        selectedZone={selectedZone}
        onZoneChange={async (zone) => {
        setSelectedZone(zone);
        setShowOutsideWarning(false);
        setShowOutsideBlock(false);
        setLoading(true);
        setActiveCategoryId('all');
        setSearch('');
        try {
          const [catRes, prodRes, srRes] = await Promise.all([
            storeApi.getCategories(),
            storeApi.getProducts(undefined, zone.storeId),
            storeApi.getSettings(zone.storeId),
          ]);
          setCategories(catRes.data.data || []);
          setProducts(prodRes.data.data || []);
          setSettings(srRes.data.data || DEFAULT_SETTINGS);
        } finally { setLoading(false); }
      }}
        activeView={view as 'home' | 'categories' | 'orders' | 'account'}
        onNavChange={handleNavChange}
        onCheckout={handleCheckout}
        search={search}
        onSearch={setSearch}
      />


      {/* Checkout — overlay on both mobile and desktop */}
      {checkoutActive && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm sm:block hidden"
            onClick={() => { setCheckoutActive(false); setView(preCheckoutView); }} />
          {/* Mobile — full screen slide up */}
          <div className="sm:hidden absolute inset-0 bg-gray-50 dark:bg-slate-900 overflow-y-auto">
            <CheckoutPage
              settings={settings}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              onBack={() => { setCheckoutActive(false); setView(preCheckoutView); }}
              onHome={() => { setCheckoutActive(false); setView('home'); }}
              onSuccess={(num: string, preference: string, storeName?: string) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName }); }}
            />
          </div>
          {/* Desktop — right side drawer */}
          <div className="hidden sm:block absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
            <CheckoutPage
              settings={settings}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              onBack={() => { setCheckoutActive(false); setView(preCheckoutView); }}
              onHome={() => { setCheckoutActive(false); setView('home'); }}
              onSuccess={(num: string, preference: string, storeName?: string) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName }); }}
            />
          </div>
        </div>
      )}

      {/* Pages */}
      {view === 'categories' ? (
        <div className="pb-20">
          <CategoriesView categories={categories} products={products} />
        </div>
      ) : view === 'grievance' ? (
        <div className="pb-20"><GrievancePage /></div>
      ) : view === 'delete-account' ? (
        <div className="pb-20"><DeleteAccountPage /></div>
      ) : view === 'privacy' ? (
        <div className="pb-20"><PrivacyPage /></div>
      ) : view === 'terms' ? (
        <div className="pb-20"><TermsPage /></div>
      ) : view === 'orders' ? (
        <div className="pb-20">
          <OrderHistoryPage onBack={() => setView('home')} />
        </div>
      ) : view === 'account' ? (
        <div className="pb-20">
          <ProfilePage
            onBack={() => setView('home')}
            supportName={settings.support_name}
            supportPhone={settings.support_phone}
            whatsappNumber={settings.whatsapp_number}
            onNavigate={(v) => setView(v as 'home' | 'orders' | 'account' | 'privacy' | 'terms')}
          />
        </div>
      ) : (
        /* Home */
        <main className={`max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 ${cartItems > 0 ? 'pb-44' : 'pb-28'}`}>

          {settings.store_open === 'false' && (
            <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium px-4 py-3 rounded-2xl text-center">
              🕐 Store is currently closed. We&apos;ll be back soon!
            </div>
          )}

          {/* Search — desktop only, mobile search is in Navbar */}
          <div className="relative mt-4 mb-4 hidden sm:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search groceries, vegetables..."
              className="w-full pl-11 pr-10 py-3.5 bg-white dark:bg-slate-800 rounded-2xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-md transition-all border-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Carousel */}
          <HomeCarousel />

          {/* Category pills */}
          {!loading && categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-5 mt-1">
              <button onClick={() => setActiveCategoryId('all')}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  activeCategoryId === 'all'
                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 shadow-sm'
                }`}>
                All
              </button>
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setActiveCategoryId(cat.id)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                    activeCategoryId === cat.id
                      ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                      : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 shadow-sm'
                  }`}>
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* Products */}
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl overflow-hidden animate-pulse shadow-sm">
                  <div className="aspect-square bg-gray-100" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-gray-100 rounded-lg w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🔍</div>
              <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">No products found</p>
              <p className="text-sm text-gray-400">Try a different category or search term</p>
            </div>
          ) : search || activeCategoryId !== 'all' ? (
            /* Filtered — flat grid */
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {filteredProducts.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </>
          ) : (
            /* Home — grouped by category with section headers */
            <div className="space-y-6">
              {categories.map(cat => {
                const catProducts = filteredProducts.filter(p => p.categoryId === cat.id);
                if (catProducts.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-base font-bold text-gray-900 dark:text-white">{cat.name}</h2>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {catProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Uncategorised */}
              {(() => {
                const uncat = filteredProducts.filter(p => !p.categoryId);
                if (uncat.length === 0) return null;
                return (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-bold text-gray-900 dark:text-white">📦 Others</h2>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {uncat.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Trust badges */}
          <div className="mt-8 grid grid-cols-2 gap-3">
            {[
              { icon: '🚚', title: 'Fast Delivery', desc: 'Fresh groceries at your door in 10-15 mins' },
              { icon: '🌿', title: 'Fresh & Quality', desc: '100% fresh products, quality guaranteed' },
              { icon: '💰', title: 'Best Prices', desc: 'Competitive prices with great offers' },
              { icon: '🔄', title: 'Easy Returns', desc: 'Not satisfied? Return at doorstep' },
            ].map(b => (
              <div key={b.title} className="bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm">
                <span className="text-2xl">{b.icon}</span>
                <p className="text-xs font-bold text-gray-900 dark:text-white mt-1.5">{b.title}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 leading-snug">{b.desc}</p>
              </div>
            ))}
          </div>

          {/* Home footer */}
          <div className="mt-8 pb-4 space-y-4">
            {/* Contact */}
            {(settings.support_phone || settings.whatsapp_number) && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-bold text-gray-900 dark:text-white mb-3">Get in Touch</p>
                <div className="space-y-2">
                  {settings.support_phone && (
                    <a href={`tel:${settings.support_phone}`}
                      className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 hover:text-emerald-600 transition-colors">
                      <span className="text-base">📞</span> {settings.support_phone}
                    </a>
                  )}
                  {settings.whatsapp_number && (
                    <a href={`https://wa.me/${settings.whatsapp_number}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 hover:text-emerald-600 transition-colors">
                      <span className="text-base">💬</span> WhatsApp Support
                    </a>
                  )}
                  {settings.store_address && (
                    <div className="flex items-start gap-2 text-xs text-gray-400 dark:text-slate-500">
                      <span className="text-base">📍</span>
                      <span className="leading-snug">{settings.store_address}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick links */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-bold text-gray-900 dark:text-white mb-3">Quick Links</p>
              <div className="grid grid-cols-2 gap-y-2">
                {[
                  { label: 'My Orders', action: () => { (window as any).__navToOrders?.(); } },
                  { label: 'My Account', action: () => { (window as any).__navToAccount?.(); } },
                  { label: 'Privacy Policy', action: () => { window.history.pushState({}, '', '/privacy'); window.dispatchEvent(new PopStateEvent('popstate')); } },
                  { label: 'Terms of Service', action: () => { window.history.pushState({}, '', '/terms'); window.dispatchEvent(new PopStateEvent('popstate')); } },
                ].map(l => (
                  <button key={l.label} onClick={l.action}
                    className="text-left text-xs text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Copyright */}
            <div className="text-center pb-2">
              <p className="text-[10px] text-gray-400 dark:text-slate-500">
                &copy; {new Date().getFullYear()} Gokez Technologies Pvt. Ltd.
              </p>
              <p className="text-[10px] text-gray-300 dark:text-slate-600 mt-0.5">
                {settings.store_name} · {settings.delivery_area || 'Kolkata'}
              </p>
            </div>
          </div>
        </main>
      )}

      {/* Floating cart bar — mobile only */}
      <FloatingCart onOpen={handleCheckout} hidden={checkoutActive} />

      {/* Install prompt — Android native / iOS guide */}
      <InstallPrompt />

      {/* Bottom nav — mobile only */}
      <div className="sm:hidden">
        <BottomNav active={view as 'home' | 'categories' | 'orders' | 'account'} onChange={handleNavChange} />
      </div>
    </div>
  );
}
