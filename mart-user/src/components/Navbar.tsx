import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, ClipboardList, User, Search, Loader2, LocateFixed } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { useZoneStore } from '../store/zoneStore';

type View = 'home' | 'categories' | 'orders' | 'account';


interface NavbarProps {
  onUseMyLocation?: () => void | Promise<void>;
  activeView: View;
  onNavChange: (v: View) => void;
  onCheckout: () => void;
  onSearchOpen: () => void;
  searchPrompt: string;
}

// Nav items — all including Cart and Profile in center
const navItems = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

  export default function Navbar({ onUseMyLocation, activeView, onNavChange, onCheckout, onSearchOpen, searchPrompt }: NavbarProps) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const totalItems = useCartStore(s => s.totalItems());
  // Delivery-area state is shared app-wide via the zone store, so the navbar
  // picker, the Account page toggle and the catalog loader always stay in sync.
  const zones = useZoneStore(s => s.zones);
  const selectedZone = useZoneStore(s => s.selectedZone);
  const locationBusy = useZoneStore(s => s.locating);

  const selectZone = (zone: (typeof zones)[number]) => {
    useZoneStore.getState().chooseZone(zone);
    setZoneOpen(false);
  };

  const ZoneDropdown = () => {
    const triggerMyLocation = () => {
      if (!onUseMyLocation || locationBusy) return;
      setZoneOpen(false);
      void onUseMyLocation();
    };
    // Only show dropdown if more than 1 zone
    if (zones.length <= 1) {
      if (!selectedZone) return null;
      return (
        <button type="button" onClick={triggerMyLocation} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
          {locationBusy
            ? <Loader2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 animate-spin" />
            : <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
          <div className="text-left">
            <p className="text-[9px] text-black/70 dark:text-white/70 leading-none">Delivery Zone</p>
            <p className="text-xs font-bold text-black dark:text-white leading-tight truncate max-w-[90px]">
              {selectedZone.name}
            </p>
          </div>
        </button>
      );
    }
    return (
    <div className="relative">
      <button onClick={() => setZoneOpen(o => !o)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity">
        {locationBusy
          ? <Loader2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 animate-spin" />
          : <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
        <div className="text-left">
          <p className="text-[9px] text-black/70 dark:text-white/70 leading-none">Delivery Zone</p>
          <p className="text-xs font-bold text-black dark:text-white leading-tight truncate max-w-[90px]">
            {selectedZone ? selectedZone.name : 'Select area'}
          </p>
        </div>
        <ChevronDown className={`w-3 h-3 text-black/70 dark:text-white/70 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
      </button>

      {zoneOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
          <div className="absolute top-full mt-1 right-0 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-2 z-20">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 pb-1.5">Delivery Areas</p>
            {onUseMyLocation && (
              <button onClick={triggerMyLocation} disabled={locationBusy}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60">
                {locationBusy
                  ? <Loader2 className="w-4 h-4 text-emerald-500 flex-shrink-0 animate-spin" />
                  : <LocateFixed className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{locationBusy ? 'Finding location...' : 'Use my location'}</span>
              </button>
            )}
            {zones.map(zone => (
              <button key={zone.id} onClick={() => selectZone(zone)}
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

  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] bg-gradient-to-b from-[#FACC15] to-[#FACC15] shadow-sm dark:from-[#18191a] dark:to-[#14532d]">

      {/* Row 1 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">

        {/* Logo + slogan — home only */}
        {activeView === 'home' && (
          <div className="flex-shrink-0 flex flex-col items-start justify-center leading-none">
            <picture className="dark:hidden">
              <source srcSet="/mart_brand_black.webp" type="image/webp" />
              <img src="/mart_brand_black.png" alt="Gokez Mart" width="384" height="256"
                className="h-[48px] w-[192px] sm:h-[58px] sm:w-[232px] object-contain object-left" />
            </picture>
            <picture className="hidden dark:block">
              <source srcSet="/mart_brand_dark.webp" type="image/webp" />
              <img src="/mart_brand_dark.png" alt="Gokez Mart" width="384" height="256"
                className="h-[48px] w-[192px] sm:h-[58px] sm:w-[232px] object-contain object-left" />
            </picture>
          </div>
        )}

        {/* Page title — non-home (moved out of page body) */}
        {activeView !== 'home' && (
          <div className="flex-shrink-0 min-w-0">
            <h1 className="truncate text-lg sm:text-xl font-bold text-black dark:text-white">
              {activeView === 'categories' ? 'Categories' : activeView === 'orders' ? 'My Orders' : 'Account'}
            </h1>
          </div>
        )}

        {/* ── Desktop layout ── */}
        {/* Center: nav items + Cart */}
        <nav className="hidden sm:flex items-center gap-1 mx-auto">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  isActive ? 'text-black bg-black/10 dark:text-white dark:bg-white/20' : 'text-black/75 hover:bg-black/5 dark:text-white/75 dark:hover:bg-white/10'
                }`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
          {/* Cart in center */}
          <button onClick={onCheckout}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-black/75 hover:bg-black/5 dark:text-white/75 dark:hover:bg-white/10 transition-colors">
            <ShoppingCart className="w-4 h-4" />
            Cart
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-emerald-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </button>
        </nav>

        {/* Right: Location only */}
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <ZoneDropdown />
        </div>

        {/* ── Mobile layout: location right ── */}
        <div className="flex sm:hidden items-center gap-1.5 ml-auto">
          <ZoneDropdown />
        </div>
      </div>

      {/* Row 2: Search — the Categories view owns its own category-scoped filter. */}
      {activeView !== 'account' && activeView !== 'orders' && activeView !== 'categories' && (
        <div className="sm:hidden px-4 pb-2.5">
          <button type="button" onClick={onSearchOpen} className="relative w-full text-left">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <span className="block w-full overflow-hidden whitespace-nowrap rounded-xl bg-gray-100 py-2.5 pl-10 pr-3 text-sm text-gray-500 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-1 dark:ring-slate-600 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text">{searchPrompt}</span></span>
          </button>
        </div>
      )}
    </header>
  );
}
