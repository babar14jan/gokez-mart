import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Tag, ClipboardList,
  Users, Settings, Shield, QrCode,
  ChevronLeft, ChevronRight, Sparkles, BarChart3,
  Menu as MenuIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { storesApi, settingsApi } from '../services/api';
import { getActiveStoreId } from '../utils/store';

const NAV_ALL = [
  { label: 'Dashboard',  href: '/',            icon: LayoutDashboard, roles: ['super_admin', 'store_manager', 'sales_manager', 'delivery_staff', 'staff'] },
  { label: 'Orders',     href: '/orders',      icon: ClipboardList,   roles: ['super_admin', 'store_manager', 'sales_manager', 'delivery_staff', 'staff'] },
  { label: 'Products',   href: '/products',    icon: Package,         roles: ['super_admin', 'store_manager', 'sales_manager'] },
  { label: 'Categories', href: '/categories',  icon: Tag,             roles: ['super_admin'] },
  { label: 'Customers',  href: '/customers',   icon: Users,           roles: ['super_admin', 'store_manager', 'sales_manager'] },
  { label: 'Analytics',  href: '/analytics',   icon: BarChart3,       roles: ['super_admin', 'store_manager'] },
  { label: 'Settings',   href: '/settings',    icon: Settings,        roles: ['super_admin', 'store_manager'] },
  { label: 'Stores',     href: '/stores',      icon: LayoutDashboard, roles: ['super_admin'] },
  { label: 'Users',      href: '/users',       icon: Users,           roles: ['super_admin'] },
  { label: 'Compliance', href: '/compliance',  icon: Shield,          roles: ['super_admin'] },
];

// Bottom nav tabs per role — max 3 primary + More
const BOTTOM_NAV: Record<string, { label: string; href: string; icon: React.ElementType }[]> = {
  super_admin:    [
    { label: 'Home',     href: '/',        icon: LayoutDashboard },
    { label: 'Orders',   href: '/orders',  icon: ClipboardList },
    { label: 'Products', href: '/products',icon: Package },
  ],
  store_manager:  [
    { label: 'Home',     href: '/',        icon: LayoutDashboard },
    { label: 'Orders',   href: '/orders',  icon: ClipboardList },
    { label: 'Products', href: '/products',icon: Package },
  ],
  sales_manager:  [
    { label: 'Home',     href: '/',        icon: LayoutDashboard },
    { label: 'Orders',   href: '/orders',  icon: ClipboardList },
    { label: 'Products', href: '/products',icon: Package },
  ],
  delivery_staff: [
    { label: 'Orders',    href: '/orders',  icon: ClipboardList },
  ],
  staff: [
    { label: 'Orders',    href: '/orders',  icon: ClipboardList },
  ],
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { username, storeId, role } = useAuthStore();
  const userRole = role || 'super_admin';
  const NAV = NAV_ALL.filter(item => item.roles.includes(userRole));
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [activeStoreId, setActiveStoreId] = useState<string>(
    localStorage.getItem('mart_admin_active_store') || '00000000-0000-0000-0000-000000000001'
  );

  useEffect(() => {
    if (!username) return;
    if (!storeId) {
      // super_admin — load all stores for selector
      storesApi.getAll().then(r => setStores(r.data.data || [])).catch(() => {});
    } else {
      setActiveStoreId(storeId);
    }
    // Fetch QR URL for payment collection
    settingsApi.getAll(getActiveStoreId()).then(r => {
      const qr = (r.data.data || []).find((s: any) => s.key === 'phonepay_qr_url');
      if (qr?.value) setQrUrl(qr.value);
    }).catch(() => {});
  }, [username, storeId]);

  const handleStoreChange = (id: string) => {
    setActiveStoreId(id);
    localStorage.setItem('mart_admin_active_store', id);
    window.location.reload(); // reload to refresh all page data
  };
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const bottomTabs = BOTTOM_NAV[userRole] || BOTTOM_NAV.staff;

  const PAGE_TITLES: Record<string, string> = {
    '/': 'Dashboard', '/orders': 'Orders', '/products': 'Products',
    '/categories': 'Categories', '/customers': 'Customers',
    '/analytics': 'Analytics', '/settings': 'Settings',
    '/profile': 'My Profile', '/change-password': 'Change Password',
    '/stores': 'Stores', '/users': 'Users', '/compliance': 'Compliance', '/more': 'More',
  };



  const SidebarLinks = ({ onNav }: { onNav?: () => void }) => (
    <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
      {NAV.map(item => {
        const active = pathname === item.href;
        return (
          <NavLink
            key={item.href}
            to={item.href}
            onClick={onNav}
            className={`sidebar-link ${active ? 'active' : ''} ${collapsed ? 'flex-col gap-2 px-2 py-5 justify-center' : ''}`}
          >
            <item.icon className={`flex-shrink-0 ${collapsed ? 'w-8 h-8' : 'w-5 h-5'}`} />
            {collapsed
              ? <span className={`text-xs font-semibold text-center leading-tight ${active ? 'text-gray-900' : 'text-gray-400'}`}>{item.label}</span>
              : <span className="truncate">{item.label}</span>
            }
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-50 to-emerald-50/20 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 font-sans">

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden lg:flex fixed inset-y-0 left-0 z-50 flex-col bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 transition-all duration-300 ${collapsed ? 'w-[90px]' : 'w-[200px]'}`}>
        {/* Logo */}
        <div className={`flex items-center justify-center border-b border-gray-200 dark:border-slate-700 flex-shrink-0 ${collapsed ? 'px-2 py-5' : 'py-5'}`}>
          <img src="/mart_hub_brand_logo.png" alt="Gokez Hub" className="h-12 w-auto object-contain" />
        </div>

        <SidebarLinks />

        {/* Powered by */}
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-slate-700 px-4 py-3">
          {collapsed ? (
            <div className="flex justify-center"><Sparkles className="w-3.5 h-3.5 text-emerald-400" /></div>
          ) : (
            <p className="text-[10px] text-gray-400 text-center leading-relaxed">
              Powered by{' '}
              <span className="font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 bg-clip-text text-transparent">
                Gokez Technologies Pvt. Ltd.
              </span>
            </p>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="hidden lg:flex absolute -right-3 bottom-14 w-6 h-6 items-center justify-center bg-white rounded-full shadow-md border border-gray-200 text-gray-500 hover:text-gray-700 transition-colors z-10"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </aside>

      {/* ── Main ── */}
      <div className={`min-h-screen transition-all duration-300 ${collapsed ? 'lg:pl-[90px]' : 'lg:pl-[200px]'}`}>

        {/* Sticky header */}
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200/80 dark:border-slate-700/80 shadow-sm">
          <div className="flex items-center justify-between h-14 px-4 sm:px-6 gap-4">
            {/* Mobile header left */}
            <div className="lg:hidden">
              {['/change-password', '/settings', '/analytics', '/customers', '/categories', '/stores', '/users', '/compliance', '/profile'].includes(pathname) ? (
                <button onClick={() => navigate(-1)}
                  className="p-2 -ml-1 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                  <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-slate-400" />
                </button>
              ) : pathname === '/' ? (
                <img src="/mart_hub_brand_logo.png" alt="Gokez Hub" className="h-8 object-contain" />
              ) : (
                <span className="text-sm font-bold text-gray-900 dark:text-white">{PAGE_TITLES[pathname] || 'Gokez Hub'}</span>
              )}
            </div>

            {/* Desktop header — page title only */}
            <span className="hidden lg:block text-sm font-bold text-gray-900 dark:text-white">{PAGE_TITLES[pathname] || 'Gokez Hub'}</span>

            <div className="flex-1" />

            {/* Store selector — super_admin only */}
            {!storeId && stores.length > 1 && (
              <select
                value={activeStoreId}
                onChange={e => handleStoreChange(e.target.value)}
                className="text-xs border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {/* QR only */}
            {qrUrl && (
              <button onClick={() => setShowQr(true)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                <QrCode className="w-5 h-5 text-gray-500 dark:text-slate-400" />
              </button>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 dark:text-slate-100">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-stretch h-20 max-w-lg mx-auto">
          {bottomTabs.map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <button key={href} onClick={() => navigate(href)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative ${
                  active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-slate-500'
                }`}>
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />}
                <Icon className="w-6 h-6" />
                <span className="text-[11px] font-semibold">{label}</span>
              </button>
            );
          })}
          {/* More tab */}
          <button onClick={() => navigate('/more')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative ${
              pathname === '/more' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-slate-500'
            }`}>
            {pathname === '/more' && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />}
            <MenuIcon className="w-6 h-6" />
            <span className="text-[11px] font-semibold">More</span>
          </button>
        </div>
      </nav>

      {/* QR Payment Modal */}
      {showQr && qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm"
          onClick={() => setShowQr(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 mx-4 max-w-xs w-full text-center"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Payment QR Code</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">Show this to the customer to collect payment</p>
            <img src={qrUrl} alt="Payment QR" className="w-full max-w-[220px] mx-auto rounded-2xl border border-gray-100 dark:border-slate-700" />
            <button onClick={() => setShowQr(false)}
              className="mt-5 w-full py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 text-sm font-semibold rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
