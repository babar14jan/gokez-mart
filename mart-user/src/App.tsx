import { useEffect, useState } from 'react';
import { Search, X, CheckCircle } from 'lucide-react';
import { storeApi } from './services/api';
import type { Category, Product, PublicSettings, MartZone } from './services/api';
import { useThemeStore } from './store/themeStore';
import { useCustomerStore } from './store/customerStore';
import { getUserLocation, findMatchingZone } from './services/geofence';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import ProductCard from './components/ProductCard';
import CartDrawer from './components/CartDrawer';
import FloatingCart from './components/FloatingCart';
import CategoriesView from './components/CategoriesView';
import PhoneModal from './components/PhoneModal';
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
import CategoryIcon from './components/CategoryIcon';

type View = 'home' | 'categories' | 'orders' | 'account' | 'privacy' | 'terms' | 'grievance' | 'delete-account';

const DEFAULT_SETTINGS: PublicSettings = {
  store_name: 'Gokez Mart', store_address: 'Shapoorji, Kolkata',
  delivery_charge: '15', free_delivery_above: '150', min_order_amount: '50',
  delivery_area: 'Shapoorji, Kolkata', store_open: 'true',
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
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [successData, setSuccessData] = useState<{ num: string; preference: string } | null>(null);

  const { hasAskedPhone } = useCustomerStore();
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const { isLoggedIn } = useCustomerAuthStore();

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
    if (meta) meta.setAttribute('content', isDark ? '#0f172a' : '#fafaf9');
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
    if (!hasAskedPhone) {
      const t = setTimeout(() => setShowPhoneModal(true), 2000);
      return () => clearTimeout(t);
    }
  }, [hasAskedPhone]);

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

  const filteredProducts = products.filter(p => {
    const matchCat = activeCategoryId === 'all' || p.categoryId === activeCategoryId;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Account tab — show login modal if not logged in
  const handleNavChange = (v: View) => {
    if (v === 'account' && !isLoggedIn) { setShowLoginModal(true); return; }
    setView(v);
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
            Order <span className="font-bold text-gray-900 dark:text-white">{successData.num}</span>
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            Your order is confirmed. We&apos;ll deliver within <span className="font-semibold text-gray-900 dark:text-white">
              {successData.preference === 'within_15' ? '10-15 mins' : successData.preference === 'within_30' ? '30 mins' : '1 hour'}
            </span>.
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
    <div className="min-h-screen bg-[#fafaf9] dark:bg-slate-900 font-sans">

      {showPhoneModal && !isLoggedIn && <PhoneModal onClose={() => setShowPhoneModal(false)} />}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} onSuccess={() => {
        setShowLoginModal(false);
        const currentName = useCustomerAuthStore.getState().name;
        if (!currentName) setShowNamePrompt(true); else setView('home');
      }} />}
      {showNamePrompt && <NamePrompt onDone={() => { setShowNamePrompt(false); setView('home'); }} />}

      {/* Outside zone — soft warning */}
      {showOutsideWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 max-w-sm w-full text-center">
            <div className="text-4xl mb-3">📍</div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">We&apos;re not in your area yet</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
              Gokez Mart currently delivers within <strong>5km of Shapoorji, Kolkata</strong>.
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
              We deliver within <strong>5km of Shapoorji, Kolkata</strong>. Your location is outside our current delivery zone.
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
        activeView={(checkoutActive ? 'categories' : view) as 'home' | 'categories' | 'orders' | 'account'}
        onNavChange={handleNavChange}
        onCartOpen={() => setShowCartDrawer(true)}
      />

      {/* Cart drawer — triggered from Cart tab */}
      <CartDrawer
        open={showCartDrawer}
        onClose={() => setShowCartDrawer(false)}
        settings={settings}
        onCheckout={async () => {
          setShowCartDrawer(false);
          if (!selectedZone) {
            const loc = await getUserLocation();
            if (loc) {
              const match = findMatchingZone(loc.lat, loc.lng, zones);
              if (match) { setSelectedZone(match.zone); setCheckoutActive(true); return; }
            }
            setShowOutsideBlock(true); setView('home'); return;
          }
          setCheckoutActive(true);
        }}
      />

      {/* Pages */}
      {checkoutActive ? (
        <div className="pb-20">
          <CheckoutPage
            settings={settings}
            zoneName={selectedZone?.name}
            storeId={selectedZone?.storeId}
            onBack={() => { setCheckoutActive(false); setShowCartDrawer(true); }}
            onSuccess={(num: string, preference: string) => { setCheckoutActive(false); setSuccessData({ num, preference }); }}
          />
        </div>
      ) : view === 'categories' ? (
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
        <main className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 ${cartItems > 0 ? 'pb-44' : 'pb-28'}`}>

          {settings.store_open === 'false' && (
            <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium px-4 py-3 rounded-2xl text-center">
              🕐 Store is currently closed. We&apos;ll be back soon!
            </div>
          )}

          {/* Search */}
          <div className="relative mt-4 mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search vegetables, paneer..."
              className="w-full pl-11 pr-10 py-3 bg-gray-100 dark:bg-slate-800 rounded-full text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:bg-white dark:focus:bg-slate-700 focus:shadow-md transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* Category pills */}
          {!loading && categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-4">
              <button onClick={() => setActiveCategoryId('all')}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  activeCategoryId === 'all' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
                }`}>
                All
              </button>
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setActiveCategoryId(cat.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                    activeCategoryId === cat.id ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-emerald-300'
                  }`}>
                  <CategoryIcon icon={cat.icon} name={cat.name} className="w-4 h-4 object-contain" />
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* Products grid */}
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
                  <div className="aspect-square bg-gray-100" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
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
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {filteredProducts.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </main>
      )}

      {/* Floating cart bar — mobile only */}
      <FloatingCart onOpen={() => setShowCartDrawer(true)} />

      {/* Install prompt — Android native / iOS guide */}
      <InstallPrompt />

      {/* Bottom nav — mobile only */}
      <div className="sm:hidden">
        <BottomNav active={(checkoutActive ? 'categories' : view) as 'home' | 'categories' | 'orders' | 'account'} onChange={handleNavChange} />
      </div>
    </div>
  );
}
