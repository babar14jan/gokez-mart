import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useAppUpdate } from './hooks/useAppUpdate';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import CategoriesPage from './pages/CategoriesPage';
import OrdersPage from './pages/OrdersPage';
import CustomersPage from './pages/CustomersPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import ProfilePage from './pages/ProfilePage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import StoresPage from './pages/StoresPage';
import UsersPage from './pages/UsersPage';
import CompliancePage from './pages/CompliancePage';
import MorePage from './pages/MorePage';
import ApplyPage from './pages/ApplyPage';
import StoreApplicationsPage from './pages/StoreApplicationsPage';
import CatalogPage from './pages/CatalogPage';
import TeamPage from './pages/TeamPage';
import DeliveryPage from './pages/DeliveryPage';

const ROLE_ROUTES: Record<string, string[]> = {
  super_admin:     ['/', '/orders', '/products', '/categories', '/customers', '/analytics', '/settings', '/stores', '/store-applications', '/catalog', '/team', '/users', '/compliance', '/profile', '/change-password', '/more'],
  store_owner:     ['/', '/orders', '/products', '/customers', '/analytics', '/settings', '/catalog', '/team', '/profile', '/change-password', '/more'],
  store_manager:   ['/', '/orders', '/products', '/customers', '/analytics', '/settings', '/catalog', '/profile', '/change-password', '/more'],
  sales_manager:   ['/', '/orders', '/products', '/customers', '/catalog', '/profile', '/change-password', '/more'],
  delivery_staff:  ['/', '/orders', '/delivery', '/profile', '/change-password', '/more'],
  staff:           ['/', '/orders', '/delivery', '/profile', '/change-password', '/more'],
};

function ProtectedRoute({ children, path }: { children: React.ReactNode; path: string }) {
  const { isAuthenticated, role } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const userRole = role || 'super_admin';
  const allowed = ROLE_ROUTES[userRole] || ROLE_ROUTES.staff;
  if (!allowed.includes(path)) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  useAppUpdate();
  const isDark = useThemeStore(s => s.isDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#0f172a' : '#f9fafb');
  }, [isDark]);

  return (
    <BrowserRouter>
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
        <Route path="/store-applications" element={<ProtectedRoute path="/store-applications"><StoreApplicationsPage /></ProtectedRoute>} />
        <Route path="/catalog"            element={<ProtectedRoute path="/catalog"><CatalogPage /></ProtectedRoute>} />
        <Route path="/team"              element={<ProtectedRoute path="/team"><TeamPage /></ProtectedRoute>} />
        <Route path="/delivery"          element={<ProtectedRoute path="/delivery"><DeliveryPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
