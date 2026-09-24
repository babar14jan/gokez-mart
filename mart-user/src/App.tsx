import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Search, X, CheckCircle } from 'lucide-react';
import { isApiConfigured, storeApi } from './services/api';
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
import CheckoutPage from './pages/CheckoutPage';
import { useCustomerAuthStore } from './store/customerAuthStore';
import NamePrompt from './components/NamePrompt';
import InstallPrompt from './components/InstallPrompt';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useCartStore } from './store/cartStore';
import HomeCarousel from './components/HomeCarousel';
import { PAGE_BOTTOM, PAGE_BOTTOM_CART } from './utils/pageBottom';

type View = 'home' | 'categories' | 'orders' | 'account' | 'privacy' | 'terms' | 'grievance' | 'delete-account' | 'feedback' | 'notification-settings';

const SHAPOORJI_ZONE: MartZone = {
  id: 'shapoorji-default',
  storeId: '00000000-0000-0000-0000-000000000001',
  name: 'Shapoorji',
  lat: 22.565717182227967,
  lng: 88.51426843552692,
  radiusKm: 5,
  isActive: true,
};

const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const GrievancePage = lazy(() => import('./pages/GrievancePage'));
const DeleteAccountPage = lazy(() => import('./pages/DeleteAccountPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const NotificationSettingsPage = lazy(() => import('./pages/NotificationSettingsPage'));

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-[12rem]" />}>{children}</Suspense>;
}

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
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';
  const [view, setView] = useState<View>(() => {
    const path = window.location.pathname;
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/grievance') return 'grievance';
    if (path === '/feedback') return 'feedback';
    if (path === '/notification-settings') return 'notification-settings';
    if (path === '/delete-account') return 'delete-account';
    if (path === '/account') return 'account';
    return 'home';
  });
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [preCheckoutView, setPreCheckoutView] = useState<View>('home');
  const [successData, setSuccessData] = useState<{ num: string; preference: string; storeName?: string; savedAmount?: number } | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState(false);

  const { isLoggedIn } = useCustomerAuthStore();

  // Load the customer's address book from the backend on login.
  // (No longer auto-migrates "legacy local" addresses — that path could pick up
  // whatever was left in the shared local store from a previous session/customer.)
  useEffect(() => {
    if (!isLoggedIn) return;
    useCustomerStore.getState().loadAddresses();
    // Auto-subscribe to push if permission already granted
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        subscribeToPush().catch(() => {});
      }
    } catch {}
  }, [isLoggedIn]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  const [showOutsideWarning, setShowOutsideWarning] = useState(false);
  const [showOutsideBlock, setShowOutsideBlock] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  const [zones, setZones] = useState<MartZone[]>([]);
  const [selectedZone, setSelectedZone] = useState<MartZone | null>(SHAPOORJI_ZONE);
  const [zoneGpsConfirmed, setZoneGpsConfirmed] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRequest, setCatalogRequest] = useState(0);

  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  const cartItems = useCartStore(s => s.totalItems());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#18191a' : (view === 'home' || view === 'categories' ? '#f0fdf4' : '#ffffff'));
  }, [isDark, view]);

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      if (path === '/privacy') setView('privacy');
      else if (path === '/terms') setView('terms');
      else if (path === '/grievance') setView('grievance');
      else if (path === '/feedback') setView('feedback');
      else if (path === '/notification-settings') setView('notification-settings');
      else if (path === '/delete-account') setView('delete-account');
      else if (path === '/account') setView('account');
      else setView('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    if (!isApiConfigured) {
      setCatalogError('Store service is not configured. Please try again later.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalogError(null);
    Promise.all([
      storeApi.getCategories(),
      storeApi.getProducts(undefined, SHAPOORJI_ZONE.storeId),
      storeApi.getSettings(SHAPOORJI_ZONE.storeId),
      storeApi.getZones(),
    ]).then(([catRes, prodRes, settingsRes, zonesRes]) => {
      setCategories(catRes.data.data || []);
      setProducts(prodRes.data.data || []);
      setSettings(settingsRes.data.data || DEFAULT_SETTINGS);
      const fetchedZones = zonesRes.data.data || [];
      setZones(fetchedZones);
      // Default to first zone (Shapoorji) so UI matches what's loaded
      if (fetchedZones.length > 0) setSelectedZone(fetchedZones.find(zone => zone.storeId === SHAPOORJI_ZONE.storeId) || fetchedZones[0]);
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
                    setZoneGpsConfirmed(true);
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
                    setZoneGpsConfirmed(true);
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
    }).catch(() => {
      setCatalogError('Shapoorji store is temporarily unavailable. Check your connection and try again.');
    }).finally(() => setLoading(false));
  }, [catalogRequest]);

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
  useEffect(() => {
    (window as any).__navToOrders = () => handleNavChange('orders');
    (window as any).__navToAccount = () => handleNavChange('account');
  });

  const handleCheckout = async () => {
    setPreCheckoutView(view);
    if (!selectedZone) {
      const loc = await getUserLocation();
      if (loc) {
        const match = findMatchingZone(loc.lat, loc.lng, zones);
        if (match) { setSelectedZone(match.zone); setZoneGpsConfirmed(true); }
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
      <div className="min-h-screen bg-white dark:bg-slate-900 flex items-center justify-center px-4">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Order Placed! 🎉</h2>
            {successData.savedAmount && successData.savedAmount > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full mb-2">
                🎉 You saved ₹{successData.savedAmount.toFixed(0)} with this order!
              </div>
            )}
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
            Order <span className="font-bold text-gray-900 dark:text-white">Order #{successData.num}</span>
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            Your order is confirmed. We&apos;ll deliver within <span className="font-semibold text-gray-900 dark:text-white">
              {successData.preference === 'within_15' ? '10-15 mins' : successData.preference === 'within_30' ? '30 mins' : '1 hour'}
            </span>.
            {successData.storeName && (
              <span className="block text-xs text-gray-500 mt-1">🏪 Fulfilled by {successData.storeName}</span>
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
              className="text-xs text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
              Need help? Chat on WhatsApp →
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${view === 'home' || view === 'categories' ? 'bg-[#f0fdf4]' : 'bg-white'} dark:bg-slate-900 font-sans`}>

      {showLoginModal && <LoginModal pendingCheckout={pendingCheckout} onClose={() => { setShowLoginModal(false); setPendingCheckout(false); }} onSuccess={() => {
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
              Gokez Mart currently delivers within <strong>{selectedZone?.radiusKm ?? 5}km of {selectedZone?.name ?? 'your area'}</strong>.
            </p>
            <p className="text-sm text-emerald-600 font-semibold mb-5">🚀 We&apos;re expanding soon — you&apos;ll be next!</p>
            <button onClick={() => setShowOutsideWarning(false)}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all">
              Continue Browsing
            </button>
            <p className="text-[11px] text-gray-500 mt-3">You can browse products but ordering is not available in your area.</p>
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
              We deliver within <strong>{selectedZone?.radiusKm ?? 5}km of {selectedZone?.name ?? 'your area'}</strong>. Your location is outside our current delivery zone.
            </p>
            <p className="text-sm text-emerald-600 font-semibold mb-5">We&apos;re coming to your area soon! 🌱</p>
            <button onClick={() => setShowOutsideBlock(false)}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-white font-bold rounded-2xl transition-all">
              Got it
            </button>
          </div>
        </div>
      )}

      {!isEmbed && (
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
      )}


      {/* Checkout — overlay on both mobile and desktop */}
      {checkoutActive && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm sm:block hidden"
            onClick={() => { setCheckoutActive(false); setView(preCheckoutView); }} />
          {/* Mobile — full screen slide up */}
          <div className="sm:hidden absolute inset-0 bg-white dark:bg-slate-900 overflow-y-auto">
            <CheckoutPage
              settings={settings}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              zoneGpsConfirmed={zoneGpsConfirmed}
              onBack={() => { setCheckoutActive(false); setView(preCheckoutView); }}
              onHome={() => { setCheckoutActive(false); setView('home'); }}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount }); }}
            />
          </div>
          {/* Desktop — right side drawer */}
          <div className="hidden sm:block absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
            <CheckoutPage
              settings={settings}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              zoneGpsConfirmed={zoneGpsConfirmed}
              onBack={() => { setCheckoutActive(false); setView(preCheckoutView); }}
              onHome={() => { setCheckoutActive(false); setView('home'); }}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount }); }}
            />
          </div>
        </div>
      )}

      {/* Pages */}
      {view === 'categories' ? (
        <div className={PAGE_BOTTOM}>
          <CategoriesView categories={categories} products={products} />
        </div>
      ) : view === 'grievance' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><GrievancePage /></DeferredPage></div>
      ) : view === 'feedback' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><FeedbackPage storeId={selectedZone?.storeId} /></DeferredPage></div>
      ) : view === 'notification-settings' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><NotificationSettingsPage /></DeferredPage></div>
      ) : view === 'delete-account' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><DeleteAccountPage /></DeferredPage></div>
      ) : view === 'privacy' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><PrivacyPage embed={isEmbed} /></DeferredPage></div>
      ) : view === 'terms' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><TermsPage embed={isEmbed} /></DeferredPage></div>
      ) : view === 'orders' ? (
        <div className={PAGE_BOTTOM}>
          <DeferredPage><OrderHistoryPage onBack={() => setView('home')} whatsappNumber={settings.whatsapp_number} /></DeferredPage>
        </div>
      ) : view === 'account' ? (
        <div className={PAGE_BOTTOM}>
          <DeferredPage><ProfilePage
            onBack={() => setView('home')}
            supportName={settings.support_name}
            supportPhone={settings.support_phone}
            whatsappNumber={settings.whatsapp_number}
            onNavigate={(v) => setView(v as 'home' | 'orders' | 'account' | 'privacy' | 'terms')}
          /></DeferredPage>
        </div>
      ) : (
        /* Home */
        <main className={`max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 ${cartItems > 0 ? PAGE_BOTTOM_CART : PAGE_BOTTOM}`}>

          {settings.store_open === 'false' && (
            <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium px-4 py-3 rounded-2xl text-center">
              🕐 Store is currently closed. We&apos;ll be back soon!
            </div>
          )}

          {/* Search — desktop only, mobile search is in Navbar */}
          <div className="relative mt-4 mb-4 hidden sm:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search groceries, vegetables..."
              className="w-full pl-11 pr-10 py-3.5 bg-white dark:bg-slate-800 rounded-2xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-md transition-all border-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>

          {/* Carousel */}
          <HomeCarousel />

          {/* Category pills */}
          {!loading && categories.length > 0 && (() => {
            const categoriesWithProducts = categories.filter(cat => products.some(p => p.categoryId === cat.id));
            if (categoriesWithProducts.length === 0) return null;
            return (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-5 mt-1">
              <button onClick={() => setActiveCategoryId('all')}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  activeCategoryId === 'all'
                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 shadow-sm'
                }`}>
                All
              </button>
              {categoriesWithProducts.map(cat => (
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
            );
          })()}

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
          ) : catalogError ? (
            <div className="max-w-md mx-auto text-center py-16 px-5">
              <p className="text-base font-semibold text-gray-900 dark:text-white mb-2">Store temporarily unavailable</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">{catalogError}</p>
              <button onClick={() => setCatalogRequest(request => request + 1)}
                className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors">
                Try Again
              </button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🔍</div>
              <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">No products found</p>
              <p className="text-sm text-gray-500">Try a different category or search term</p>
            </div>
          ) : search || activeCategoryId !== 'all' ? (
            /* Filtered — flat grid */
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
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

          {/* Trust badges — 4 cards one row */}
          {/* About section */}
          <div className="mt-8 flex justify-center">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Who We Are
            </span>
          </div>
          <div className="mt-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-6 text-center">
            <img src="/mart_brand_new.png" alt="Gokez Mart" className="h-10 w-auto object-contain mx-auto mb-1" />
            <p className="text-sm font-black text-gray-900 dark:text-white mb-4">SHOP LOCAL <span className="text-lg align-middle">&bull;</span> SUPPORT LOCAL</p>
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-3">Gokez Mart — Hyperlocal Commerce Platform</p>
            <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
              We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they’ve built in your community over years.
            </p>
          </div>

          {/* Feature cards */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {['/f1.jpg', '/f2.jpg', '/f3.jpg', '/f4.jpg'].map(src => (
              <div key={src} className="rounded-2xl shadow-md overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-contain" />
              </div>
            ))}
          </div>

          {/* Home footer */}
          {/* Footer */}
          <div className="mt-8 pb-4 border-t border-gray-300 dark:border-slate-700 pt-5 space-y-3">

            {/* Contact — store support */}
            {(settings.support_phone || settings.whatsapp_number || settings.store_address) && (
              <div className="flex items-center justify-center gap-4 flex-wrap">
                {settings.support_phone && (
                  <a href={`tel:${settings.support_phone}`}
                    className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-400 hover:text-blue-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.47 11.47 0 003.58.57 1 1 0 011 1V21a1 1 0 01-1 1A17 17 0 013 5a1 1 0 011-1h3.5a1 1 0 011 1 11.47 11.47 0 00.57 3.58 1 1 0 01-.25 1.01l-2.2 2.2z"/>
                    </svg>
                    {settings.support_phone}
                  </a>
                )}
                {settings.whatsapp_number && (
                  <a href={`https://wa.me/${settings.whatsapp_number}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-400 hover:text-green-600 transition-colors">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp" className="w-4 h-4" />
                    WhatsApp
                  </a>
                )}
                {settings.store_address && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z"/>
                    </svg>
                    {settings.store_address}
                  </span>
                )}
              </div>
            )}


            {/* Copyright */}
            <p className="text-center text-[11px] text-gray-500 dark:text-slate-400">
              A product of{' '}
              <span className="font-bold bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
                Gokez Technologies Pvt. Ltd.
              </span>
              {' '}&copy; {new Date().getFullYear()}
            </p>
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
