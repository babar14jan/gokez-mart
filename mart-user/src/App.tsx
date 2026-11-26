import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject, type TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, CheckCircle, BellRing, RefreshCw, CalendarClock, X } from 'lucide-react';
import { API_URL, isApiConfigured, storeApi } from './services/api';
import type { Category, Product, PublicSettings, HomeSection } from './services/api';
import { useThemeStore } from './store/themeStore';
import { useCustomerStore } from './store/customerStore';
import { useZoneStore, SHAPOORJI_ZONE, type ZoneAction } from './store/zoneStore';
import { getNotificationPermission, requestNotificationPermission, subscribeToPush, isPushSupported } from './services/push';
import Navbar from './components/Navbar';
import StoreStatusStrip from './components/StoreStatusStrip';
import StoreClosedCard from './components/StoreClosedCard';
import BottomNav from './components/BottomNav';
import AppShell from './components/AppShell';
import ProductCard from './components/ProductCard';
import FloatingCart from './components/FloatingCart';
import CategoriesView from './components/CategoriesView';
import HomeSections, { resolveSectionItems } from './components/HomeSections';
import ReferralBanner from './components/ReferralBanner';
import ComboSheet from './components/ComboSheet';
import DealsSheet from './components/DealsSheet';
import CatalogSearchSheet from './components/CatalogSearchSheet';
import SmartImage from './components/SmartImage';
import LoginModal from './components/LoginModal';

import CheckoutPage from './pages/CheckoutPage';
import DealsPage from './pages/DealsPage';
import { useCustomerAuthStore } from './store/customerAuthStore';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useRotatingSearchPrompt } from './hooks/useRotatingSearchPrompt';
import { useUpdateStore } from './store/updateStore';
import { hideSplash, MIN_SPLASH_MS } from './utils/splash';
import { rememberClosedCopy } from './utils/storeClosed';
import { useCartStore } from './store/cartStore';
import { useInstallGuide, dismissInstallGuide } from './utils/install';
import { trackInstall } from './utils/track';
import HomeCarousel from './components/HomeCarousel';
import { PAGE_BOTTOM, PAGE_BOTTOM_CART } from './utils/pageBottom';
import { useKeyboardInset } from './utils/useKeyboardInset';
import { useScrollChrome } from './utils/useScrollChrome';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { applySeo } from './utils/seo';
import { useLoginFlowStore } from './store/loginFlowStore';
import { useAccountLoginStore } from './store/accountLoginStore';
import { track, getFunnelChannel } from './utils/track';
import { saveTrackingToken } from './utils/guestTracking';
import { detectPlatform } from './utils/install';
import { BRAND_NAME, PARENT_COMPANY, PARENT_COMPANY_URL } from './constants/brand';
import { ORDER_PROGRESS_LABELS, STATUS_LABELS } from './utils/orderStatus';
import { REFERRAL_LINK_CODE_KEY, referralCodeFromSearch } from './utils/referral';
import { configureNativeChrome, hasNativeLocationPermission, isNativeAndroid, setNativeStatusBar, watchNativeBackButton } from './services/nativeApp';
import { clearNativePushAssociation, consumePendingPushRoute, isNativePush, startNativePush, syncNativePushAssociation } from './services/nativePush';

const WELCOME_SEEN_KEY = 'gokez_mart_welcome_seen_v1';

type View = 'home' | 'about' | 'what-is-gokez-mart' | 'categories' | 'deals' | 'orders' | 'account' | 'login' | 'privacy' | 'terms' | 'grievance' | 'delete-account' | 'feedback' | 'referral' | 'fresh' | 'welcome';

// Canonical URL for each view. Used to give every tab its own history entry so a
// sub-page opened from it can return there with the back button.
const VIEW_PATH: Record<View, string> = {
  home: '/',
  about: '/about',
  'what-is-gokez-mart': '/what-is-gokez-mart',
  categories: '/categories',
  deals: '/deals',
  orders: '/orders',
  account: '/account',
  login: '/login',
  welcome: '/welcome',
  privacy: '/privacy',
  terms: '/terms',
  grievance: '/grievance',
  'delete-account': '/delete-account',
  feedback: '/feedback',
  referral: '/referrals',
  fresh: '/fresh',
};

type PermissionPrompt = 'order-notifications' | null;

const PERMISSION_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const ORDER_NOTIFICATION_PROMPT_KEY = 'mart_order_notification_prompted_at';
const PULL_REFRESH_THRESHOLD = 76;
// Mirrors the active tab so a reload (pull-to-refresh, browser refresh, PWA
// resume) can come back to it. The URL alone is not enough: a guest booting at
// '/' is deliberately sent to Account, which made every refresh dump shoppers
// on the login page no matter which tab they were on.
const LAST_VIEW_KEY = 'mart-last-view';

function isPermissionPromptDue(storageKey: string): boolean {
  const lastPromptedAt = Number(localStorage.getItem(storageKey) || 0);
  return !lastPromptedAt || Date.now() - lastPromptedAt >= PERMISSION_PROMPT_COOLDOWN_MS;
}

function recordPermissionPrompt(storageKey: string) {
  localStorage.setItem(storageKey, String(Date.now()));
}

const OrderHistoryPage = lazyWithRetry(() => import('./pages/OrderHistoryPage'));
const AccountPage = lazyWithRetry(() => import('./pages/AccountPage'));
const PrivacyPage = lazyWithRetry(() => import('./pages/PrivacyPage'));
const TermsPage = lazyWithRetry(() => import('./pages/TermsPage'));
const GrievancePage = lazyWithRetry(() => import('./pages/GrievancePage'));
const DeleteAccountPage = lazyWithRetry(() => import('./pages/DeleteAccountPage'));
const FeedbackPage = lazyWithRetry(() => import('./pages/FeedbackPage'));
const ReferralPage = lazyWithRetry(() => import('./pages/ReferralPage'));
const AboutPage = lazyWithRetry(() => import('./pages/AboutPage'));
const WhatIsGokezMartPage = lazyWithRetry(() => import('./pages/WhatIsGokezMartPage'));

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-[12rem]" />}>{children}</Suspense>;
}

function useContainTopPull(scrollRef: RefObject<HTMLDivElement>, active: boolean) {
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!active || !scrollElement) return;
    let start: { x: number; y: number } | null = null;
    const clear = () => { start = null; };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || scrollElement.scrollTop !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const deltaY = touch.clientY - start.y;
      const deltaX = Math.abs(touch.clientX - start.x);
      if (deltaY <= 0 || deltaX > Math.max(16, deltaY * 0.6)) {
        clear();
        return;
      }
      event.preventDefault();
    };
    scrollElement.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollElement.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollElement.addEventListener('touchend', clear);
    scrollElement.addEventListener('touchcancel', clear);
    return () => {
      scrollElement.removeEventListener('touchstart', onTouchStart);
      scrollElement.removeEventListener('touchmove', onTouchMove);
      scrollElement.removeEventListener('touchend', clear);
      scrollElement.removeEventListener('touchcancel', clear);
    };
  }, [active, scrollRef]);
}

/** How long to wait before trying a catalogue that would not load again. */
const CATALOGUE_RETRY_MS = 15000;

const DEFAULT_SETTINGS: PublicSettings = {
  store_name: BRAND_NAME, store_address: 'Kolkata',
  delivery_charge: '0', free_delivery_above: '0', min_order_amount: '0',
  delivery_area: 'Kolkata', store_open: 'true',
  estimated_delivery: '30-45 mins', cod_enabled: 'true',
  upi_enabled: 'true', phonepay_enabled: 'false',
  inventory_tracking: 'false', auto_out_of_stock: 'on_zero',
  phonepay_qr_url: '', upi_phone: '', upi_id: '', whatsapp_number: '',
  support_name: '', support_phone: '', store_closed_message: '', store_closed_greeting: '',
  store_closed_from: '', store_closed_until: '',
};

export default function App() {
  const referralLinkCode = (() => {
    const code = referralCodeFromSearch(window.location.search);
    if (!code) return '';
    try { sessionStorage.removeItem(REFERRAL_LINK_CODE_KEY); } catch {}
    if (useCustomerAuthStore.getState().isLoggedIn) return '';
    try { sessionStorage.setItem(REFERRAL_LINK_CODE_KEY, code); } catch {}
    window.history.replaceState({}, '', '/login');
    return code;
  })();
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';
  const [view, setView] = useState<View>(() => {
    const welcomeSeen = typeof localStorage !== 'undefined' && localStorage.getItem(WELCOME_SEEN_KEY) === 'true';
    const loggedIn = useCustomerAuthStore.getState().isLoggedIn;
    if (referralLinkCode) return 'login';
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    // The public, crawlable pages keep their own view so direct links and the
    // prerendered SEO documents still resolve. /delete-account is kept because it
    // is a standalone account-deletion link.
    if (path === '/about') return 'about';
    if (path === '/what-is-gokez-mart') return 'what-is-gokez-mart';
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/grievance') return 'grievance';
    if (path === '/feedback') return 'feedback';
    if (path === '/delete-account') return 'delete-account';
    if (path === '/referrals') return 'referral';
    if (path === '/account') return 'account';
    if (path === '/login') return 'login';
    if (path === '/welcome') {
      if (loggedIn) { window.history.replaceState({}, '', '/'); return 'home'; }
      if (welcomeSeen) { window.history.replaceState({}, '', '/login'); return 'login'; }
      return 'welcome';
    }
    // The tab paths are real views, not just history markers: a reload on
    // /categories, /orders or /deals has to come back to that tab instead of
    // being normalised to Home (the popstate handler already resolved them).
    if (path === '/orders') return 'orders';
    if (path === '/categories' || path.startsWith('/categories')) return 'categories';
    if (path === '/deals') return 'deals';
    if (path === '/') {
      if (loggedIn) {
        if (!isEmbed) {
          let stored: string | null = null;
          try { stored = sessionStorage.getItem(LAST_VIEW_KEY); } catch {}
          const storedView = (Object.keys(VIEW_PATH) as View[]).find(v => VIEW_PATH[v] === stored);
          if (storedView) {
            window.history.replaceState({}, '', VIEW_PATH[storedView]);
            return storedView;
          }
        }
        return 'home';
      }
      if (!welcomeSeen) {
        window.history.replaceState({}, '', '/welcome');
        return 'welcome';
      }
      // A refresh keeps whatever tab the shopper was on. The last view is
      // mirrored into sessionStorage on every change and wins over the
      // default below, which is only the first-visit destination.
      if (!isEmbed) {
        let stored: string | null = null;
        try { stored = sessionStorage.getItem(LAST_VIEW_KEY); } catch {}
        const storedView = (Object.keys(VIEW_PATH) as View[]).find(v => VIEW_PATH[v] === stored);
        if (storedView) {
          window.history.replaceState({}, '', VIEW_PATH[storedView]);
          return storedView;
        }
      }
      // A first visit for a signed-out shopper lands on the login page, unless
      // the link carries tracking/referral parameters (e.g. a QR code), in which
      // case it lands on Home so the campaign is not blocked by a login wall.
      if (!window.location.search) return 'login';
      return 'home';
    }
    // Unrecognized/private routes boot to Home and are normalized so the address
    // bar is not left showing a stale route over the Home view.
    window.history.replaceState({}, '', '/');
    return 'home';
  });
  const [checkoutActive, setCheckoutActive] = useState(false);
  // The bottom tabs move `view` without pushing history. Tapping Account from any
  // tab opens the login page, and the guest escape from there exits to Home
  // rather than bouncing back to the tab it was opened from (e.g. Categories).
  // Mirrored in state because writing sessionStorage alone does not re-render,
  // which made "Not now" look like it did nothing.
  const [signInPromptDismissed, setSignInPromptDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem('guest_signin_dismissed') === '1'
  );

  const [preCheckoutView, setPreCheckoutView] = useState<View>('home');
  const [successData, setSuccessData] = useState<{ num: string; preference: string; storeName?: string; savedAmount?: number; trackingToken?: string; items?: any[]; total?: number; guestAddress?: string; guestName?: string; guestPhone?: string; createdAt?: string; status?: string; scheduledLabel?: string } | null>(null);
  const installGuide = useInstallGuide();
  const [installCardHidden, setInstallCardHidden] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const installPromptOpen = Boolean(installGuide.visible && installGuide.platform && !installCardHidden);
  const installPromptTrackedRef = useRef(false);
  useEffect(() => {
    if (!successData) return;
    if (!installPromptOpen) {
      installPromptTrackedRef.current = false;
      return;
    }
    if (installPromptTrackedRef.current) return;
    installPromptTrackedRef.current = true;
    if (installGuide.platform) trackInstall('install_prompt_shown', installGuide.platform);
  }, [successData, installPromptOpen, installGuide.platform]);
  // One session_start per session, fired as early as possible so a visit that
  // never reaches the login screen is still counted.
  useEffect(() => {
    track('session_start', { channel: getFunnelChannel() });
  }, []);

  useEffect(() => {
    configureNativeChrome().catch(() => {});
    startNativePush().catch(() => {});
  }, []);

  const [pendingCheckout, setPendingCheckout] = useState(() => Boolean(useLoginFlowStore.getState().getActiveOtpFlow()?.pendingCheckout));

  const { isLoggedIn } = useCustomerAuthStore();
  const wasLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    if (!isNativePush()) return;
    if (isLoggedIn) {
      syncNativePushAssociation().catch(() => {});
    } else if (wasLoggedInRef.current) {
      clearNativePushAssociation().catch(() => {});
    }
    wasLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  // Guest "Hi Guest" login on the Account tab: opened from the header or the
  // page's "Continue Login" card (both read the shared store), and closed the
  // moment the tab is left so a return visit lands on the Account page rather
  // than mid-login.
  const accountLoginOpen = useAccountLoginStore((s) => s.open);
  useEffect(() => {
    if (isLoggedIn) return;
    if (view === 'welcome') return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(WELCOME_SEEN_KEY) !== 'true') return;
    if (window.location.search) return;
    if (sessionStorage.getItem('mart-boot-login-done')) return;
    sessionStorage.setItem('mart-boot-login-done', '1');
    useLoginFlowStore.getState().setGuestReturnPath('/');
    useAccountLoginStore.getState().openLogin();
  }, [isLoggedIn, view]);
  useEffect(() => {
    if (view !== 'account' && view !== 'login') useAccountLoginStore.getState().closeLogin();
  }, [view]);
  useEffect(() => {
    if (!referralLinkCode && view !== 'login') return;
    useAccountLoginStore.getState().openLogin();
  }, [referralLinkCode, view]);

  // Secondary Account/Profile sub-pages render their own green header (see
  // PageHeader), so the browsing Navbar — with its delivery-zone selector —
  // must not stack above it. Embed mode is already handled by `isEmbed`.
  const accountSubPage = view === 'feedback' || view === 'grievance' || view === 'privacy' || view === 'terms' || view === 'delete-account' || view === 'about' || view === 'what-is-gokez-mart' || view === 'referral';

  // Load the customer's address book from the backend on login.
  // (No longer auto-migrates "legacy local" addresses — that path could pick up
  // whatever was left in the shared local store from a previous session/customer.)
  useEffect(() => {
    if (!isLoggedIn) return;
    useCustomerStore.getState().loadAddresses();
  }, [isLoggedIn]);
  const [showLoginModal, setShowLoginModal] = useState(() => Boolean(useLoginFlowStore.getState().getActiveOtpFlow()));
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPrompt>(null);
  const [orderNotificationError, setOrderNotificationError] = useState('');
  const [enablingOrderNotifications, setEnablingOrderNotifications] = useState(false);

  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  // Outcome of the pull-to-refresh gesture, surfaced as a toast. Unlike the launch
  // error panel this never blanks the store: a failed refresh keeps the catalogue
  // that is already on screen and only explains what went wrong.
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [pendingCategorySlug, setPendingCategorySlug] = useState<string | null>(null);
  const [carouselPosition] = useState<'top' | 'bottom'>(() => {
    try {
      if (localStorage.getItem('mart_has_delivered_order') === '1') return 'bottom';
    } catch {}
    try {
      const raw = localStorage.getItem('mart_orders_cache');
      if (raw) {
        const orders = JSON.parse(raw);
        if (Array.isArray(orders) && orders.some((o: any) => o?.status === 'delivered' || o?.status === 'completed')) {
          try { localStorage.setItem('mart_has_delivered_order', '1'); } catch {}
          return 'bottom';
        }
      }
    } catch {}
    return 'top';
  });
  const categoriesRef = useRef<Category[]>([]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    const iconUrls = [...new Set(categories.map(category => category.icon)
      .filter(icon => icon?.startsWith('/') || icon?.startsWith('http')))];
    iconUrls.forEach(icon => { const image = new Image(); image.src = icon; });
  }, [categories]);

  // Configurable homepage sections, ordered by the backend. Empty (or failed to
  // load) falls back to the built-in category-grouped layout, so the home page is
  // never blank if the sections endpoint is unavailable.
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [comboSheet, setComboSheet] = useState<{ title: string; subtitle?: string; products: Product[] } | null>(null);
  const [dealsSheet, setDealsSheet] = useState<{ title: string; products: Product[] } | null>(null);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  // Holds the resolver for the in-flight "store is closed" confirmation. Kept as
  // a ref-backed closure rather than a boolean so the promise settles exactly
  // once, whether the customer confirms, cancels, or the dialog unmounts.
  const [closedPrompt, setClosedPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  // The closed-store card, shown on its own when the customer first arrives
  // at a closed store. It has nothing pending, so it only has to be closed.
  const [closedCard, setClosedCard] = useState(false);
  const openState = settings.openState;
  // When the store reopens. A scheduled closure says exactly when it lifts; a
  // store that is simply past its opening hours says so through the weekly
  // schedule. Either way the customer is told the time, rather than being
  // left with "as soon as we reopen".
  const storeResumeLabel = openState?.closedUntilLabel ?? openState?.nextOpenLabel ?? null;

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
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);
  // The Fresh tab and the "top picks" view-all open the full-screen catalogue
  // just to browse: no keyboard and no cursor in the search box. The search
  // entry points (the home search box, the desktop navbar search) keep auto-focus.
  const [catalogSearchAutoFocus, setCatalogSearchAutoFocus] = useState(true);
  // The middle nav button opens the admin-configured Fresh page; every search
  // entry point opens the full-catalogue search.
  const [catalogSearchMode, setCatalogSearchMode] = useState<'catalog' | 'fresh'>('catalog');
  const openCatalogSearch = (autoFocus = true) => {
    setCatalogSearchMode('catalog');
    setCatalogSearchAutoFocus(autoFocus);
    setCatalogSearchOpen(true);
  };
  const openFreshPage = () => {
    setView('fresh');
  };
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRequest, setCatalogRequest] = useState(0);

  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  const cartItems = useCartStore(s => s.totalItems());

  // The floating cart is a browsing aid for the main product surfaces (home,
  // categories, orders). It deliberately does NOT appear on the account page,
  // the legal/info sub-pages, or the combo/deals sheets (which are short and
  // back out to Home, where the cart already lives), so none of those reserve
  // bottom clearance for it.
  const productPage = view === 'home' || view === 'categories' || view === 'orders' || view === 'fresh';
  const productPageBottom = cartItems > 0 ? PAGE_BOTTOM_CART : PAGE_BOTTOM;

  const searchPrompt = useRotatingSearchPrompt(products);
  // Delivery-area state lives in the shared zone store so the navbar picker, the
  // Account page toggle and this catalog loader all read/write one source of truth.
  const selectedZone = useZoneStore(s => s.selectedZone);
  const activeStoreId = selectedZone?.storeId ?? SHAPOORJI_ZONE.storeId;
  const activeCatalogSelectionRef = useRef({ storeId: activeStoreId, zoneId: selectedZone?.id });
  activeCatalogSelectionRef.current = { storeId: activeStoreId, zoneId: selectedZone?.id };

  // A catalogue that would not load is loaded again: when the connection
  // comes back, and on a short timer for as long as it keeps failing. The
  // outage screen has its own re-check, but the catalogue is this app's
  // business, so the retry lives here rather than being triggered by a
  // message from the screen.
  useEffect(() => {
    if (!catalogError) return;
    const retry = () => setCatalogRequest(request => request + 1);
    const onOnline = () => retry();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(retry, CATALOGUE_RETRY_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [catalogError]);

  // The card, on arrival at a closed store. It opens every time the app is
  // opened or refreshed, and every time the PWA is reopened, because that is
  // when the customer has no idea why the store is shut. Once they have read
  // it, the strip under the header keeps it in view without blocking
  // anything.
  useEffect(() => {
    // The card must follow the live open state: a store that is open now must
    // not keep showing a stale "closed" card from an earlier fallback load.
    setClosedCard(openState?.isOpen === false);
  }, [openState?.isOpen, openState?.closedReason, openState?.closedUntilLabel]);

  // The ONE fetch path for the home catalogue (categories, products, settings and
  // sections). Shared by the silent resume/poll refresh and the pull gesture, so a
  // manual refresh updates data in place instead of reloading the document — the
  // current view, scroll position, search text and already-decoded images all
  // survive, and it never shows the skeleton (that is first-load only).
  //
  // Silent refreshes are stamp-gated: the server exposes a tiny /catalog/stamp
  // fingerprint, and the full four-endpoint download only runs when it actually
  // changed. A quiet store therefore costs one small aggregate query per poll
  // instead of the whole catalogue. Pull-to-refresh and reconnects force the
  // real download.
  const catalogStampRef = useRef<string | null>(null);
  const catalogRefreshGenerationRef = useRef(0);

  const fetchCatalogBundle = useCallback(async (storeId?: string, zoneId?: string, fresh = false, isCancelled?: () => boolean) => {
    const [catRes, prodRes, settingsRes, sectionsRes] = await Promise.all([
      storeApi.getCategories({ fresh }),
      storeApi.getProducts(undefined, storeId, { fresh }, zoneId),
      storeApi.getSettings(storeId, { fresh }, zoneId),
      storeApi.getHomeSections(storeId, { fresh }),
    ]);
    // A store switch (or Try Again) started a newer load while this one was in
    // flight — discard it, or it would overwrite the new store's catalogue.
    if (isCancelled?.()) return;
    setCategories([...(catRes.data.data || [])]);
    setProducts([...(prodRes.data.data || [])]);
    setSettings(settingsRes.data.data || DEFAULT_SETTINGS);
    // Keep the store's closure wording on the device. When the backend is
    // genuinely down the app cannot ask it for the message, and the customer's
    // screen should still say what the store would have said.
    rememberClosedCopy(
      settingsRes.data.data?.store_closed_greeting,
      settingsRes.data.data?.store_closed_message,
    );
    setHomeSections([...(sectionsRes.data.data || [])]);
    // The bundle is on screen, so any previous load error is resolved. This is
    // what clears the banner after a silent refresh/reconnect recovers from a
    // failed cold load.
    setCatalogError(null);
    return {
      products: prodRes.data.data || [],
      settings: settingsRes.data.data || DEFAULT_SETTINGS,
    };
  }, []);

  const reconcileCartWithCatalog = useCallback((products: Product[], settings: PublicSettings) => {
    const enforceOutOfStock = settings.inventory_tracking === 'true' && settings.auto_out_of_stock === 'on_zero';
    useCartStore.getState().reconcileWithCatalog(products, enforceOutOfStock);
  }, []);

  const refreshCatalog = useCallback(async (storeId?: string, zoneId?: string, opts?: { force?: boolean; reconcileCart?: boolean }) => {
    const refreshGeneration = ++catalogRefreshGenerationRef.current;
    const isStale = () => refreshGeneration !== catalogRefreshGenerationRef.current
      || activeCatalogSelectionRef.current.storeId !== storeId
      || activeCatalogSelectionRef.current.zoneId !== zoneId;
    // The stamp is always read BEFORE the body, forced or not: a stamp stored
    // after the body could be newer than it and would silently swallow one
    // change until the following one. Reading first means a mid-flight change
    // only costs one redundant refresh next cycle.
    let stamp: string | null = null;
    try {
      const r = await storeApi.getCatalogStamp(storeId, zoneId);
      stamp = r.data.data?.stamp ?? null;
      // Nothing changed since the last full load — skip the heavy download.
      if (!opts?.force && stamp !== null && stamp === catalogStampRef.current) return;
    } catch {
      // Stamp unavailable (older backend, offline blip): fall through to a
      // real refresh rather than leaving the catalogue stuck.
      stamp = null;
    }
    const bundle = await fetchCatalogBundle(storeId, zoneId, true, isStale);
    if (isStale()) return;
    catalogStampRef.current = stamp;
    if (opts?.reconcileCart && bundle) reconcileCartWithCatalog(bundle.products, bundle.settings);
  }, [fetchCatalogBundle, reconcileCartWithCatalog]);

  const revalidateCart = useCallback(async () => {
    try {
      const [productsRes, settingsRes] = await Promise.all([
        storeApi.getProducts(undefined, activeStoreId, { fresh: true }, selectedZone?.id),
        storeApi.getSettings(activeStoreId, { fresh: true }, selectedZone?.id),
      ]);
      reconcileCartWithCatalog(productsRes.data.data || [], settingsRes.data.data || DEFAULT_SETTINGS);
    } catch {}
  }, [activeStoreId, selectedZone?.id, reconcileCartWithCatalog]);

  useEffect(() => {
    if (!checkoutActive) return;
    void revalidateCart();
  }, [checkoutActive, revalidateCart]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const params = new URLSearchParams({ storeId: activeStoreId });
    if (selectedZone?.id) params.set('zoneId', selectedZone.id);
    const source = new EventSource(`${API_URL}/catalog/events?${params.toString()}`);
    const onCatalogChange = () => {
      void refreshCatalog(activeStoreId, selectedZone?.id, { force: true, reconcileCart: checkoutActive });
    };
    source.addEventListener('catalog', onCatalogChange);
    return () => {
      source.removeEventListener('catalog', onCatalogChange);
      source.close();
    };
  }, [activeStoreId, selectedZone?.id, checkoutActive, refreshCatalog]);

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
  const loginPageActive = view === 'login' || (view === 'account' && accountLoginOpen && !isLoggedIn);
  const loginActive = showLoginModal || loginPageActive;
  const welcomeActive = view === 'welcome';
  const scrollRef = useRef<HTMLDivElement>(null);
  // Categories scrolls inside its product pane, not .app-scroll. Held in state
  // (callback ref) so useScrollChrome re-attaches when the pane mounts.
  const [categoriesPaneEl, setCategoriesPaneEl] = useState<HTMLDivElement | null>(null);
  const mobileCheckoutScrollRef = useRef<HTMLDivElement>(null);
  const desktopCheckoutScrollRef = useRef<HTMLDivElement>(null);
  useContainTopPull(mobileCheckoutScrollRef, checkoutActive);
  useContainTopPull(desktopCheckoutScrollRef, checkoutActive);
  // ONE controller for the app chrome. The Navbar delivery row and the bottom
  // nav both consume it (deliveryHidden / bottomNavHidden), so every element
  // flips in the same commit — the old per-component listeners had different
  // enable flags and drifted apart, which read as a shake. They diverge at the
  // end of a page only: the nav (an overlay) returns there, the delivery row
  // (in-flow) does not. Enabled everywhere the chrome renders, except while an
  // overlay owns the screen (checkout) or the login flow replaces the header.
  const chromeAutoHide = !welcomeActive && !checkoutActive && !accountSubPage && view !== 'account';
  const { hidden: chromeHidden, navHidden } = useScrollChrome(scrollRef, chromeAutoHide, categoriesPaneEl);
  const pullStart = useRef<{ x: number; y: number } | null>(null);
  const pullDistance = useRef(0);
  const [pullDistanceVisible, setPullDistanceVisible] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handlePullTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || scrollRef.current?.scrollTop !== 0) return;
    if (welcomeActive || checkoutActive || showLoginModal || catalogSearchOpen || comboSheet || dealsSheet) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    const touch = event.touches[0];
    pullStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handlePullTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = pullStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const deltaY = touch.clientY - start.y;
    const deltaX = Math.abs(touch.clientX - start.x);
    if (deltaY <= 0 || deltaX > Math.max(16, deltaY * 0.6)) {
      pullStart.current = null;
      pullDistance.current = 0;
      setPullDistanceVisible(0);
      return;
    }
    pullDistance.current = deltaY;
    setPullDistanceVisible(Math.min(deltaY, PULL_REFRESH_THRESHOLD));
  };

  const finishPullGesture = () => {
    pullStart.current = null;
    if (pullDistance.current >= PULL_REFRESH_THRESHOLD) {
      // Refresh in place. The document is never reloaded, so the view, scroll
      // position, search text, cart and already-decoded images all survive —
      // the old implementation called location.reload(), which blanked the
      // screen and reset everything.
      setRefreshing(true);
      pullDistance.current = 0;
      setPullDistanceVisible(0);
      const startedAt = Date.now();
      refreshCatalog(activeStoreId, selectedZone?.id, { force: true })
        .then(() => setRefreshNotice(null))
        .catch(() => setRefreshNotice(
          navigator.onLine
            ? 'Couldn\u2019t refresh. Please try again.'
            : 'You\u2019re offline. Check your connection and try again.',
        ))
        .finally(() => {
          // Hold the spinner briefly so even a fast refresh reads as "done".
          const remaining = Math.max(0, 450 - (Date.now() - startedAt));
          window.setTimeout(() => setRefreshing(false), remaining);
        });
      return;
    }
    pullDistance.current = 0;
    setPullDistanceVisible(0);
  };

  const cancelPullGesture = () => {
    pullStart.current = null;
    pullDistance.current = 0;
    setPullDistanceVisible(0);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    // The page now scrolls inside .app-scroll, not the document, so reset it too.
    scrollRef.current?.scrollTo(0, 0);
  }, [view, showingSuccess]);

  // Keep the last-view mirror fresh for the next boot (pull-to-refresh, browser
  // refresh, PWA resume). Checkout deliberately stays out: it is an overlay, and
  // the pending-checkout flow (not the view) is what restores it after a reload.
  useEffect(() => {
    if (view === 'welcome') return;
    try { sessionStorage.setItem(LAST_VIEW_KEY, VIEW_PATH[view]); } catch {}
  }, [view]);

  useEffect(() => {
    const effectiveDark = isDark && !loginActive;
    document.documentElement.classList.toggle('dark', effectiveDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    const mobile = detectPlatform() === 'ios' || detectPlatform() === 'android';
    const themeColor = loginPageActive
      ? '#e5fde5'
      : loginActive
        ? '#e5fde5'
        : effectiveDark
          ? '#18191a'
          : mobile
            ? '#ADFBBD'
            : '#ffffff';
    // Set this on every run: the splash is removed outside React, so waiting for
    // it here left Android Chrome stuck on the darker launch colour after boot.
    if (meta) meta.setAttribute('content', themeColor);
    setNativeStatusBar(themeColor, effectiveDark).catch(() => {});
  }, [isDark, loginActive, loginPageActive]);

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
      else if (path === '/what-is-gokez-mart') setView('what-is-gokez-mart');
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
      else if (path === '/login') setView('login');
      else if (path === '/welcome') {
        const loggedIn = useCustomerAuthStore.getState().isLoggedIn;
        const welcomeSeen = typeof localStorage !== 'undefined' && localStorage.getItem(WELCOME_SEEN_KEY) === 'true';
        if (loggedIn) { window.history.replaceState({}, '', '/'); setView('home'); }
        else if (welcomeSeen) { window.history.replaceState({}, '', '/login'); setView('login'); }
        else setView('welcome');
      }
      // Needed because the login redirect lands here: AccountPage navigates to
      // postLoginPath, which is '/orders' for the guest "Track My Orders" CTA.
      // Without this branch the pushState fell through to setView('home'), so a
      // customer who signed in from the account page was dumped on the home
      // screen instead of their order history.
      else if (path === '/orders') setView('orders');
      else if (path === '/referrals') setView('referral');
      else if (path === '/fresh') setView('fresh');
      // Declining login from the account tab returns here, so this path has to
      // resolve to a view. Without it the guest exit fell through to Home.
      else if (path === '/categories' || path.startsWith('/categories')) setView('categories');
      else if (path === '/deals') setView('deals');
      else if (path === '/checkout') { setView('home'); setCheckoutActive(true); }
      else setView('home');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    const route = consumePendingPushRoute();
    if (!route) return;
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | null = null;
    watchNativeBackButton(() => {
      if (checkoutActive) { setCheckoutActive(false); return true; }
      if (catalogSearchOpen) { setCatalogSearchOpen(false); return true; }
      if (successData) { setSuccessData(null); return true; }
      if (permissionPrompt) { setPermissionPrompt(null); return true; }
      if (installGuideOpen) { setInstallGuideOpen(false); return true; }
      if (showLoginModal) {
        useLoginFlowStore.getState().clear();
        setShowLoginModal(false);
        return true;
      }
      if (accountLoginOpen && !isLoggedIn) {
        useAccountLoginStore.getState().closeLogin();
        return true;
      }
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (path !== '/' && window.history.length > 1) {
        window.history.back();
        return true;
      }
      return false;
    }).then(fn => {
      if (disposed) fn();
      else remove = fn;
    }).catch(() => {});
    return () => {
      disposed = true;
      remove?.();
    };
  }, [checkoutActive, catalogSearchOpen, successData, permissionPrompt, installGuideOpen, showLoginModal, accountLoginOpen, isLoggedIn]);

  // Delivery areas: load once, keep a saved zone if it still exists (never
  // silently reset a deliberate choice), and — only on a first visit — quietly
  // prefill the zone from GPS if permission is already granted. Detecting here
  // never pops a browser prompt; the Navbar "Use my location" action does.
  // Zones are a convenience, not a gate: if the areas API fails we still serve
  // the default catalog from the effect below and never block ordering.
  useEffect(() => {
    if (!isApiConfigured) {
      setCatalogError('Store service is not configured. Please try again later.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    // A deliberate pick (or a prior detection) means the customer owns the area
    // choice — never override it from GPS on later visits.
    const hasZoneSelected = useZoneStore.getState().zoneSelected;

    (async () => {
      try {
        const zonesRes = await storeApi.getZones();
        if (cancelled) return;
        const fetchedZones = zonesRes.data.data || [];
        useZoneStore.getState().setZones(fetchedZones);
        useZoneStore.getState().setSelectedZone(prev => {
          if (fetchedZones.length === 0) return prev ?? SHAPOORJI_ZONE;
          // Keep the customer's chosen area (same id) but take the fresh object
          // from /zones so a name/radius edited in the hub shows up immediately.
          const sameZone = prev && fetchedZones.find(z => z.id === prev.id);
          if (sameZone) return sameZone;
          return fetchedZones.find(zone => zone.storeId === SHAPOORJI_ZONE.storeId) || fetchedZones[0];
        });
        if (hasZoneSelected || cancelled) return;
        const { autoDetect } = useZoneStore.getState();
        if (!autoDetect) return;
        if (!(await hasNativeLocationPermission())) return;
        if (!isNativeAndroid()) {
          if (!navigator.permissions) return;
          const result = await navigator.permissions.query({ name: 'geolocation' });
          if (result.state !== 'granted' || cancelled) return;
        }
        await useZoneStore.getState().detectAndApply({ prompt: false });
      } catch {
        // Swallow — a zones outage must not block the default catalog.
      }
    })();

    return () => { cancelled = true; };
  }, [catalogRequest]);

  // Keep the launch splash up for a short brand moment while the first screen
  // loads. Data fetching runs behind it; the overlay comes down as soon as BOTH
  // the app is ready and the minimum hold has passed. No fade, so it never sits
  // over the loaded app. A build swap still holds it until the reload lands.
  // main.tsx and the inline timeout in index.html are safety nets.
  const updateSwapPending = useUpdateStore((s) => s.swapPending);
  useEffect(() => {
    if (loading) return;
    // A forced swap is under way: the splash is the cover for it.
    if (updateSwapPending) return;
    if (!document.getElementById('app-splash')) return;
    const start = (window as unknown as { __splashStart?: number }).__splashStart ?? Date.now();
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - start));
    const timer = window.setTimeout(hideSplash, wait);
    return () => window.clearTimeout(timer);
  }, [loading, updateSwapPending]);

  // Catalog + settings for the active delivery zone. Refires whenever the zone
  // changes (navbar picker, "Use my location", Account toggle, GPS prefill) or
  // on "Try Again", so every switch goes through ONE path — previously the GPS
  // path and the picker duplicated this and could drift apart.
  useEffect(() => {
    if (!isApiConfigured) return;
    let cancelled = false;
    setLoading(true);
    setCatalogError(null);
    // A cold load (or a zone switch) always downloads for real; the stamp only
    // gates the silent poll, never the first paint or an explicit store change.
    // A zone switch must also drop the previous store's stamp, or the first
    // poll would compare against the wrong store and skip a needed download.
    catalogStampRef.current = null;
    // Stamp and body run in parallel so first paint never waits on the stamp;
    // the stamp is stored only if it arrived BEFORE the body settled — a stamp
    // read after the body could be newer than it and would silently swallow one
    // change. Losing that race just costs one redundant full download at the
    // first poll.
    let bodyDone = false;
    const stampPromise = storeApi.getCatalogStamp(activeStoreId, selectedZone?.id)
      .then(r => {
        if (!cancelled && !bodyDone) catalogStampRef.current = r.data.data?.stamp ?? null;
      })
      .catch(() => {});
    const bodyPromise = fetchCatalogBundle(activeStoreId, selectedZone?.id, true, () => cancelled).then(() => {
      bodyDone = true;
    }).catch(() => {
      bodyDone = true;
      if (!cancelled) {
        // Hand the failure to the full-screen offline / unreachable notice, so
        // it is shown once, over everything, instead of a card sitting in the
        // middle of the home page.
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        try {
          window.dispatchEvent(new CustomEvent('mart:api-failed', {
            detail: offline ? { offline: true } : { server: true },
          }));
        } catch {}
      }
      if (!cancelled) setCatalogError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'You\u2019re offline. Check your internet connection and try again.'
          : 'We could not load the store right now. Please try again shortly.',
      );
    });
    // Keep the loading skeleton up until both settle — the stamp is one small
    // query, and dropping it early makes the first silent poll do a full
    // download it could have skipped.
    Promise.allSettled([stampPromise, bodyPromise]).then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeStoreId, selectedZone?.id, catalogRequest, fetchCatalogBundle]);

  // Silent refresh — a stamp check for the current store every 3 mins, and on
  // resume/focus. Installed PWAs freeze timers while backgrounded and iOS
  // standalone doesn't reliably fire visibilitychange when recalled from the app
  // switcher, so pageshow/focus are needed too or the catalogue stays stale until
  // a full close + reopen. A short dedupe window collapses the burst of events
  // that fire together (focus + pageshow + visibilitychange) into one check.
  // refreshCatalog compares /catalog/stamp first, so a quiet store skips the
  // full download; only a real change (or a forced reconnect) pays for it.
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefresh < 15_000) return;
      lastRefresh = now;
      try { await refreshCatalog(selectedZone?.storeId, selectedZone?.id, { force }); } catch {}
    };
    const onResume = () => { if (document.visibilityState === 'visible') refresh(); };
    // Reconnect is a hard signal that the catalogue may be stale: refresh at once
    // and skip the dedupe window, so the store repopulates the moment the network
    // is usable again without ever clearing what is on screen.
    const onReconnect = () => refresh(true);
    const interval = setInterval(() => refresh(), 3 * 60 * 1000);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('online', onReconnect);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('online', onReconnect);
    };
  }, [selectedZone?.storeId, refreshCatalog]);

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
    const timer = setTimeout(async () => {
      try {
        // fresh: the open/closed flip has no DB write, so the cache may hold the
        // pre-boundary settings; this must reach the server.
        const srRes = await storeApi.getSettings(activeStoreId, { fresh: true }, selectedZone?.id);
        setSettings(srRes.data.data || DEFAULT_SETTINGS);
        catalogStampRef.current = null; // stamp is pre-boundary; re-adopt on next poll
      } catch {}
    }, delay);
    return () => clearTimeout(timer);
  }, [openState?.isOpen, openState?.nextOpenAt, activeStoreId]);

  // Homepage sections, in the admin's order. A section with no matching products
  // is dropped (rather than shown empty). If nothing resolves — no config, or a
  // config that points at empty categories — the caller falls back to the
  // built-in category-grouped layout so the home page is never blank.
  const resolvedHomeSections = [...homeSections]
    .filter(s => s.isEnabled)
    .sort((a, b) => {
      const aRef = a.kind === 'referral_banner';
      const bRef = b.kind === 'referral_banner';
      const aTiles = a.kind === 'category_tiles';
      const bTiles = b.kind === 'category_tiles';
      if (aRef && bTiles) return -1;
      if (bRef && aTiles) return 1;
      return a.sortOrder - b.sortOrder;
    })
    .map(section => ({ section, items: resolveSectionItems(section, products, categories) }))
    .filter(entry => entry.items.length > 0);

  // Fresh page config (a `fresh` Home Section row). It never renders as a home
  // shelf; it only drives the middle nav button. Fall back to Vegetables when
  // the head store has not configured one.
  const freshSection = homeSections.find(
    section => section.isEnabled && (section.kind === 'fresh' || section.sectionKey === 'fresh')
  );
  const freshCategorySlugs = freshSection?.config?.categorySlugs?.length
    ? freshSection.config.categorySlugs
    : ['vegetables'];

  // Account tab — show login modal if not logged in, but still navigate
  const handleNavChange = (v: View) => {
    setCatalogSearchOpen(false);
    setView(v);
    // Give each tab its own history entry so a sub-page opened from it (feedback,
    // grievance, privacy, terms, delete account) returns here on back instead of
    // falling through to Home, since the tab itself created no entry.
    const nextPath = VIEW_PATH[v];
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (currentPath !== nextPath) window.history.pushState({}, '', nextPath);
  };

  const handleWelcomeGetStarted = () => {
    try { localStorage.setItem(WELCOME_SEEN_KEY, 'true'); } catch {}
    setView('login');
    window.history.pushState({}, '', '/login');
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
    flow.setPendingCouponApply(Boolean(campaign?.id), campaign?.id ?? null);
    flow.setPostLoginPath('/checkout');
    // Declining login must come back here too, basket intact, not to Home.
    flow.setGuestReturnPath('/checkout');
    setPendingCheckout(false);
    setCheckoutActive(false);
    setCatalogSearchOpen(false);
    setShowLoginModal(false);
    useAccountLoginStore.getState().openLogin();
    window.history.pushState({}, '', '/account');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleCheckout = async () => {
    setPreCheckoutView(view);
    setCheckoutActive(true);
  };

  // Closing checkout returns to the view it covered. When checkout was opened on
  // top of the product search sheet, that sheet stays mounted underneath, so the
  // shopper lands right back on their results.
  const handleCheckoutClose = () => {
    setCheckoutActive(false);
    setView(preCheckoutView);
  };

  // Persist the tracking token in an effect, never during render: the success
  // screen render body must stay side-effect free or StrictMode double-invokes
  // it and a throw there blanks the whole app.
  useEffect(() => {
    const token = successData?.trackingToken;
    if (!token || isLoggedIn) return;
    saveTrackingToken(token);
    // If this guest already granted notification permission (e.g. a previous
    // order), register the new tracking token so the device keeps receiving
    // order pushes. subscribeToPush reads the tokens itself; it is a no-op when
    // permission is not granted or the device is signed in.
    if (getNotificationPermission() === 'granted') {
      subscribeToPush().catch(() => {});
    }
  }, [successData?.trackingToken, isLoggedIn]);

  useEffect(() => {
    if (!successData) return;
    window.dispatchEvent(new Event('gokez:first-order-completed'));
  }, [successData]);

  useEffect(() => {
    // Offer order updates after a successful order, to guests as well as
    // members. Only ask when permission is still undecided:
    //   • 'default'                    → ask
    //   • 'granted' (toggle already on) → never prompt; the effect above silently
    //     re-registers the new order token for this device
    //   • 'denied' or unsupported       → never (can't be undone in-app; a
    //     dead-end popup is worse than none)
    // No cooling period on the first show; "Not now" is what starts it.
    if (!successData) return;
    if (!isPushSupported()) return;
    if (!installGuide.platform) return; // order notifications are mobile-only
    if (getNotificationPermission() !== 'default') return;
    if (!isPermissionPromptDue(ORDER_NOTIFICATION_PROMPT_KEY)) return;
    if (installPromptOpen) return;

    setPermissionPrompt('order-notifications');
    setOrderNotificationError('');
  }, [isLoggedIn, successData, installPromptOpen]);

  useEffect(() => {
    if (!locationNotice) return;
    const t = setTimeout(() => setLocationNotice(null), 4000);
    return () => clearTimeout(t);
  }, [locationNotice]);

  useEffect(() => {
    if (!refreshNotice) return;
    const t = setTimeout(() => setRefreshNotice(null), 4000);
    return () => clearTimeout(t);
  }, [refreshNotice]);

  const dismissPermissionPrompt = () => {
    if (permissionPrompt === 'order-notifications') {
      recordPermissionPrompt(ORDER_NOTIFICATION_PROMPT_KEY);
    }
    setPermissionPrompt(null);
    setOrderNotificationError('');
  };

  const enableOrderNotifications = async () => {
    setEnablingOrderNotifications(true);
    setOrderNotificationError('');
    try {
      // Permission already granted (e.g. re-enabling after a fresh install):
      // skip the native prompt, which would resolve instantly anyway, and go
      // straight to subscribing this device.
      if (getNotificationPermission() !== 'granted') {
        if (!isPushSupported()) {
          // The browser exposes Notification but not PushManager, or the PWA
          // worker is unavailable. Nothing can be enabled here, so stop before
          // the native prompt and record the "not now" cooldown.
          dismissPermissionPrompt();
          return;
        }
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') {
          if (permission === 'denied') dismissPermissionPrompt();
          else setOrderNotificationError('Notifications were not enabled. You can try again any time.');
          return;
        }
      }
      if (await subscribeToPush()) {
        dismissPermissionPrompt();
      } else {
        setOrderNotificationError('We could not turn on order updates on this device. Check your connection and try again.');
      }
    } catch {
      // A hung/blocked worker or permission prompt must never leave the card
      // spinning forever; surface a retryable error instead.
      setOrderNotificationError('Turning on order updates took too long. Please try again.');
    } finally {
      setEnablingOrderNotifications(false);
    }
  };

  // Triggered by a tap on the location/zone control. Requesting on a gesture
  // (instead of an automatic prompt on load) means the browser shows only one
  // prompt, and a decline never burns the one-shot native permission. The shared
  // zone store does the detection + apply; App just surfaces the outcome as a
  // toast, so the navbar and the Account page behave identically. A failed
  // lookup is never a block — the customer picks an area manually instead.
  const useMyLocation = async (): Promise<ZoneAction> => {
    setLocationNotice(null);
    const previousZoneId = useZoneStore.getState().selectedZone?.id;
    const result = await useZoneStore.getState().detectAndApply();
    switch (result.status) {
      case 'applied':
        if (previousZoneId !== result.zone.id && useCartStore.getState().items.length > 0) {
          useCartStore.getState().clearCart();
          setLocationNotice(`Delivery area changed to ${result.zone.name}. Your cart was cleared because products and prices can differ by area.`);
        } else {
          setLocationNotice(`Delivering to ${result.zone.name}`);
        }
        break;
      case 'kept':
        setLocationNotice(`Delivering to ${result.zone.name}`);
        break;
      case 'no_match':
        setLocationNotice('No delivery area at your location. Pick one below.');
        break;
      case 'denied':
        setLocationNotice('Location is off. Pick your delivery area below.');
        break;
      case 'unavailable':
        setLocationNotice('Couldn\'t get your location. Pick your delivery area below.');
        break;
      case 'error':
        setLocationNotice('Couldn\'t find your area. Pick your delivery area below.');
        break;
      case 'busy':
        break;
    }
    return result;
  };

  // Success screen
  if (successData) {
    const STEPS = ['pending', 'preparing', 'out_for_delivery', 'delivered'];
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

          {permissionPrompt === 'order-notifications' && !installPromptOpen && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-800 dark:bg-blue-900/20">
              <div className="flex flex-col items-center">
                <BellRing className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <h3 className="mt-2 text-sm font-bold text-gray-900 dark:text-white">Keep track of this order</h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-gray-600 dark:text-slate-300">Allow order updates for preparation and delivery. Promotional messages stay off.</p>
                {orderNotificationError && <p className="mt-2 max-w-sm text-xs font-medium text-red-600 dark:text-red-400">{orderNotificationError}</p>}
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button onClick={enableOrderNotifications} disabled={enablingOrderNotifications} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{enablingOrderNotifications ? 'Turning on...' : 'Enable'}</button>
                  <button onClick={dismissPermissionPrompt} disabled={enablingOrderNotifications} className="rounded-xl px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-blue-900/40">Not now</button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-md border border-emerald-100 dark:border-emerald-900">
            <div className="bg-emerald-500 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-sm">{STATUS_LABELS[successData.status || 'pending']}</p>
                <p className="text-emerald-100 text-xs mt-0.5">
                  {successData.preference === 'within_15' ? '⚡ Expected in 10-15 mins'
                    : successData.preference === 'within_30' ? '🕐 Expected in ~30 mins'
                    : successData.preference === 'within_60' ? '🕑 Expected in ~1 hour'
                    : successData.scheduledLabel ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />Scheduled · {successData.scheduledLabel}</span>
                    : <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />Scheduled delivery</span>}
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
                    }`}>{ORDER_PROGRESS_LABELS[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {(successData.items || []).map((item: any, i: number) => (
                  <div key={i} className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 dark:bg-slate-700 flex-shrink-0">
                    <SmartImage
                      src={item.smallUrl || item.thumbnailUrl || item.photoUrl}
                      alt={item.productName}
                      className="h-full w-full"
                      imgClassName="object-cover"
                      fallback={<div className="w-full h-full flex items-center justify-center text-xl">🥦</div>}
                    />
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
          {!isLoggedIn && !signInPromptDismissed && (
            <div className="pt-2">
              <div className="rounded-2xl p-3 text-center">
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
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
                    className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Sign in
                  </button>
                  <span className="text-gray-300 dark:text-slate-600">·</span>
                  <button
                    onClick={() => {
                      sessionStorage.setItem('guest_signin_dismissed', '1');
                      setSignInPromptDismissed(true);
                    }}
                    className="text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}

          {installPromptOpen && (
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => { if (installGuide.platform) trackInstall('install_prompt_declined', installGuide.platform); dismissInstallGuide(); setInstallCardHidden(true); }}>
              <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-800" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Add Gokez Mart to your home screen</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-slate-400">Install for one-tap ordering and live order updates.</p>
                  </div>
                  <button type="button" onClick={() => { dismissInstallGuide(); setInstallCardHidden(true); if (installGuide.platform) trackInstall('install_prompt_declined', installGuide.platform); }} aria-label="Dismiss" className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-24 w-[62px] flex-shrink-0 overflow-hidden rounded-lg border border-cream-200 bg-cream-50 dark:border-slate-700 dark:bg-slate-900">
                    <img src={installGuide.guideSrc} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
                  </div>
                  <button
                    type="button"
                    onClick={() => { if (installGuide.platform) { trackInstall('install_prompt_accepted', installGuide.platform); trackInstall('install_guide_opened', installGuide.platform); } setInstallGuideOpen(true); }}
                    className="flex-1 rounded-xl bg-gokez-700 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-gokez-800"
                  >
                    View install steps
                  </button>
                </div>
              </div>
            </div>
          )}

          {installGuideOpen && installGuide.platform && (
            <div className="sheet-enter fixed inset-0 z-[90] flex flex-col bg-slate-900/95 backdrop-blur-sm">
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-[max(2.5rem,env(safe-area-inset-top))]">
                <div className="mx-auto mb-4 max-w-md rounded-2xl bg-white/95 px-4 py-3 dark:bg-slate-800/95">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Add a Gokez Mart shortcut</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                    This puts a Gokez Mart icon on your home screen so you can open and order in one tap. It is the same site you are using now — nothing is downloaded, and no extra permission is asked.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                    You can remove it anytime, just like any other app icon.
                  </p>
                </div>
                <img
                  src={installGuide.guideSrc}
                  alt={`How to add Gokez Mart to your home screen${installGuide.platform ? ` on ${installGuide.platform === 'ios' ? 'iPhone' : 'Android'}` : ''}`}
                  className="mx-auto h-auto w-full max-w-md rounded-2xl"
                />
              </div>
              <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => { setInstallGuideOpen(false); if (installGuide.platform) trackInstall('install_guide_dismissed', installGuide.platform); dismissInstallGuide(); setInstallCardHidden(true); }}
                  className="w-full rounded-xl bg-gokez-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gokez-800"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      className={welcomeActive ? 'welcome-active bg-[#e5fde5]' : loginPageActive ? 'login-active bg-[#e5fde5]' : view === 'deals' ? 'bg-[#f0fdf4]' : 'bg-white'}
      scrollRef={scrollRef}
      onTouchStart={handlePullTouchStart}
      onTouchMove={handlePullTouchMove}
      onTouchEnd={finishPullGesture}
      onTouchCancel={cancelPullGesture}
      overlay={
        <>
      <div className="app-tint-top" aria-hidden="true" />
      {showLoginModal && <LoginModal pendingCheckout={pendingCheckout} onNavigateLegal={(path) => {
        // Reading Terms/Privacy leaves the login behind: close the overlay so the
        // page is not hidden under it, but keep the in-progress OTP flow so
        // returning to Account restores where they were.
        setShowLoginModal(false);
        setPendingCheckout(false);
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }} onGuest={handleLoginModalGuest} onClose={() => {
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
          setPendingCategorySlug(null);
        }
      }} />}

      {/* Location / refresh feedback toast — pinned above the bottom nav so it
          never hides under the mobile status bar / notch. */}
      {(locationNotice || refreshNotice) && (
        <div className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[70] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-center text-xs font-semibold text-white shadow-xl dark:bg-slate-700">
          {locationNotice || refreshNotice}
        </div>
      )}

      {/* In-place refresh spinner. Absolutely positioned so the gesture never
          shifts the page or the navbar — it just rotates where it is. */}
      {!welcomeActive && (refreshing || pullDistanceVisible > 0) && (
        <div
          className="pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
            opacity: refreshing ? 1 : Math.min(1, pullDistanceVisible / 40),
          }}
          aria-live="polite"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-md ring-1 ring-black/5 backdrop-blur dark:bg-slate-800/90 dark:ring-white/10">
            <RefreshCw
              className={`h-4 w-4 text-emerald-600 dark:text-emerald-300 ${refreshing || pullDistanceVisible >= PULL_REFRESH_THRESHOLD ? 'animate-spin' : ''}`}
              style={refreshing || pullDistanceVisible >= PULL_REFRESH_THRESHOLD ? undefined : { transform: `rotate(${pullDistanceVisible * 4}deg)` }}
              aria-hidden="true"
            />
          </div>
        </div>
      )}
        </>
      }
      /* Fixed header band — AppShell renders this ABOVE the scroller, so it
         never scrolls away and page content pins beneath it at top-0. */
      header={
        <>
      {!isEmbed && !accountSubPage && !welcomeActive && !(view === 'login' || (view === 'account' && accountLoginOpen)) && (
        <Navbar
          onUseMyLocation={useMyLocation}
          activeView={(view === 'fresh' ? 'fresh' : view) as 'home' | 'categories' | 'orders' | 'account' | 'fresh'}
          onNavChange={handleNavChange}
          onCheckout={handleCheckout}
          onSearchOpen={() => openCatalogSearch()}
          searchPrompt={searchPrompt}
          deliveryHidden={chromeHidden}
          cartActive={checkoutActive}
        />
      )}

      {/* Closed-store notice: below the header, on every page, never blocking.
          The store's own greeting and message come from the hub's Hours tab;
          without them the notice falls back to the default wording. */}
      {!isEmbed && !accountSubPage && !welcomeActive && !(view === 'login' || (view === 'account' && accountLoginOpen)) && (
        <StoreStatusStrip
          openState={openState}
          closedGreeting={settings.store_closed_greeting}
          closedMessage={settings.store_closed_message}
        />
      )}
        </>
      }
      floatingCart={<FloatingCart onOpen={handleCheckout} hidden={checkoutActive || !productPage || welcomeActive} />}
      bottomNavHidden={navHidden}
      bottomNav={!checkoutActive && view !== 'login' && !welcomeActive ? (
        <div className="sm:hidden">
          <BottomNav active={(view === 'fresh' ? 'fresh' : view) as 'home' | 'categories' | 'orders' | 'account' | 'fresh'} onChange={handleNavChange} onOpenSearch={openFreshPage} freshActive={view === 'fresh'} />
        </div>
      ) : null}
    >

      {/* One dialog for both checkout mounts. Resolved explicitly in both
          directions so CheckoutPage is never left awaiting a dead promise.

          Portalled to <body> on purpose: .app-shell is position:fixed, which
          makes it a stacking context, so a dialog left inside it would be
          trapped below the checkout overlay (which is also portalled to <body>,
          at z-[55]). At the document level this dialog's z-[60] sits above it,
          which is what lets the customer confirm a closed-store order. */}
      {closedPrompt && createPortal(
        <StoreClosedCard
          open
          greeting={settings.store_closed_greeting}
          message={settings.store_closed_message}
          resumeLabel={storeResumeLabel}
          primaryLabel="Place order"
          // The cross backs out of the order, the button goes ahead with it.
          onClose={() => settlePrompt(false)}
          onConfirm={() => { settlePrompt(true); }}
        />,
        document.body,
      )}

      {/* The same card, on its own, the first time the customer arrives at a
          closed store. It has nothing pending, so either button just closes
          it and the banner carries the message from then on. */}
      {closedCard && !closedPrompt && createPortal(
        <StoreClosedCard
          open
          greeting={settings.store_closed_greeting}
          message={settings.store_closed_message}
          resumeLabel={storeResumeLabel}
          primaryLabel="Got it"
          onClose={() => { setClosedCard(false); }}
          onConfirm={() => { setClosedCard(false); }}
        />,
        document.body,
      )}

      {/* Checkout — overlay on both mobile and desktop (above the search sheet so
          the search results stay mounted underneath and return on back).
          Rendered through a portal to <body>: a fixed overlay anchored at the
          document level is sized to the viewport, so the checkout footer stays
          pinned to the screen bottom instead of being sized to an ancestor
          scroll container. */}
      {checkoutActive && createPortal(
        <div className="app-viewport-overlay fixed inset-0 z-[55] overscroll-y-none">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm sm:block hidden"
            onClick={handleCheckoutClose} />
          {/* Mobile — full screen slide up. `isolate` makes this scroller its own
              stacking context: iOS WebKit fails to repaint a position:sticky
              child of an overflow scroller that also has positioned siblings
              (the "To pay" footer behind the cart list), and isolating the
              scroll container is the documented fix. */}
          <div ref={mobileCheckoutScrollRef} className="sm:hidden isolate absolute inset-0 overflow-y-auto overscroll-y-contain bg-white dark:bg-slate-900">
            <CheckoutPage
              settings={settings}
              zoneId={selectedZone?.id}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              onBack={handleCheckoutClose}
              onHome={() => { setCatalogSearchOpen(false); setCheckoutActive(false); setView('home'); }}
              onLogin={(campaign?: any) => handleCheckoutLogin(campaign)}
              confirmOrder={confirmOrder}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number, orderData?: any) => { setCatalogSearchOpen(false); setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount, trackingToken: orderData?.trackingToken, items: orderData?.items, total: orderData?.total, guestAddress: orderData?.guestAddress, guestName: orderData?.guestName, guestPhone: orderData?.guestPhone, createdAt: orderData?.createdAt, status: orderData?.status, scheduledLabel: orderData?.scheduledLabel }); }}
            />
          </div>
          {/* Desktop — right side drawer (same `isolate` reasoning as the mobile
              scroller above). */}
          <div ref={desktopCheckoutScrollRef} className="hidden sm:block isolate absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto overscroll-y-contain bg-white shadow-2xl dark:bg-slate-900">
            <CheckoutPage
              settings={settings}
              zoneId={selectedZone?.id}
              zoneName={selectedZone?.name}
              storeId={selectedZone?.storeId}
              onBack={handleCheckoutClose}
              onHome={() => { setCatalogSearchOpen(false); setCheckoutActive(false); setView('home'); }}
              onLogin={(campaign?: any) => handleCheckoutLogin(campaign)}
              confirmOrder={confirmOrder}
              onSuccess={(num: string, preference: string, storeName?: string, savedAmount?: number, orderData?: any) => { setCatalogSearchOpen(false); setCheckoutActive(false); setSuccessData({ num, preference, storeName, savedAmount, trackingToken: orderData?.trackingToken, items: orderData?.items, total: orderData?.total, guestAddress: orderData?.guestAddress, guestName: orderData?.guestName, guestPhone: orderData?.guestPhone, createdAt: orderData?.createdAt, status: orderData?.status, scheduledLabel: orderData?.scheduledLabel }); }}
            />
          </div>
        </div>,
        document.body,
      )}

      {comboSheet && (
        <ComboSheet
          title={comboSheet.title}
          products={comboSheet.products}
          onClose={() => setComboSheet(null)}
          onOpenCart={() => handleCheckout()}
        />
      )}

      {dealsSheet && (
        <DealsSheet
          title={dealsSheet.title}
          products={dealsSheet.products}
          onClose={() => setDealsSheet(null)}
          onOpenCart={() => handleCheckout()}
        />
      )}

      {catalogSearchOpen && (
        <CatalogSearchSheet
          categories={categories}
          products={products}
          searchPrompt={searchPrompt}
          autoFocus={catalogSearchAutoFocus}
          mode={catalogSearchMode}
          freshCategorySlugs={freshCategorySlugs}
          freshColumns={freshSection?.config?.columns ?? 3}
          freshLimit={freshSection?.config?.limit ?? null}
          freshLayout={freshSection?.layout === 'row' ? 'row' : 'grid'}
          onClose={() => setCatalogSearchOpen(false)}
          onOpenCart={() => handleCheckout()}
          onRefresh={() => refreshCatalog(activeStoreId, selectedZone?.id, { force: true })}
          activeView={(view === 'fresh' ? 'home' : view) as 'home' | 'categories' | 'orders' | 'account'}
          onNavigate={(v) => { setCatalogSearchOpen(false); handleNavChange(v); }}
        />
      )}

      {/* Pages */}
      {view === 'welcome' ? (
        <div className="absolute inset-0 touch-none overflow-hidden bg-[#018330]">
          <img
            src="/get_started.webp"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full select-none object-fill"
            draggable={false}
          />
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <button
              type="button"
              onClick={handleWelcomeGetStarted}
              className="min-h-[52px] w-full max-w-sm rounded-2xl bg-white px-6 py-3 text-base font-extrabold text-gokez-800 shadow-lg ring-1 ring-black/5 transition-colors hover:bg-white/95 active:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              Get Started
            </button>
          </div>
        </div>
      ) : view === 'about' ? (
        <DeferredPage><AboutPage /></DeferredPage>
      ) : view === 'what-is-gokez-mart' ? (
        <DeferredPage><WhatIsGokezMartPage /></DeferredPage>
      ) : view === 'categories' ? (
        // h-full, not productPageBottom: the split pane must fill the
        // scroller EXACTLY (the header band and bottom nav are flex siblings
        // of the scroller, already reserving their own space). Any bottom
        // padding here would make the content taller than the scrollport and
        // re-introduce the outer "second scroll" the pane is meant to replace.
        <div className="h-full">
          <CategoriesView categories={categories} products={products} initialCategorySlug={pendingCategorySlug} loading={loading} onEmpty={() => setView('home')} paneScrollRef={setCategoriesPaneEl} />
        </div>
      ) : view === 'fresh' ? (
        <div className={productPageBottom}>
          <CatalogSearchSheet
            inline
            categories={categories}
            products={products}
            searchPrompt={searchPrompt}
            autoFocus={false}
            mode="fresh"
            freshCategorySlugs={freshCategorySlugs}
            freshColumns={freshSection?.config?.columns ?? 3}
            freshLimit={freshSection?.config?.limit ?? null}
            freshLayout={freshSection?.layout === 'row' ? 'row' : 'grid'}
            onClose={() => setView('home')}
            onOpenCart={() => handleCheckout()}
            onRefresh={() => refreshCatalog(activeStoreId, selectedZone?.id, { force: true })}
            activeView={(view === 'fresh' ? 'home' : view) as 'home' | 'categories' | 'orders' | 'account'}
            onNavigate={(v) => { setView(v); }}
          />
        </div>
      ) : view === 'deals' ? (
        <div className={PAGE_BOTTOM}>
          <DealsPage products={products} onBack={() => setView('home')} />
        </div>
      ) : view === 'grievance' ? (
        <DeferredPage><GrievancePage /></DeferredPage>
      ) : view === 'feedback' ? (
        <DeferredPage><FeedbackPage storeId={selectedZone?.storeId} /></DeferredPage>
      ) : view === 'delete-account' ? (
        <DeferredPage><DeleteAccountPage /></DeferredPage>
      ) : view === 'privacy' ? (
        <DeferredPage><PrivacyPage embed={isEmbed} /></DeferredPage>
      ) : view === 'terms' ? (
        <DeferredPage><TermsPage embed={isEmbed} /></DeferredPage>
      ) : view === 'orders' ? (
        <div className={productPageBottom}>
          <DeferredPage><OrderHistoryPage onBack={() => setView('home')} whatsappNumber={settings.whatsapp_number} nextOpenLabel={openState?.nextOpenLabel ?? null} /></DeferredPage>
        </div>
      ) : view === 'referral' ? (
        <DeferredPage><ReferralPage /></DeferredPage>
      ) : view === 'account' || view === 'login' ? (
        <DeferredPage><AccountPage
          storeName={settings.store_name}
          storeAddress={settings.store_address}
          supportName={settings.support_name}
          supportPhone={settings.support_phone}
          whatsappNumber={settings.whatsapp_number}
        /></DeferredPage>
      ) : (
        /* Home */
        <main className={`max-w-6xl mx-auto page-x ${productPageBottom}`}>

          {carouselPosition === 'top' && (
            <>
              <button type="button" onClick={() => openCatalogSearch()}
                className="relative mt-4 mb-4 hidden w-full items-center text-left sm:flex">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-gray-900 dark:text-slate-200" />
                <span className="w-full overflow-hidden whitespace-nowrap rounded-2xl bg-gray-100 py-3.5 pl-11 pr-4 text-base text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text max-w-full truncate">{searchPrompt}</span></span>
              </button>
              <HomeCarousel className="pb-6" />
            </>
          )}

          {/* Referral banners (above Shop by categories) */}
          {homeSections.filter(s => s.isEnabled && s.kind === 'referral_banner').map(s => (
            <div key={s.id} className="mt-4 mb-4">
              <ReferralBanner section={s} />
            </div>
          ))}

          {/* Shop by categories */}
          {(() => {
            const visibleCategories = categories.filter(cat => products.some(product => product.categoryId === cat.id));
            if (visibleCategories.length === 0) return null;
            return (
              <section className="mt-4 mb-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">Shop by categories</h2>
                  <button type="button" onClick={() => {
                    setPendingCategorySlug(null);
                    handleNavChange('categories');
                  }} className="rounded-full border border-gokez-200 bg-white px-3 py-1.5 text-xs font-bold text-gokez-800 transition-colors hover:border-gokez-300 hover:bg-gokez-50 dark:border-gokez-800 dark:bg-slate-800 dark:text-white dark:hover:bg-gokez-900/30">
                    See all
                  </button>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
                  {visibleCategories.map(cat => {
                    const imageUrl = cat.icon?.startsWith('/') || cat.icon?.startsWith('http') ? cat.icon : null;
                    return (
                      <button key={cat.id} type="button" onClick={() => {
                        setPendingCategorySlug(cat.slug || null);
                        handleNavChange('categories');
                      }}
                        className="flex w-[84px] min-w-[84px] flex-col items-center gap-2 text-center">
                        <span className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-2xl bg-cream-100 ring-1 ring-black/5 dark:bg-slate-700 dark:ring-white/10">
                          {imageUrl
                            ? <img src={imageUrl} alt={cat.name} loading="lazy" className="h-full w-full object-contain" />
                            : <span className="text-4xl leading-none" aria-hidden="true">{cat.icon || '🛒'}</span>}
                        </span>
                        <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-gray-800 dark:text-slate-200">{cat.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* Products */}
          {loading || catalogError ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
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
          ) : resolvedHomeSections.length > 0 ? (
            /* Home — admin-configured sections (Today's Combos, Deals, Top Picks, ...) */
            <>
              <HomeSections
                entries={resolvedHomeSections}
                categories={categories}
                onSelectCategory={(slug) => {
                  setPendingCategorySlug(slug);
                  setView('categories');
                }}
                onViewAll={(section, sectionProducts) => {
                  const kind = section.kind || section.sectionKey;
                  if (kind === 'combo' || kind === 'todays_combos') {
                    setComboSheet({ title: typeof section.title === 'string' ? section.title.replace(/\b\w/g, (c: string) => c.toUpperCase()) : section.title, subtitle: typeof section.subtitle === 'string' ? section.subtitle.replace(/\b\w/g, (c: string) => c.toUpperCase()) : (section.subtitle || undefined), products: sectionProducts });
                    return;
                  }
                  if (kind === 'deals') {
                    setDealsSheet({ title: typeof section.title === 'string' ? section.title.replace(/\b\w/g, (c: string) => c.toUpperCase()) : (section.title || "Today's Deals"), products: sectionProducts });
                    return;
                  }
                  if (kind === 'category' || kind === 'fresh_vegetables' || kind === 'multiCategory' || kind === 'multi_category') {
                    const cfg = section.config || {};
                    const slugs = Array.isArray((cfg as any).categorySlugs) ? (cfg as any).categorySlugs : ((cfg as any).categorySlug ? [(cfg as any).categorySlug] : []);
                    if (slugs.length === 1) {
                      setPendingCategorySlug(String(slugs[0]));
                      setView('categories');
                      return;
                    }
                    if (slugs.length > 1) {
                      setView('categories');
                      return;
                    }
                    setView('categories');
                    return;
                  }
                  if (kind === 'top_picks' || kind === 'manual') {
                    setView('categories');
                    setPendingCategorySlug(null);
                    return;
                  }
                  setView('categories');
                }}
              />
            </>
          ) : (
            /* Fallback — built-in category-grouped layout when no sections resolve */
            <div className="space-y-6">
              {categories.map(cat => {
                const catProducts = products.filter(p => p.categoryId === cat.id);
                if (catProducts.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-base font-bold text-gray-900 dark:text-white">{cat.name}</h2>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
                      {catProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Uncategorised */}
              {(() => {
                const uncat = products.filter(p => !p.categoryId);
                if (uncat.length === 0) return null;
                return (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-bold text-gray-900 dark:text-white">📦 Others</h2>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2.5">
                      {uncat.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {carouselPosition === 'bottom' && (
            <HomeCarousel className="pb-2" />
          )}

          {/* Footer */}
          <footer className="mt-8 border-t-2 border-emerald-200 bg-white/80 pb-5 pt-6 dark:border-emerald-900/60 dark:bg-slate-900/70">
            <div className="mx-auto max-w-xl sm:max-w-4xl">
              <div className="mb-3 flex items-center justify-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                <button type="button" onClick={() => { setView('privacy'); window.history.pushState({}, '', '/privacy'); }} className="hover:text-emerald-600 dark:hover:text-emerald-400">Privacy Policy</button>
                <span aria-hidden="true">&middot;</span>
                <button type="button" onClick={() => { setView('terms'); window.history.pushState({}, '', '/terms'); }} className="hover:text-emerald-600 dark:hover:text-emerald-400">Terms of Service</button>
              </div>
              <p className="text-center text-[11px] text-gray-500 dark:text-slate-400">
                &copy; {new Date().getFullYear()} {BRAND_NAME}{' · '}A product of{' '}
                <a href={PARENT_COMPANY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 hover:underline">
                  {PARENT_COMPANY}
                </a>
              </p>
            </div>
          </footer>
        </main>
      )}
    </AppShell>
  );
}
