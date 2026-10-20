import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useAppUpdate } from './hooks/useAppUpdate';
import { subscribeAdminToPush } from './services/push';
import { startOrderStream, stopOrderStream } from './services/realtime';
import Layout from './components/Layout';
import PageSkeleton from './components/PageSkeleton';
import InstallPrompt from './components/InstallPrompt';
import NetworkStatus from './components/NetworkStatus';
import { lazyWithRetry, isChunkLoadError, recoverFromChunkError } from './utils/lazyWithRetry';

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'));
const ProductsPage = lazyWithRetry(() => import('./pages/ProductsPage'));
const CategoriesPage = lazyWithRetry(() => import('./pages/CategoriesPage'));
const OrdersPage = lazyWithRetry(() => import('./pages/OrdersPage'));
const CustomersPage = lazyWithRetry(() => import('./pages/CustomersPage'));
const CustomerLeadsPage = lazyWithRetry(() => import('./pages/CustomerLeadsPage'));
const SuggestionsPage = lazyWithRetry(() => import('./pages/SuggestionsPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));
const AnalyticsPage = lazyWithRetry(() => import('./pages/AnalyticsPage'));
const InstallAnalyticsPage = lazyWithRetry(() => import('./pages/InstallAnalyticsPage'));

const ProfilePage = lazyWithRetry(() => import('./pages/ProfilePage'));
const ChangePasswordPage = lazyWithRetry(() => import('./pages/ChangePasswordPage'));
const StoresPage = lazyWithRetry(() => import('./pages/StoresPage'));
const SubscriptionsPage = lazyWithRetry(() => import('./pages/SubscriptionsPage'));
const UsersPage = lazyWithRetry(() => import('./pages/UsersPage'));
const CompliancePage = lazyWithRetry(() => import('./pages/CompliancePage'));
const MorePage = lazyWithRetry(() => import('./pages/MorePage'));
const ApplyPage = lazyWithRetry(() => import('./pages/ApplyPage'));
const MerchantTermsPage = lazyWithRetry(() => import('./pages/MerchantTermsPage'));
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage'));
const StoreApplicationsPage = lazyWithRetry(() => import('./pages/StoreApplicationsPage'));
const CatalogPage = lazyWithRetry(() => import('./pages/CatalogPage'));
const TeamPage = lazyWithRetry(() => import('./pages/TeamPage'));
const DeliveryPage = lazyWithRetry(() => import('./pages/DeliveryPage'));
const InventoryPage = lazyWithRetry(() => import('./pages/InventoryPage'));
const FeedbackPage = lazyWithRetry(() => import('./pages/FeedbackPage'));
const CampaignsPage = lazyWithRetry(() => import('./pages/CampaignsPage'));
const CarouselPage = lazyWithRetry(() => import('./pages/CarouselPage'));
const HomeSectionsPage = lazyWithRetry(() => import('./pages/HomeSectionsPage'));

// Fallback for the public routes (no app shell yet): same page-shaped
// skeleton as the rest of the hub, so nothing flashes a bare dark screen.
function RouteLoading() {
  return (
    <div className="min-h-screen bg-white p-4 sm:p-6 lg:p-8 dark:bg-slate-900">
      <PageSkeleton />
    </div>
  );
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; recovering: boolean }> {
  state = { hasError: false, recovering: false };

  static getDerivedStateFromError(error: Error) {
    // Stale-chunk errors after a deploy are not real failures; flag them so the
    // boundary stays blank while it reloads instead of flashing a CTA.
    return { hasError: true, recovering: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.state.recovering && recoverFromChunkError()) return;
    if (this.state.recovering) this.setState({ recovering: false });
    console.error('Hub route failed to load', error, info);
  }

  render() {
    if (this.state.recovering) return null;
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center dark:bg-slate-900">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Something went wrong.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Reload app</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Roles mirror mart_admins_role_check in migration 056. store_manager is a real
// role; it used to be listed here while the database still rejected it, which
// made every one of these entries unreachable.
const ROLE_ROUTES: Record<string, string[]> = {
  super_admin:     ['/', '/orders', '/products', '/inventory', '/categories', '/customers', '/customer-leads', '/suggestions', '/analytics', '/install-analytics', '/settings', '/stores', '/subscriptions', '/store-applications', '/catalog', '/team', '/users', '/compliance', '/feedback', '/campaigns', '/carousel', '/home-sections', '/profile', '/change-password', '/more'],
  store_owner:     ['/', '/orders', '/products', '/inventory', '/categories', '/analytics', '/settings', '/catalog', '/team', '/feedback', '/campaigns', '/home-sections', '/profile', '/change-password', '/more'],
  store_manager:   ['/', '/orders', '/products', '/inventory', '/analytics', '/settings', '/catalog', '/feedback', '/profile', '/change-password', '/more'],
  delivery_staff:  ['/', '/orders', '/delivery', '/profile', '/change-password', '/more'],
  staff:           ['/', '/orders', '/products', '/inventory', '/delivery', '/profile', '/change-password', '/more'],
};

function ProtectedRoute({ children, path }: { children: React.ReactNode; path: string }) {
  const { isAuthenticated, role } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/hub" replace />;
  // Fail closed: a missing or unrecognised role is granted nothing. It is never
  // promoted to super_admin (the previous `role || 'super_admin'`) and never
  // silently downgraded to the staff allowlist (the previous `|| ROLE_ROUTES.staff`).
  // Redirects to /hub, which is public, so a denied user cannot loop on a
  // protected route. The backend remains the authoritative check regardless.
  const allowed = role ? ROLE_ROUTES[role] : undefined;
  if (!allowed || !allowed.includes(path)) return <Navigate to="/hub" replace />;
  // The Suspense boundary sits INSIDE Layout on purpose. When a page is still
  // a lazily-fetched chunk, only the content area falls back: the header,
  // sidebar and bottom nav stay mounted, so switching pages never blanks the
  // whole screen into the full-page fallback before the content appears.
  return <Layout><Suspense fallback={<PageSkeleton />}>{children}</Suspense></Layout>;
}

export default function App() {
  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  // Re-subscribe to push only when authenticated and permission already granted
  useEffect(() => {
    if (isAuthenticated && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      subscribeAdminToPush().catch(() => {});
    }
  }, [isAuthenticated]);

  // Live order stream: gives open hub tabs instant order/status events
  // regardless of web-push delivery (which lags on weak networks).
  useEffect(() => {
    if (isAuthenticated) startOrderStream();
    else stopOrderStream();
    return () => stopOrderStream();
  }, [isAuthenticated]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const themeColor = isDark ? '#18191a' : '#0f172a';
    // Update both theme-color meta tags to match the active app shell.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta: Element) => {
      const m = meta as HTMLMetaElement;
      m.content = themeColor;
    });
    // Fallback for single meta tag
    const single = document.querySelector('meta[name="theme-color"]:not([media])');
    if (single) (single as HTMLMetaElement).content = themeColor;
  }, [isDark]);

  return (
    <BrowserRouter>
      <NetworkStatus>
        <InstallPrompt />
        <RouteErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/"                element={<ProtectedRoute path="/"><DashboardPage /></ProtectedRoute>} />
        <Route path="/orders"          element={<ProtectedRoute path="/orders"><OrdersPage /></ProtectedRoute>} />
        <Route path="/products"        element={<ProtectedRoute path="/products"><ProductsPage /></ProtectedRoute>} />
        <Route path="/categories"      element={<ProtectedRoute path="/categories"><CategoriesPage /></ProtectedRoute>} />
        <Route path="/customers"       element={<ProtectedRoute path="/customers"><CustomersPage /></ProtectedRoute>} />
        <Route path="/customer-leads"   element={<ProtectedRoute path="/customer-leads"><CustomerLeadsPage /></ProtectedRoute>} />
        <Route path="/suggestions"      element={<ProtectedRoute path="/suggestions"><SuggestionsPage /></ProtectedRoute>} />
        <Route path="/analytics"       element={<ProtectedRoute path="/analytics"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/install-analytics" element={<ProtectedRoute path="/install-analytics"><InstallAnalyticsPage /></ProtectedRoute>} />
        <Route path="/settings"        element={<ProtectedRoute path="/settings"><SettingsPage /></ProtectedRoute>} />
        <Route path="/stores"          element={<ProtectedRoute path="/stores"><StoresPage /></ProtectedRoute>} />
        <Route path="/subscriptions"   element={<ProtectedRoute path="/subscriptions"><SubscriptionsPage /></ProtectedRoute>} />
        <Route path="/users"           element={<ProtectedRoute path="/users"><UsersPage /></ProtectedRoute>} />
        <Route path="/compliance"      element={<ProtectedRoute path="/compliance"><CompliancePage /></ProtectedRoute>} />
        <Route path="/profile"         element={<ProtectedRoute path="/profile"><ProfilePage /></ProtectedRoute>} />
        <Route path="/change-password" element={<ProtectedRoute path="/change-password"><ChangePasswordPage /></ProtectedRoute>} />
        <Route path="/more"             element={<ProtectedRoute path="/more"><MorePage /></ProtectedRoute>} />
        <Route path="/apply"            element={<ApplyPage />} />
        <Route path="/merchant-terms"   element={<MerchantTermsPage />} />
        <Route path="/hub"              element={<LandingPage />} />
        <Route path="/landing"          element={<LandingPage />} />
        <Route path="/store-applications" element={<ProtectedRoute path="/store-applications"><StoreApplicationsPage /></ProtectedRoute>} />
        <Route path="/catalog"            element={<ProtectedRoute path="/catalog"><CatalogPage /></ProtectedRoute>} />
        <Route path="/team"              element={<ProtectedRoute path="/team"><TeamPage /></ProtectedRoute>} />
        <Route path="/delivery"          element={<ProtectedRoute path="/delivery"><DeliveryPage /></ProtectedRoute>} />
        <Route path="/inventory"         element={<ProtectedRoute path="/inventory"><InventoryPage /></ProtectedRoute>} />
        <Route path="/feedback"          element={<ProtectedRoute path="/feedback"><FeedbackPage /></ProtectedRoute>} />
        <Route path="/campaigns"         element={<ProtectedRoute path="/campaigns"><CampaignsPage /></ProtectedRoute>} />
        <Route path="/carousel"          element={<ProtectedRoute path="/carousel"><CarouselPage /></ProtectedRoute>} />
        <Route path="/home-sections"     element={<ProtectedRoute path="/home-sections"><HomeSectionsPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </NetworkStatus>
    </BrowserRouter>
  );
}
