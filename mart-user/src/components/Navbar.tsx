import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, ClipboardList, User, Search, Loader2, LocateFixed } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { useZoneStore, type ZoneAction } from '../store/zoneStore';
import AccountGreeting from './AccountGreeting';

type View = 'home' | 'categories' | 'orders' | 'account';


interface NavbarProps {
  onUseMyLocation?: () => void | Promise<ZoneAction | void>;
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
    const triggerMyLocation = async () => {
      if (!onUseMyLocation || locationBusy) return;
      setZoneOpen(false);
      const result = await onUseMyLocation();
      // GPS never dead-ends: if it couldn't resolve a delivery area (no match,
      // blocked, unavailable or error) reopen the picker so the customer can
      // choose one manually from the dropdown.
      if (result && result.status !== 'applied' && result.status !== 'kept' && result.status !== 'busy') {
        setZoneOpen(true);
      }
    };
    // Only show dropdown if more than 1 zone
    if (zones.length <= 1) {
      if (!selectedZone) return null;
      return (
        <button type="button" onClick={triggerMyLocation} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
          {locationBusy
            ? <Loader2 className="w-6 h-6 text-yellow-400 flex-shrink-0 animate-spin" />
            : <MapPin className="w-6 h-6 text-yellow-400 flex-shrink-0" />}
          <div className="text-left">
            <p className="text-[8px] font-semibold text-white leading-none">Delivery zone</p>
            <p className="text-[13px] font-bold text-white leading-tight">
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
          ? <Loader2 className="w-6 h-6 text-yellow-400 flex-shrink-0 animate-spin" />
          : <MapPin className="w-6 h-6 text-yellow-400 flex-shrink-0" />}
        <div className="text-left">
          <p className="text-[8px] font-semibold text-white leading-none">Delivery zone</p>
          <p className="text-[13px] font-bold text-white leading-tight">
            {selectedZone ? selectedZone.name : 'Select area'}
          </p>
        </div>
        <ChevronDown className={`w-3 h-3 self-end mb-0.5 text-white/80 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
      </button>

      {zoneOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 max-h-[70vh] w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Delivery Areas</p>
            {onUseMyLocation && (
              <button onClick={triggerMyLocation} disabled={locationBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-slate-700">
                {locationBusy
                  ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-emerald-500" />
                  : <LocateFixed className="h-4 w-4 flex-shrink-0 text-emerald-500" />}
                <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{locationBusy ? 'Finding location...' : 'Use my location'}</span>
              </button>
            )}
            <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
            {zones.map(zone => (
              <button key={zone.id} onClick={() => selectZone(zone)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-700">
                <div className="min-w-0 text-left">
                  <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{zone.name}</p>
                  <p className="text-[10px] text-gray-500">{zone.radiusKm} km radius</p>
                </div>
                {selectedZone?.id === zone.id && <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" />}
              </button>
            ))}
            {zones.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No areas available</p>}
          </div>
        </>
      )}
    </div>
  );
  };

  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] bg-gradient-to-b from-[#218044] to-[#2e8b57] shadow-sm dark:from-[#18191a] dark:to-[#18191a]">

      {/* Row 1 — 56px (3.5rem), the same app-bar height as PageHeader, the
          Profile header and the OTP/brand bars so every header matches. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[56px] flex items-center gap-3">

        {/* Location / account identity — left */}
        <div className="flex items-center gap-1.5">
          {activeView === 'account' ? <AccountGreeting /> : <ZoneDropdown />}
        </div>

        {/* ── Desktop layout ── */}
        {/* Center: nav items + Cart */}
        <nav className="hidden sm:flex items-center gap-1 mx-auto">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  isActive ? 'text-white bg-white/20' : 'text-white/80 hover:bg-white/10'
                }`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
          {/* Cart in center */}
          <button onClick={onCheckout}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white/80 hover:bg-white/10 transition-colors">
            <ShoppingCart className="w-4 h-4" />
            Cart
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-emerald-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Row 2: Search — the Categories view owns its own category-scoped filter. */}
      {activeView !== 'account' && activeView !== 'orders' && activeView !== 'categories' && (
        <div className="sm:hidden px-4 py-1">
          <button type="button" onClick={onSearchOpen} className="relative w-full text-left">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-slate-700 dark:text-slate-200" />
            <span className="block w-full overflow-hidden whitespace-nowrap rounded-xl bg-gray-100 py-2.5 pl-10 pr-3 text-sm text-gray-500 transition-colors hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-1 dark:ring-slate-600 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text">{searchPrompt}</span></span>
          </button>
        </div>
      )}
    </header>
  );
}
