import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useAppUpdate } from './hooks/useAppUpdate';
import { subscribeAdminToPush } from './services/push';
import Layout from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const StoresPage = lazy(() => import('./pages/StoresPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const CompliancePage = lazy(() => import('./pages/CompliancePage'));
const MorePage = lazy(() => import('./pages/MorePage'));
const ApplyPage = lazy(() => import('./pages/ApplyPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const StoreApplicationsPage = lazy(() => import('./pages/StoreApplicationsPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const DeliveryPage = lazy(() => import('./pages/DeliveryPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'));
const CarouselPage = lazy(() => import('./pages/CarouselPage'));

const ROLE_ROUTES: Record<string, string[]> = {
  super_admin:     ['/', '/orders', '/products', '/inventory', '/categories', '/customers', '/analytics', '/settings', '/stores', '/store-applications', '/catalog', '/team', '/users', '/compliance', '/feedback', '/campaigns', '/carousel', '/profile', '/change-password', '/more'],
  store_owner:     ['/', '/orders', '/products', '/inventory', '/categories', '/customers', '/analytics', '/settings', '/catalog', '/team', '/feedback', '/campaigns', '/carousel', '/profile', '/change-password', '/more'],
  store_manager:   ['/', '/orders', '/products', '/inventory', '/customers', '/analytics', '/settings', '/catalog', '/feedback', '/profile', '/change-password', '/more'],
  sales_manager:   ['/', '/orders', '/products', '/inventory', '/customers', '/analytics', '/settings', '/catalog', '/feedback', '/profile', '/change-password', '/more'],
  delivery_staff:  ['/', '/orders', '/delivery', '/profile', '/change-password', '/more'],
  staff:           ['/', '/orders', '/products', '/inventory', '/delivery', '/profile', '/change-password', '/more'],
};

function ProtectedRoute({ children, path }: { children: React.ReactNode; path: string }) {
  const { isAuthenticated, role } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/hub" replace />;
  const userRole = role || 'super_admin';
  const allowed = ROLE_ROUTES[userRole] || ROLE_ROUTES.staff;
  if (!allowed.includes(path)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    // Update both theme-color meta tags
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta: Element) => {
      const m = meta as HTMLMetaElement;
      m.content = '#0f172a';
    });
    // Fallback for single meta tag
    const single = document.querySelector('meta[name="theme-color"]:not([media])');
    if (single) (single as HTMLMetaElement).content = '#0f172a';
  }, [isDark]);

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-white dark:bg-slate-900" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/"                element={<ProtectedRoute path="/"><DashboardPage /></ProtectedRoute>} />
        <Route path="/orders"          element={<ProtectedRoute path="/orders"><OrdersPage /></ProtectedRoute>} />
        <Route path="/products"        element={<ProtectedRoute path="/products"><ProductsPage /></ProtectedRoute>} />
        <Route path="/categories"      element={<ProtectedRoute path="/categories"><CategoriesPage /></ProtectedRoute>} />
        <Route path="/customers"       element={<ProtectedRoute path="/customers"><CustomersPage /></ProtectedRoute>} />
        <Route path="/analytics"       element={<ProtectedRoute path="/analytics"><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/settings"        element={<ProtectedRoute path="/settings"><SettingsPage /></ProtectedRoute>} />
        <Route path="/stores"          element={<ProtectedRoute path="/stores"><StoresPage /></ProtectedRoute>} />
        <Route path="/users"           element={<ProtectedRoute path="/users"><UsersPage /></ProtectedRoute>} />
        <Route path="/compliance"      element={<ProtectedRoute path="/compliance"><CompliancePage /></ProtectedRoute>} />
        <Route path="/profile"         element={<ProtectedRoute path="/profile"><ProfilePage /></ProtectedRoute>} />
        <Route path="/change-password" element={<ProtectedRoute path="/change-password"><ChangePasswordPage /></ProtectedRoute>} />
        <Route path="/more"             element={<ProtectedRoute path="/more"><MorePage /></ProtectedRoute>} />
        <Route path="/apply"            element={<ApplyPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
