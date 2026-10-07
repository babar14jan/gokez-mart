import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Search, X, CheckCircle, Mail, Phone } from 'lucide-react';
import { isApiConfigured, storeApi } from './services/api';
import type { Category, Product, PublicSettings, MartZone } from './services/api';
import { useThemeStore } from './store/themeStore';
import { useCustomerStore } from './store/customerStore';
import { subscribeToPush } from './services/push';
import { getUserLocation, findMatchingZone } from './services/geofence';
import Navbar from './components/Navbar';
import StoreStatusStrip from './components/StoreStatusStrip';
import ConfirmDialog from './components/ConfirmDialog';
import BottomNav from './components/BottomNav';
import ProductCard from './components/ProductCard';
import FloatingCart from './components/FloatingCart';
import CategoriesView from './components/CategoriesView';
import LoginModal from './components/LoginModal';

import CheckoutPage from './pages/CheckoutPage';
import { useCustomerAuthStore } from './store/customerAuthStore';
import NamePrompt from './components/NamePrompt';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useCartStore } from './store/cartStore';
import HomeCarousel from './components/HomeCarousel';
import { PAGE_BOTTOM, PAGE_BOTTOM_CART } from './utils/pageBottom';
import { useKeyboardInset } from './utils/useKeyboardInset';
import { applySeo } from './utils/seo';
import { useLoginFlowStore } from './store/loginFlowStore';
import { track, getFunnelChannel } from './utils/track';
import { saveTrackingToken } from './utils/guestTracking';
import { GOKEZ_SUPPORT } from './constants/gokezSupport';
import { BRAND_DESCRIPTION, BRAND_NAME, BRAND_SLOGAN, PARENT_COMPANY, PARENT_COMPANY_URL } from './constants/brand';

type View = 'home' | 'about' | 'categories' | 'orders' | 'account' | 'privacy' | 'terms' | 'grievance' | 'delete-account' | 'feedback';

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
const AccountPage = lazy(() => import('./pages/AccountPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const GrievancePage = lazy(() => import('./pages/GrievancePage'));
const DeleteAccountPage = lazy(() => import('./pages/DeleteAccountPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-[12rem]" />}>{children}</Suspense>;
}

const DEFAULT_SETTINGS: PublicSettings = {
  store_name: BRAND_NAME, store_address: 'Kolkata',
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
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/about') return 'about';
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/grievance') return 'grievance';
    if (path === '/feedback') return 'feedback';
    if (path === '/notification-settings') {
      window.history.replaceState({}, '', '/account');
      return 'account';
    }
    if (path === '/delete-account') return 'delete-account';
    if (path === '/account') return 'account';
    if (path === '/categories') return 'categories';
    return 'home';
  });
  const [checkoutActive, setCheckoutActive] = useState(false);
  // The bottom tabs move `view` without pushing history, so nothing else records
  // which screen the shopper was on before opening the account login. Needed so
  // "Continue as guest" returns there instead of guessing from the basket.
  const VIEW_PATH: Record<View, string> = {
    home: '/', about: '/about/', categories: '/categories', orders: '/orders', account: '/account',
    privacy: '/privacy/', terms: '/terms/', grievance: '/grievance/',
    'delete-account': '/delete-account', feedback: '/feedback',
  };
  // Mirrored in state because writing sessionStorage alone does not re-render,
  // which made "Not now" look like it did nothing.
  const [signInPromptDismissed, setSignInPromptDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('guest_signin_dismissed') === '1'
  );

  const [preCheckoutView, setPreCheckoutView] = useState<View>('home');
  const [successData, setSuccessData] = useState<{ num: string; preference: string; storeName?: string; savedAmount?: number; trackingToken?: string; items?: any[]; total?: number; guestAddress?: string; guestName?: string; guestPhone?: string; createdAt?: string; status?: string } | null>(null);
  // One session_start per session, fired as early as possible so a visit that
  // never reaches the login screen is still counted.
  useEffect(() => {
    track('session_start', { channel: getFunnelChannel() });
  }, []);

  const [pendingCheckout, setPendingCheckout] = useState(() => Boolean(useLoginFlowStore.getState().getActiveOtpFlow()?.pendingCheckout));

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
  const [showLoginModal, setShowLoginModal] = useState(() => Boolean(useLoginFlowStore.getState().getActiveOtpFlow()));
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  const [showOutsideWarning, setShowOutsideWarning] = useState(false);
  const [showOutsideBlock, setShowOutsideBlock] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  // Holds the resolver for the in-flight "store is closed" confirmation. Kept as
  // a ref-backed closure rather than a boolean so the promise settles exactly
  // once, whether the customer confirms, cancels, or the dialog unmounts.
  const [closedPrompt, setClosedPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const openState = settings.openState;

  /**
   * Gate for order submission while the store is shut.
   *
   * Resolves true immediately when open, so the common path costs nothing. When
   * closed it parks the customer's intent and shows one dialog, rendered here
   * rather than inside CheckoutPage: checkout is mounted twice (a mobile sheet
   * and a desktop panel), so a dialog owned by the page would exist twice.
   *
   * CheckoutPage awaits this before calling placeOrder. The order is still
   * created either way -- closing a store delays fulfilment, it does not
   * disqualify anyone -- and the server independently records the closure state.
   */
  const confirmOrder = useCallback(() => new Promise<boolean>(resolve => {
    if (openState?.isOpen !== false) { resolve(true); return; }
    setClosedPrompt({ resolve });
  }), [openState?.isOpen]);

  const settlePrompt = useCallback((ok: boolean) => {
    setClosedPrompt(current => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  // A pending prompt must never be left hanging: unmounting with the dialog open
  // would leave CheckoutPage awaiting a promise that can never resolve.
  useEffect(() => () => {
    setClosedPrompt(current => { current?.resolve(false); return null; });
  }, []);
  const [zones, setZones] = useState<MartZone[]>([]);
  const [selectedZone, setSelectedZone] = useState<MartZone | null>(SHAPOORJI_ZONE);
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [isHomeSearchFocused, setIsHomeSearchFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRequest, setCatalogRequest] = useState(0);

  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  const cartItems = useCartStore(s => s.totalItems());

  // Keeps .page-shell equal to the visible height; see the hook for why one
  // mechanism covers both iOS and Android.
  useKeyboardInset();

  // Views are swapped by React, but scroll position lives on the DOCUMENT, so
  // nothing resets it when the view changes. That produced inconsistent behaviour
  // that looked deliberate: switching to a short page (Orders) shrank the
  // document, the browser clamped scrollY down and it appeared to reset, while
  // switching to tall Home or Categories left the old offset untouched and the
  // customer landed halfway down a page they had never scrolled.
  //
  // `showingSuccess` is in the deps because the success screen is an early return
  // that replaces the whole tree -- leaving or entering it changes the scroll
  // context without `view` changing at all.
  //
  // Checkout deliberately does NOT reset: it is an overlay over the current view,
  // so opening and closing it leaves `view` untouched and the offset survives.
  const showingSuccess = Boolean(successData);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, showingSuccess]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#18191a' : '#0f172a');
  }, [isDark, view]);

  // Per-route <head> metadata. index.html ships the homepage defaults; this keeps
  // title, description, canonical and robots correct as the view changes, and
  // marks private/transactional views noindex. Runs on first mount too, so a deep
  // link like /terms is correct before the user interacts with anything.
  useEffect(() => {
    applySeo(view, { checkoutActive });
  }, [view, checkoutActive]);

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (path === '/about') setView('about');
      else if (path === '/privacy') setView('privacy');
      else if (path === '/terms') setView('terms');
      else if (path === '/grievance') setView('grievance');
      else if (path === '/feedback') setView('feedback');
      else if (path === '/notification-settings') {
        window.history.replaceState({}, '', '/account');
        setView('account');
      }
      else if (path === '/delete-account') setView('delete-account');
      else if (path === '/account') setView('account');
      // Needed because the login redirect lands here: AccountPage navigates to
      // postLoginPath, which is '/orders' for the guest "Track My Orders" CTA.
      // Without this branch the pushState fell through to setView('home'), so a
      // customer who signed in from the account page was dumped on the home
      // screen instead of their order history.
      else if (path === '/orders') setView('orders');
      // Declining login from the account tab returns here, so this path has to
      // resolve to a view. Without it the guest exit fell through to Home.
      else if (path === '/categories') setView('categories');
      else if (path === '/checkout') { setView('home'); setCheckoutActive(true); }
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

  // The 3-minute poll above would leave a stale "closed" strip for up to three
  // minutes after the store actually opens, so schedule an exact refetch for the
  // moment the server says it reopens. Without this a customer who left the page
  // open across opening time is told the store is shut while staff are packing
  // their order.
  useEffect(() => {
    if (openState?.isOpen !== false || !openState.nextOpenAt) return;
    const delay = new Date(openState.nextOpenAt).getTime() - Date.now();
    // Guard against a past or unparseable instant, which would fire immediately
    // and spin. The poll above still covers those cases.
    if (!Number.isFinite(delay) || delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
    const storeId = selectedZone?.storeId;
    const timer = setTimeout(async () => {
      try {
        const srRes = await storeApi.getSettings(storeId);
        setSettings(srRes.data.data || DEFAULT_SETTINGS);
      } catch {}
    }, delay);
    return () => clearTimeout(timer);
  }, [openState?.isOpen, openState?.nextOpenAt, selectedZone?.storeId]);

  const filteredProducts = products.filter(p => {
    const q = search.trim().toLowerCase();
    const matchCat = Boolean(q) || activeCategoryId === 'all' || p.categoryId === activeCategoryId;
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.localName?.toLowerCase().includes(q) ?? false) ||
      (p.searchAliases ?? []).some(alias => alias.toLowerCase().includes(q));
    return matchCat && matchSearch;
  });

  // Account tab — show login modal if not logged in, but still navigate
  const handleNavChange = (v: View) => {
    if (v === 'account') {
      setPendingCheckout(false);
      // Re-tapping the Account tab must not record '/account' as the origin, or
      // the guest exit would navigate to the page it is already leaving.
      if (view !== 'account') useLoginFlowStore.getState().setGuestReturnPath(VIEW_PATH[view]);
    }
    setView(v);
  };


  // Escape hatch from inside the login modal: drop the OTP flow and keep the
  // shopper moving. Checkout opened the modal, so dropping out must land back
  // in checkout with the basket intact — otherwise "continue as guest" throws
  // them out of the page they were already on.
  const handleLoginModalGuest = () => {
    useLoginFlowStore.getState().clear();
    useLoginFlowStore.getState().setPostLoginPath(null);
    setShowLoginModal(false);
    if (pendingCheckout) {
      setPendingCheckout(false);
      setCheckoutActive(true);
    }
  };

  // "Apply & Save" / "Log in for offers" in checkout. This used to open the login
  // OVERLAY, which meant redeeming a coupon presented a second login design --
  // the same complaint as the duplicate account page. It now goes through the
  // Account page, the same host "Track My Orders" uses, so there is one login to
  // learn. postLoginPath returns to /checkout afterwards, where the resume effect
  // in CheckoutPage redeems the code and shows it applied.
  const handleCheckoutLogin = (campaign?: any) => {
    const flow = useLoginFlowStore.getState();
    flow.setPendingCouponApply(true, campaign?.id ?? null);
    flow.setPostLoginPath('/checkout');
    // Declining login must come back here too, basket intact, not to Home.
    flow.setGuestReturnPath('/checkout');
    setPendingCheckout(false);
    setCheckoutActive(false);
    setShowLoginModal(false);
    window.history.pushState({}, '', '/account');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleCheckout = async () => {
    setPreCheckoutView(view);
    setCheckoutActive(true);
  };

  // Persist the tracking token in an effect, never during render: the success
  // screen render body must stay side-effect free or StrictMode double-invokes
  // it and a throw there blanks the whole app.
  useEffect(() => {
    const token = successData?.trackingToken;
    if (!token) return;
    saveTrackingToken(token);
  }, [successData?.trackingToken]);

  useEffect(() => {
    if (!successData) return;
    window.dispatchEvent(new Event('gokez:first-order-completed'));
  }, [successData]);

  // Success screen
  if (successData) {
    const STEPS = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
    const STEP_LABELS = ['Order Placed', 'Being Prepared', 'On the Way', 'Delivered'];
    const STEP_ICONS = ['🛒', '🍳', '🛵', '🎉'];
    const curStep = 0;

    return (
      <div className="page-shell bg-gray-50 dark:bg-slate-900 px-4 py-8">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Order Placed! 🎉</h2>
            {successData.savedAmount && successData.savedAmount > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full mb-2">
                🎉 You saved ₹{successData.savedAmount.toFixed(0)} with this order!
              </div>
            )}
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Order <span className="font-bold text-gray-900 dark:text-white">#{successData.num}</span>
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-md border border-emerald-100 dark:border-emerald-900">
            <div className="bg-emerald-500 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">Order Placed</p>
                <p className="text-emerald-100 text-xs mt-0.5">
                  {successData.preference === 'within_15' ? '⚡ Expected in 10-15 mins'
                    : successData.preference === 'within_30' ? '🕐 Expected in ~30 mins'
                    : '🕑 Expected in ~1 hour'}
                </p>
              </div>
              <div className="text-right">
                <span className="text-emerald-100 text-xs font-semibold">Order #{successData.num}</span>
                {successData.storeName && (
                  <p className="text-emerald-200 text-[10px] mt-0.5">🏪 {successData.storeName}</p>
                )}
              </div>
            </div>

            <div className="px-4 pt-5 pb-4">
              <div className="relative flex justify-between items-start">
                <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-100 dark:bg-slate-700" />
                <div className="absolute top-4 left-4 h-0.5 bg-emerald-500 transition-all duration-700"
                  style={{ width: '0%' }} />
                {STEPS.map((step, i) => (
                  <div key={step} className="flex flex-col items-center gap-1.5 z-10" style={{ width: '20%' }}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 bg-white dark:bg-slate-800 transition-all ${
                      i < curStep ? 'border-emerald-500' :
                      i === curStep ? 'border-emerald-500 shadow-md shadow-emerald-200 scale-110' :
                      'border-gray-200 dark:border-slate-600'
                    }`}>
                      {i <= curStep
                        ? <span className={i === curStep ? 'animate-bounce' : ''}>{STEP_ICONS[i]}</span>
                        : <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-600 block" />}
                    </div>
                    <span className={`text-[9px] font-semibold text-center leading-tight ${
                      i <= curStep ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
                    }`}>{STEP_LABELS[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {(successData.items || []).map((item: any, i: number) => (
                  <div key={i} className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
                    {item.photoUrl
                      ? <img src={item.photoUrl} alt={item.productName} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-xl">🥦</div>
                    }
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-4 pt-3 border-t border-gray-100 dark:border-slate-700 space-y-1.5 pb-4">
              <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-white">
                <span>{(successData.items || []).length} items</span><span>₹{successData.total}</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-gray-500 text-xs mt-0.5">📍</span>
                <p className="text-[11px] text-gray-500 leading-tight">{successData.guestAddress}</p>
              </div>
            </div>
          </div>

          <button onClick={() => { setSuccessData(null); setView('orders'); }}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all shadow-sm">
            Track My Order
          </button>
          <button onClick={() => { setSuccessData(null); setView('home'); }}
            className="w-full py-3 text-sm font-semibold text-gray-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-2xl transition-colors border border-gray-200 dark:border-slate-700">
            Continue Shopping
          </button>
          {settings.whatsapp_number && (
            <a href={`https://wa.me/${settings.whatsapp_number}`} target="_blank" rel="noopener noreferrer"
              className="block text-center text-xs text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
              Need help? Chat on WhatsApp →
            </a>
          )}
          {!isLoggedIn && !signInPromptDismissed && (
            <div className="pt-2">
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-2xl p-3 text-center">
                <p className="text-[11px] text-violet-700 dark:text-violet-300 mb-2">
                  💡 Sign in to see all your past orders and track them easily
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => {
                      // The whole point of this prompt is to reach order history,
                      // so tell the login flow where to land once OTP completes.
                      useLoginFlowStore.getState().setPostLoginPath('/orders');
                      setSuccessData(null);
                      setShowLoginModal(true);
                    }}
                    className="text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Sign in
                  </button>
                  <span className="text-violet-300 dark:text-violet-600">·</span>
                  <button
                    onClick={() => {
                      sessionStorage.setItem('guest_signin_dismissed', '1');
                      setSignInPromptDismissed(true);
                    }}
                    className="text-[11px] text-gray-500 hover:text-gray-600"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`page-shell ${view === 'home' || view === 'categories' ? 'bg-[#f0fdf4]' : 'bg-white'} dark:bg-slate-900 font-sans`}>

      {showLoginModal && <LoginModal pendingCheckout={pendingCheckout} onGuest={handleLoginModalGuest} onClose={() => {
        useLoginFlowStore.getState().clear();
        useLoginFlowStore.getState().setPostLoginPath(null);
        setShowLoginModal(false);
        setPendingCheckout(false);
      }} onSuccess={() => {
        const redirect = useLoginFlowStore.getState().postLoginPath;
        useLoginFlowStore.getState().setPostLoginPath(null);
        setShowLoginModal(false);
        if (pendingCheckout) {
          setPendingCheckout(false);
          setCheckoutActive(true);
        } else if (redirect === '/orders') {
          // Signed in to see order history — that is where they asked to go.
          setView('orders');
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
              {BRAND_NAME} currently delivers within <strong>{selectedZone?.radiusKm ?? 5}km of {selectedZone?.name ?? 'your area'}</strong>.
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
          onSearchFocus={() => setIsHomeSearchFocused(true)}
          onSearchBlur={() => setIsHomeSearchFocused(false)}
        />
      )}

      {/* Closed-store notice: below the header, on every page, never blocking. */}
      {!isEmbed && <StoreStatusStrip openState={openState} zoneName={selectedZone?.name} />}

      {/* One dialog for both checkout mounts. Resolved explicitly in both
          directions so CheckoutPage is never left awaiting a dead promise. */}
      {closedPrompt && (
        <ConfirmDialog
          title="We're closed right now"
          message={openState?.nextOpenLabel
            ? `You can still place your order. We'll start preparing it when we reopen at ${openState.nextOpenLabel}, and deliver as soon as possible after that.`
            : "You can still place your order. We'll start preparing it when we reopen."}
          confirmLabel="Place order"
          cancelLabel="Keep shopping"
          danger={false}
          onConfirm={() => settlePrompt(true)}
          onCancel={() => settlePrompt(false)}
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
              onBack={() => { setCheckoutActive(false); setView(preCheckoutView); }}
              onHome={() => { setCheckoutActive(false); setView('home'); }}
              onLogin={(campaign?: any) => handleCheckoutLogin(campaign)}
              confirmOrder={confirmOrder}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number, orderData?: any) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount, trackingToken: orderData?.trackingToken, items: orderData?.items, total: orderData?.total, guestAddress: orderData?.guestAddress, guestName: orderData?.guestName, guestPhone: orderData?.guestPhone, createdAt: orderData?.createdAt, status: orderData?.status }); }}
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
              onLogin={(campaign?: any) => handleCheckoutLogin(campaign)}
              confirmOrder={confirmOrder}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number, orderData?: any) => { setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount, trackingToken: orderData?.trackingToken, items: orderData?.items, total: orderData?.total, guestAddress: orderData?.guestAddress, guestName: orderData?.guestName, guestPhone: orderData?.guestPhone, createdAt: orderData?.createdAt, status: orderData?.status }); }}
            />
          </div>
        </div>
      )}

      {/* Pages */}
      {view === 'about' ? (
        <DeferredPage><AboutPage /></DeferredPage>
      ) : view === 'categories' ? (
        <div className={PAGE_BOTTOM}>
          <CategoriesView categories={categories} products={products} />
        </div>
      ) : view === 'grievance' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><GrievancePage /></DeferredPage></div>
      ) : view === 'feedback' ? (
        <div className={PAGE_BOTTOM}><DeferredPage><FeedbackPage storeId={selectedZone?.storeId} /></DeferredPage></div>
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
          <DeferredPage><AccountPage
            onBack={() => setView('home')}
            storeName={settings.store_name}
            supportName={settings.support_name}
            supportPhone={settings.support_phone}
            whatsappNumber={settings.whatsapp_number}
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

          {/* Search intent takes priority over discovery on a phone. */}
          <div className={isHomeSearchFocused || search.trim() ? 'hidden sm:block' : undefined}>
            <HomeCarousel />
          </div>

          {/* Category pills */}
          <div className={isHomeSearchFocused || search.trim() ? 'hidden sm:block' : undefined}>
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
          </div>

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

          {/* About section */}
          <div className="mt-8 flex justify-center">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              About
            </span>
          </div>
          <div className="mt-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-6 text-center">
            <img src="/mart_brand_new.png" alt="Gokez Mart" className="h-16 w-auto object-contain mx-auto" />
            <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{BRAND_SLOGAN}</p>
            <p className="mt-4 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
              {BRAND_DESCRIPTION}
            </p>
            <p className="mt-3 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
              We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they&apos;ve built in your community over years.
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

          {/* Footer */}
          <footer className="mt-8 border-t-2 border-emerald-200 bg-white/80 pb-5 pt-6 dark:border-emerald-900/60 dark:bg-slate-900/70">
            <div className="mx-auto max-w-xl">
              <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-slate-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <section className="pb-5 sm:pr-5 sm:pb-0">
                  <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Contact Gokez Technologies</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={`tel:+${GOKEZ_SUPPORT.phoneE164}`} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">
                      <Phone className="h-4 w-4" />
                      <span>{GOKEZ_SUPPORT.phone}</span>
                    </a>
                    <a href={`mailto:${GOKEZ_SUPPORT.email}`} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-gray-900 px-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:bg-slate-700 dark:hover:bg-slate-600 dark:focus:ring-offset-slate-900">
                      <Mail className="h-4 w-4" />
                      <span className="break-all text-center">{GOKEZ_SUPPORT.email}</span>
                    </a>
                  </div>
                </section>
                <nav aria-label="Legal" className="flex flex-col items-center justify-center pt-4 sm:pl-5 sm:pt-0">
                  <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Legal</p>
                  <div className="flex items-center justify-center gap-3">
                    <a href="/privacy/" className="text-[10px] text-gray-500 transition-colors hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300">Privacy Policy</a>
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">·</span>
                    <a href="/terms/" className="text-[10px] text-gray-500 transition-colors hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300">Terms of Service</a>
                  </div>
                </nav>
                </div>

              <p className="mt-5 text-center text-[11px] text-gray-500 dark:text-slate-400">
                &copy; {new Date().getFullYear()} {BRAND_NAME}{' · '}A product of{' '}
                <a href={PARENT_COMPANY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline">
                  {PARENT_COMPANY}
                </a>
              </p>
            </div>
          </footer>
        </main>
      )}

      {/* Floating cart bar — mobile only */}
      <FloatingCart onOpen={handleCheckout} hidden={checkoutActive} />

      {/* Bottom nav — mobile only */}
      <div className="sm:hidden">
        <BottomNav active={view as 'home' | 'categories' | 'orders' | 'account'} onChange={handleNavChange} />
      </div>
    </div>
  );
}
