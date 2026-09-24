import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, ClipboardList, User, Search, X, Moon, Sun } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { useThemeStore } from '../store/themeStore';
import type { MartZone } from '../services/api';

type View = 'home' | 'categories' | 'orders' | 'account';

interface NavbarProps {
  zones: MartZone[];
  selectedZone: MartZone | null;
  onZoneChange: (zone: MartZone) => void;
  activeView: View;
  onNavChange: (v: View) => void;
  onCheckout: () => void;
  search: string;
  onSearch: (v: string) => void;
}

// Nav items — all including Cart and Profile in center
const navItems = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Profile',    Icon: User },
] as const;

export default function Navbar({ zones, selectedZone, onZoneChange, activeView, onNavChange, onCheckout, search, onSearch }: NavbarProps) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const totalItems = useCartStore(s => s.totalItems());
  const { isDark, toggle } = useThemeStore();

  const ZoneDropdown = () => {
    // Only show dropdown if more than 1 zone
    if (zones.length <= 1) {
      if (!selectedZone) return null;
      return (
        <div className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
          <div className="text-left">
            <p className="text-[9px] text-slate-400 leading-none">Delivery in</p>
            <p className="text-xs font-bold text-white leading-tight truncate max-w-[90px]">
              {selectedZone.name}
            </p>
          </div>
        </div>
      );
    }
    return (
    <div className="relative">
      <button onClick={() => setZoneOpen(o => !o)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity">
        <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        <div className="text-left">
          <p className="text-[9px] text-slate-400 leading-none">Delivery in</p>
          <p className="text-xs font-bold text-white leading-tight truncate max-w-[90px]">
            {selectedZone ? selectedZone.name : 'Select area'}
          </p>
        </div>
        <ChevronDown className={`w-3 h-3 text-slate-400 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
      </button>

      {zoneOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
          <div className="absolute top-full mt-1 right-0 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-2 z-20">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 pb-1.5">Delivery Areas</p>
            {zones.map(zone => (
              <button key={zone.id} onClick={() => { onZoneChange(zone); setZoneOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{zone.name}</p>
                  <p className="text-[10px] text-gray-500">{zone.radiusKm}km radius</p>
                </div>
                {selectedZone?.id === zone.id && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
              </button>
            ))}
            {zones.length === 0 && <p className="text-xs text-gray-500 px-3 py-2">No areas available</p>}
          </div>
        </>
      )}
    </div>
  );
  };

  const DarkToggle = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
    <button onClick={toggle}
      className={`rounded-xl transition-colors flex-shrink-0 bg-white/10 text-amber-300 hover:bg-white/20 ${
        size === 'sm' ? 'p-1.5' : 'p-2'
      }`}>
      {isDark
        ? <Sun className={size === 'sm' ? 'w-5 h-5' : 'w-5 h-5'} />
        : <Moon className={size === 'sm' ? 'w-5 h-5' : 'w-5 h-5'} />
      }
    </button>
  );

  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] bg-[#0f172a] dark:bg-[#0f172a] shadow-sm">

      {/* Row 1 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">

        {/* Logo + slogan */}
        <div className="flex-shrink-0 flex flex-col items-start justify-center leading-none">
          <picture className="dark:hidden">
            <source srcSet="/mart_brand_new.webp" type="image/webp" />
            <img src="/mart_brand_new.png" alt="Gokez Mart" width="384" height="256"
              className="h-9 w-36 sm:h-11 sm:w-48 object-contain object-left" />
          </picture>
          <picture className="hidden dark:block">
            <source srcSet="/mart_brand_dark.webp" type="image/webp" />
            <img src="/mart_brand_dark.png" alt="Gokez Mart" width="384" height="256"
              className="h-9 w-36 sm:h-11 sm:w-48 object-contain object-left" />
          </picture>
          <span className="block -mt-1.5 text-[6px] sm:text-[8px] font-black uppercase tracking-wide leading-tight text-white whitespace-nowrap">
            Shop Local <span className="align-middle">&bull;</span> Support Local
          </span>
        </div>

        {/* ── Desktop layout ── */}
        {/* Center: nav items + Cart */}
        <nav className="hidden sm:flex items-center gap-1 mx-auto">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  isActive ? 'text-emerald-400 bg-emerald-900/20' : 'text-slate-400 hover:bg-white/10'
                }`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
          {/* Cart in center */}
          <button onClick={onCheckout}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-slate-400 hover:bg-white/10 transition-colors">
            <ShoppingCart className="w-4 h-4" />
            Cart
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-emerald-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </button>
        </nav>

        {/* Right: Dark mode + Location only */}
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <DarkToggle />
          <ZoneDropdown />
        </div>

        {/* ── Mobile layout: dark mode + location right ── */}
        <div className="flex sm:hidden items-center gap-1.5 ml-auto">
          <DarkToggle size="sm" />
          <ZoneDropdown />
        </div>
      </div>

      {/* Row 2: Search — mobile only, hidden on profile and orders pages */}
      {activeView !== 'account' && activeView !== 'orders' && (
        <div className="sm:hidden px-4 pb-2.5">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search groceries, vegetables..."
              className="w-full pl-10 pr-9 py-2.5 bg-gray-100 dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white dark:focus:bg-slate-700 transition-all border-0"
            />
            {search && (
              <button onClick={() => onSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="border-b border-gray-100 dark:border-slate-800" />
    </header>
  );
}
