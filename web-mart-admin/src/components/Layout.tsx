import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Tag, ClipboardList,
  Users, Settings, LogOut, Menu, X, Shield, QrCode,
  ChevronLeft, ChevronRight, Sparkles, BarChart3, User, KeyRound,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
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
export default function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { username, name, logout, storeId, role } = useAuthStore();
  const userRole = role || 'super_admin';
  const NAV = NAV_ALL.filter(item => item.roles.includes(userRole));
  const { isDark, toggle } = useThemeStore();
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const displayName = name || username || 'Admin';

  const PAGE_TITLES: Record<string, string> = {
    '/': 'Dashboard',
    '/orders': 'Orders',
    '/products': 'Products',
    '/categories': 'Categories',
    '/customers': 'Customers',
    '/analytics': 'Analytics',
    '/settings': 'Settings',
    '/profile': 'My Profile',
    '/change-password': 'Change Password',
    '/stores': 'Stores',
    '/users': 'Users',
    '/compliance': 'Compliance',
  };
  const pageTitle = PAGE_TITLES[pathname] || 'Gokez Mart';

  const handleLogout = () => { logout(); navigate('/login'); };

  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  const SidebarLinks = ({ onNav }: { onNav?: () => void }) => (
    <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
      {NAV.map(item => {
        const active = pathname === item.href;
        return (
          <NavLink
            key={item.href}
            to={item.href}
            onClick={onNav}
            className={`sidebar-link ${active ? 'active' : ''} ${collapsed ? 'flex-col gap-1 px-2 py-3 justify-center' : ''}`}
          >
            <item.icon className={`flex-shrink-0 ${collapsed ? 'w-6 h-6' : 'w-5 h-5'}`} />
            {collapsed
              ? <span className={`text-[10px] font-semibold text-center leading-tight ${active ? 'text-gray-900' : 'text-gray-400'}`}>{item.label}</span>
              : <span className="truncate">{item.label}</span>
            }
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-50 to-emerald-50/20 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 font-sans">

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Desktop sidebar ── */}
      <aside className={`hidden lg:flex fixed inset-y-0 left-0 z-50 flex-col bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 transition-all duration-300 ${collapsed ? 'w-[72px]' : 'w-[200px]'}`}>
        {/* Logo */}
        <div className={`flex items-center border-b border-gray-200 dark:border-slate-700 flex-shrink-0 ${collapsed ? 'justify-center px-2 py-4' : 'justify-center py-4'}`}>
          {collapsed ? (
            <img src="/mart_web_logo.png?v=2" alt="Gokez Mart" className="h-8 w-auto object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <img src="/mart_web_logo.png?v=2" alt="Gokez Mart" className="h-8 w-auto object-contain" />
              <span className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Admin Portal</span>
            </div>
          )}
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

      {/* ── Mobile sidebar ── */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 flex flex-col shadow-xl transform transition-all duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex flex-col items-center gap-0.5">
            <img src="/mart_web_logo.png?v=2" alt="Gokez Mart" className="h-8 w-auto object-contain" />
            <span className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Admin Portal</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <SidebarLinks onNav={() => setMobileOpen(false)} />
        <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3">
          <p className="text-[10px] text-gray-400 text-center">
            Powered by <span className="font-semibold text-emerald-600">Gokez Technologies Pvt. Ltd.</span>
          </p>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className={`min-h-screen transition-all duration-300 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-[200px]'}`}>

        {/* Sticky header */}
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200/80 dark:border-slate-700/80 shadow-sm">
          <div className="flex items-center justify-between h-14 px-4 sm:px-6 gap-4">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2.5 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl">
              <Menu className="w-6 h-6" />
            </button>

            <span className="text-sm font-bold text-gray-900 dark:text-white">{pageTitle}</span>

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

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold flex items-center justify-center">
                  {initials}
                </div>
                <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-slate-300">{displayName}</span>
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[19] bg-transparent" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-100 dark:border-slate-700 py-2 z-20 animate-fade-in">
                    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-700">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{displayName}</p>
                      <p className="text-xs text-gray-400">{username}</p>
                    </div>
                    <Link to="/profile" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                      <User className="w-4 h-4 text-gray-400" /> My Profile
                    </Link>
                    <Link to="/change-password" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                      <KeyRound className="w-4 h-4 text-gray-400" /> Change Password
                    </Link>
                    {qrUrl && (
                      <button onClick={() => { setShowQr(true); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                        <QrCode className="w-4 h-4 text-gray-400" /> Show Payment QR
                      </button>
                    )}
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-base">{isDark ? '🌙' : '☀️'}</span>
                      <span className="text-sm text-gray-700 dark:text-slate-300 flex-1">Dark Mode</span>
                      <button onClick={toggle} role="switch" aria-checked={isDark}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${isDark ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div className="h-px bg-gray-100 dark:bg-slate-700 my-1" />
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8 dark:text-slate-100">
          {children}
        </main>
      </div>

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
