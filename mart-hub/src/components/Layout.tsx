import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate, Link } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import {
  Home, Package, Image as ImageIcon,
  Users, Shield, Boxes, UserPlus,
  ChevronLeft, ChevronRight, Sparkles, BarChart3,
  Menu as MenuIcon, User, KeyRound, LogOut, Moon, Sun, MessageSquare, CreditCard, LayoutGrid, Smartphone,
  Store, ShoppingBag, Truck, Megaphone, UserCog, Inbox, LayoutList, LayoutTemplate, Lightbulb, MapPin,
  TrendingUp, RotateCcw,
} from 'lucide-react';
import { useAuthStore, isKnownRole } from '../store/authStore';
import { storesApi, authApi, inventoryApi } from '../services/api';
import { useHeaderAction } from '../store/headerActionStore';
import { useZoneSelectionStore } from '../store/zoneSelectionStore';
import { getActiveStoreId } from '../utils/store';
import LiveOrderToasts from './LiveOrderToasts';

// Roles mirror mart_admins_role_check in migration 056, including store_manager.
// sales_manager was retired: the database now permits super_admin, store_owner,
// store_manager, delivery_staff and staff only.
type NavSection = 'Daily Work' | 'Store Management' | 'Administration';
type NavItem = {
  label: string; href: string; icon: React.ElementType; roles: string[]; section: NavSection;
};

export const NAV_SECTIONS: NavSection[] = ['Daily Work', 'Store Management', 'Administration'];

export const NAV_ALL: NavItem[] = [
  { label: 'Dashboard',          href: '/',                    icon: Home,            roles: ['super_admin', 'store_owner', 'store_manager', 'delivery_staff', 'staff'], section: 'Daily Work' },
  { label: 'Orders',             href: '/orders',              icon: Package,         roles: ['super_admin', 'store_owner', 'store_manager', 'delivery_staff', 'staff'], section: 'Daily Work' },
  { label: 'Products',           href: '/products',            icon: ShoppingBag,     roles: ['super_admin', 'store_owner', 'store_manager', 'staff'], section: 'Daily Work' },
  { label: 'Inventory',          href: '/inventory',           icon: Boxes,           roles: ['super_admin', 'store_owner', 'store_manager', 'staff'], section: 'Daily Work' },
  { label: 'Sales',              href: '/daily-sales',         icon: TrendingUp,      roles: ['super_admin', 'store_owner', 'store_manager'], section: 'Daily Work' },
  { label: 'Top Selling',      href: '/top-selling',        icon: Package,         roles: ['super_admin', 'store_owner', 'store_manager'], section: 'Store Management' },
  { label: 'My Deliveries',      href: '/delivery',            icon: Truck,           roles: ['delivery_staff', 'staff'], section: 'Daily Work' },
  { label: 'Analytics',          href: '/analytics',           icon: BarChart3,       roles: ['super_admin', 'store_owner', 'store_manager'], section: 'Store Management' },
  { label: 'Catalog',            href: '/catalog',             icon: LayoutList,      roles: ['super_admin', 'store_owner', 'store_manager'], section: 'Store Management' },
  { label: 'Feedback',           href: '/feedback',            icon: MessageSquare,   roles: ['super_admin', 'store_owner', 'store_manager'], section: 'Store Management' },
  { label: 'Campaigns',          href: '/campaigns',           icon: Megaphone,       roles: ['super_admin', 'store_owner'], section: 'Store Management' },
  { label: 'Customers',          href: '/customers',           icon: Users,           roles: ['super_admin'], section: 'Administration' },
  { label: 'Leads',              href: '/customer-leads',      icon: UserPlus,        roles: ['super_admin'], section: 'Administration' },
  { label: 'Suggestions',        href: '/suggestions',         icon: Lightbulb,       roles: ['super_admin'], section: 'Administration' },
  { label: 'Installs',           href: '/install-analytics',   icon: Smartphone,      roles: ['super_admin'], section: 'Administration' },
  { label: 'Categories',         href: '/categories',          icon: LayoutGrid,      roles: ['super_admin', 'store_owner'], section: 'Administration' },
  { label: 'Carousel',           href: '/carousel',            icon: ImageIcon,       roles: ['super_admin'], section: 'Administration' },
  { label: 'Promotions',         href: '/promotions',          icon: Megaphone,       roles: ['super_admin'], section: 'Administration' },
  { label: 'Home Page',          href: '/home-sections',       icon: LayoutTemplate,  roles: ['super_admin', 'store_owner'], section: 'Administration' },
  { label: 'Stores',             href: '/stores',              icon: Store,           roles: ['super_admin', 'store_owner'], section: 'Administration' },
  { label: 'Zones',              href: '/zones',               icon: MapPin,          roles: ['super_admin'], section: 'Administration' },
  { label: 'Subscriptions',      href: '/subscriptions',       icon: CreditCard,      roles: ['super_admin'], section: 'Administration' },
  { label: 'Store Requests',     href: '/store-applications',  icon: Inbox,           roles: ['super_admin'], section: 'Administration' },
  { label: 'Users',              href: '/users',               icon: UserCog,         roles: ['super_admin'], section: 'Administration' },
  { label: 'Restore Order',      href: '/restore-order',       icon: RotateCcw,       roles: ['super_admin'], section: 'Administration' },
  { label: 'Compliance',         href: '/compliance',          icon: Shield,          roles: ['super_admin'], section: 'Administration' },
];

// Bottom nav tabs per role — max 3 primary + More
export const BOTTOM_NAV: Record<string, { label: string; href: string; icon: React.ElementType }[]> = {
  super_admin:    [
    { label: 'Home',      href: '/',          icon: Home },
    { label: 'Orders',    href: '/orders',    icon: Package },
    { label: 'Inventory', href: '/inventory', icon: Boxes },
    { label: 'Products',  href: '/products',  icon: ShoppingBag },
  ],
  store_owner:  [
    { label: 'Home',      href: '/',          icon: Home },
    { label: 'Orders',    href: '/orders',    icon: Package },
    { label: 'Inventory', href: '/inventory', icon: Boxes },
    { label: 'Products',  href: '/products',  icon: ShoppingBag },
  ],
  store_manager: [
    { label: 'Home',      href: '/',          icon: Home },
    { label: 'Orders',    href: '/orders',    icon: Package },
    { label: 'Inventory', href: '/inventory', icon: Boxes },
    { label: 'Products',  href: '/products',  icon: ShoppingBag },
  ],
  delivery_staff: [
    { label: 'Deliveries', href: '/delivery', icon: Truck },
    { label: 'Orders',     href: '/orders',   icon: Package },
  ],
  staff: [
    { label: 'Home',      href: '/',          icon: Home },
    { label: 'Orders',    href: '/orders',    icon: Package },
    { label: 'Inventory', href: '/inventory', icon: Boxes },
    { label: 'Products',  href: '/products',  icon: ShoppingBag },
  ],
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { username, name, storeId, role, canAccessDailySales, logout, isSuperAdmin } = useAuthStore();
  const { onAction, label } = useHeaderAction();
  const zoneInventoryStore = useZoneSelectionStore(s => s.inventoryStore);
  const setZoneInventoryStore = useZoneSelectionStore(s => s.setInventoryStore);
  const zoneProductsStore = useZoneSelectionStore(s => s.productsStore);
  const setZoneProductsStore = useZoneSelectionStore(s => s.setProductsStore);
  // Fail closed. An absent or unrecognised role yields an empty sidebar rather
  // than the full super-admin nav (previously `role || 'super_admin'`).
  const userRole = isKnownRole(role) ? (role as string) : '';
  // Daily Sales is only for the head store's owner/manager (or super admin).
  // Hide it until the backend has confirmed head status for this session.
  const NAV = userRole ? NAV_ALL.filter(item => {
    if (!item.roles.includes(userRole)) return false;
    if (item.href === '/daily-sales' && userRole !== 'super_admin' && canAccessDailySales !== true) return false;
    return true;
  }) : [];
  const [stores, setStores] = useState<{ id: string; name: string; address?: string | null }[]>([]);
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [activeStoreId, setActiveStoreId] = useState<string>(
    localStorage.getItem('mart_admin_active_store') || '00000000-0000-0000-000000000001'
  );
  const [inventoryStores, setInventoryStores] = useState<Array<{ id: string; name: string; isOwn?: boolean }>>([]);
  // Must mirror the default ProductsPage resolves: persisted pick, then the
  // active store while it is manageable, and only then the head/first store.
  const activeProductsStore = zoneProductsStore && inventoryStores.some(s => s.id === zoneProductsStore)
    ? zoneProductsStore
    : inventoryStores.some(s => s.id === getActiveStoreId())
      ? getActiveStoreId()
      : inventoryStores.find(s => s.isOwn)?.id || inventoryStores[0]?.id;

  useEffect(() => {
    if (!username) return;
    // Store name lives on mart_stores (migration 094 removed the duplicate
    // settings key), so resolve it from the store list for every role.
    storesApi.getAll().then(r => {
      const all = r.data.data || [];
      if (isSuperAdmin()) {
        const active = all.filter((s: any) => s.isActive);
        setStores(active);
        setActiveStoreId(prev => {
          if (!active.length || active.some((s: any) => s.id === prev)) return prev;
          localStorage.setItem('mart_admin_active_store', active[0].id);
          return active[0].id;
        });
      } else {
        const ownStoreId = storeId || localStorage.getItem('mart_admin_active_store');
        const own = all.find((s: any) => s.id === ownStoreId) || all[0];
        if (own?.name) setStoreName(own.name);
        if (own?.address) setStoreAddress(own.address);
      }
    }).catch(() => {});
    if (!isSuperAdmin()) {
      setActiveStoreId(storeId || localStorage.getItem('mart_admin_active_store') || '00000000-0000-0000-0000-000000000001');
    }
  }, [username, storeId]);

  useEffect(() => {
    // Both zone-head surfaces (Inventory, Products) render the store picker in
    // the header, so the manageable-store list is needed on either page.
    if ((pathname !== '/inventory' && pathname !== '/products') || isSuperAdmin()) return;
    inventoryApi.getStores().then(r => {
      const list = r.data.data || [];
      setInventoryStores(list);
    }).catch(() => setInventoryStores([]));
  }, [pathname, isSuperAdmin]);

  const handleStoreChange = (id: string) => {
    setActiveStoreId(id);
    localStorage.setItem('mart_admin_active_store', id);
    window.location.reload(); // reload to refresh all page data
  };
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { isDark, toggle } = useThemeStore();
  const handleLogout = () => {
    // Revoke this device's session server-side; local sign-out must not wait
    // on the network, so the request is fired and forgotten.
    authApi.logout().catch(() => {});
    logout();
    navigate('/login');
  };

  // Fail closed — previously fell back to the staff tab set for any unknown role.
  const bottomTabs = (userRole && BOTTOM_NAV[userRole]) || [];

  const PAGE_TITLES: Record<string, string> = {
    '/': 'Dashboard', '/orders': 'Orders', '/products': 'Products',
    '/categories': 'Categories', '/customers': 'Customers',
    '/analytics': 'Analytics', '/inventory': 'Inventory',
    '/daily-sales': 'Sales Overview',
    '/top-selling': 'Top selling',
    '/profile': 'My Profile', '/change-password': 'Change Password',
    '/stores': 'Stores', '/zones': 'Zones', '/users': 'Users', '/compliance': 'Compliance', '/more': 'More',
    '/store-applications': 'Store Requests',
    '/catalog': 'Catalog',
    '/feedback': 'Feedback',
    '/campaigns': 'Campaigns',
    '/promotions': 'Promotions',
    '/carousel': 'Carousel Manager',
    '/home-sections': 'Home Page',
      '/delivery': 'My Deliveries',
    '/customer-leads': 'Leads',
    '/suggestions': 'Product Suggestions',
    '/install-analytics': 'Installs',
    '/subscriptions': 'Subscriptions',
  };



  const activeStoreName = storeName || stores.find(s => s.id === activeStoreId)?.name || '';
  const activeStoreAddress = storeAddress || stores.find(s => s.id === activeStoreId)?.address || '';

  const SidebarLinks = ({ onNav }: { onNav?: () => void }) => (
    <nav className="flex-1 overflow-y-auto py-3">
      {NAV_SECTIONS.map(section => {
        const items = NAV.filter(item => item.section === section);
        if (!items.length) return null;
        return (
          <div key={section} className={collapsed ? 'mb-2' : 'mb-4'}>
            {!collapsed && <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">{section}</p>}
            <div className="space-y-0.5">
              {items.map(item => {
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
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 font-sans">

      {/* Global live order toasts (new-order alerts, network-independent) */}
      <LiveOrderToasts />

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden lg:flex fixed inset-y-0 left-0 z-50 flex-col bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 transition-all duration-300 ${collapsed ? 'w-[90px]' : 'w-[200px]'}`}>
        {/* Logo + slogan */}
        <div className={`flex flex-col items-start justify-center border-b border-gray-100 dark:border-slate-800 flex-shrink-0 px-4 bg-[#0f172a] dark:bg-[#18191a] ${collapsed ? 'py-5' : 'py-4'}`}>
          <picture>
            <source srcSet="/mart_hub_brand_logo.webp" type="image/webp" />
            <img src="/mart_hub_brand_logo.png" alt="Gokez Hub" width="384" height="256" className="h-11 w-48 object-contain object-left" />
          </picture>
          {!collapsed && (
            <p className="text-[8px] font-bold uppercase text-white tracking-wide leading-tight -mt-1.5 whitespace-nowrap">
              Your Store <span className="align-middle">&bull;</span> Now Online
            </p>
          )}
        </div>

        <SidebarLinks />

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-slate-700 px-4 py-3">
          {collapsed ? (
            <div className="flex justify-center"><Sparkles className="w-3.5 h-3.5 text-emerald-400" /></div>
          ) : (
            <p className="text-[10px] text-gray-500 text-center leading-relaxed">
              A product of{' '}
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
        <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-gradient-to-b from-[#FFC400] to-[#FFF6B5] dark:bg-none dark:bg-[#18191a] dark:border-b dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 gap-4">
            {/* Mobile header left — brand + context. The brand mark mirrors the
                login screen's header (logo left, home right) so the shell
                keeps its identity after launch instead of only while the
                login page is visible. */}
            <div className="lg:hidden flex items-center gap-2 min-w-0">
              {['/change-password', '/analytics', '/customers', '/customer-leads', '/suggestions', '/install-analytics', '/subscriptions', '/categories', '/stores', '/zones', '/users', '/compliance', '/profile', '/store-applications', '/catalog', '/delivery', '/daily-sales', '/top-selling', '/feedback', '/campaigns', '/carousel', '/home-sections'].includes(pathname) ? (
                <div className="flex items-center gap-1 min-w-0">
                  <button onClick={() => navigate(-1)}
                    className="p-2 -ml-1 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex-shrink-0">
                    <ChevronLeft className="w-5 h-5 text-gray-900 dark:text-slate-300" />
                  </button>
                  <span className="text-base font-bold text-gray-900 dark:text-white truncate">{PAGE_TITLES[pathname] || 'Gokez Hub'}</span>
                </div>
              ) : pathname === '/' ? (
                <div className="flex min-w-0 flex-col items-start">
                  <span className="max-w-[42vw] truncate text-base font-extrabold leading-tight tracking-tight text-gray-900 dark:text-white">
                    {activeStoreName}
                  </span>
                  {activeStoreAddress && (
                    <p className="max-w-[42vw] truncate text-[9px] sm:text-[10px] font-medium text-gray-800 dark:text-slate-300 leading-tight">
                      {activeStoreAddress}
                    </p>
                  )}
                </div>
              ) : (
                <span className="text-base font-bold text-gray-900 dark:text-white truncate">{PAGE_TITLES[pathname] || 'Gokez Hub'}</span>
              )}
            </div>

            {/* Desktop header — store name + address on home, else page title */}
            {pathname === '/' ? (
              <div className="hidden lg:flex min-w-0 flex-col">
                <span className="max-w-[360px] truncate text-base font-bold text-gray-900 dark:text-white">
                  {activeStoreName || PAGE_TITLES[pathname] || 'Gokez Hub'}
                </span>
                {activeStoreAddress && (
                  <span className="max-w-[360px] truncate text-[10px] font-medium text-gray-800 dark:text-slate-300 leading-tight">
                    {activeStoreAddress}
                  </span>
                )}
              </div>
            ) : (
              <span className="hidden lg:block text-base font-bold text-gray-900 dark:text-white">{PAGE_TITLES[pathname] || 'Gokez Hub'}</span>
            )}

            <div className="flex-1" />

            {/* Mobile-only header action slot — injected by pages */}
            {onAction && pathname !== '/products' && (
              <button onClick={onAction}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm flex-shrink-0">
                {label}
              </button>
            )}

            {/* Store selector — super_admin only.
                Desktop (lg+): stays in the header on every page, unchanged.
                Mobile: shown only on the More page (/more), where it's smaller;
                removed from the mobile header on all other routes. */}
            {isSuperAdmin() && stores.length > 1 && (
              <select
                value={activeStoreId}
                onChange={e => { if (e.target.value) handleStoreChange(e.target.value); }}
                aria-label="Select active store"
                className={`${pathname === '/more' ? '' : 'hidden lg:block'} appearance-none max-w-[34vw] lg:max-w-[42vw] text-[11px] lg:text-xs border border-black/15 dark:border-slate-600 rounded-xl px-2.5 py-1 lg:px-3 lg:py-1.5 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-300 focus:outline-none focus:border-gray-900 dark:focus:border-emerald-500 font-semibold`}
              >
                {/* "Select store" is only the empty-state placeholder; the control
                    is driven by activeStoreId so it shows the selected store name. */}
                <option value="" disabled>Select store</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            {/* Zone store picker — zone heads only (Inventory keeps its
                Zone-All overview; Products edits one store at a time).
                The selection lives in zoneSelectionStore, not the URL, so
                raw store ids stay out of the address bar. */}
            {(pathname === '/inventory' || pathname === '/products') && !isSuperAdmin() && inventoryStores.length > 1 && (
              <select
                value={pathname === '/inventory' ? zoneInventoryStore : activeProductsStore}
                onChange={e => {
                  if (pathname === '/inventory') setZoneInventoryStore(e.target.value);
                  else setZoneProductsStore(e.target.value);
                }}
                aria-label={pathname === '/inventory' ? 'Select store to manage inventory for' : 'Select store to manage products for'}
                className="max-w-[34vw] lg:max-w-[22vw] text-[11px] lg:text-xs border border-black/15 dark:border-slate-600 rounded-xl px-2.5 py-1 lg:px-3 lg:py-1.5 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-300 focus:outline-none focus:border-gray-900 dark:focus:border-emerald-500 font-semibold"
              >
                {pathname === '/inventory' && <option value="all">Zone-All</option>}
                {inventoryStores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.isOwn ? ' — Head' : ''}</option>
                ))}
              </select>
            )}

            {/* Desktop user dropdown — hidden on mobile */}
            <div className="hidden lg:block relative">
              <button onClick={() => setUserMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {(name || username || 'A').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white leading-none">{name || username}</p>
                  <p className="text-[10px] text-gray-700 dark:text-slate-300 capitalize leading-none mt-0.5">{role?.replace('_', ' ')}</p>
                </div>
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[19]" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-100 dark:border-slate-700 py-2 z-20">
                    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-700">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{name || username}</p>
                      <p className="text-xs text-gray-500 capitalize">{role?.replace('_', ' ')}</p>
                    </div>
                    <Link to="/profile" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700">
                      <User className="w-4 h-4 text-gray-500" /> My Profile
                    </Link>
                    <Link to="/change-password" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700">
                      <KeyRound className="w-4 h-4 text-gray-500" /> Change Password
                    </Link>
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      {isDark ? <Moon className="w-4 h-4 text-gray-500" /> : <Sun className="w-4 h-4 text-gray-500" />}
                      <span className="text-sm text-gray-700 dark:text-slate-300 flex-1">Dark Mode</span>
                      <button onClick={toggle} role="switch" aria-checked={isDark}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${isDark ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div className="h-px bg-gray-100 dark:bg-slate-700 my-1" />
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:pb-8 dark:text-slate-100">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-stretch h-20 max-w-lg mx-auto">
          {bottomTabs.map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return (
              <button key={href} onClick={() => navigate(href)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative ${
                  active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
                }`}>
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />}
                <Icon className="w-6 h-6" />
                <span className={`whitespace-nowrap text-[12px] font-semibold ${active ? 'font-bold text-emerald-800 dark:text-emerald-300' : ''}`}>{label}</span>
              </button>
            );
          })}
          {/* More tab */}
          <button onClick={() => navigate('/more')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative ${
              pathname === '/more' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
            }`}>
            {pathname === '/more' && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />}
            <MenuIcon className="w-6 h-6" />
            <span className={`whitespace-nowrap text-[12px] font-semibold ${pathname === '/more' ? 'font-bold text-emerald-800 dark:text-emerald-300' : ''}`}>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
