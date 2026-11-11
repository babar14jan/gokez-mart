import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, Package, User, Search, Loader2, LocateFixed } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { useZoneStore, type ZoneAction } from '../store/zoneStore';
import AccountGreeting from './AccountGreeting';
import ConfirmDialog from './ConfirmDialog';

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
  { id: 'orders',     label: 'Orders',     Icon: Package },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

  export default function Navbar({ onUseMyLocation, activeView, onNavChange, onCheckout, onSearchOpen, searchPrompt }: NavbarProps) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const [pendingZone, setPendingZone] = useState<(typeof zones)[number] | null>(null);
  const totalItems = useCartStore(s => s.totalItems());
  const clearCart = useCartStore(s => s.clearCart);
  // Delivery-area state is shared app-wide via the zone store, so the navbar
  // picker, the Account page toggle and the catalog loader always stay in sync.
  const zones = useZoneStore(s => s.zones);
  const selectedZone = useZoneStore(s => s.selectedZone);
  const locationBusy = useZoneStore(s => s.locating);

  const selectZone = (zone: (typeof zones)[number]) => {
    if (zone.id !== selectedZone?.id && totalItems > 0) {
      setPendingZone(zone);
      setZoneOpen(false);
      return;
    }
    useZoneStore.getState().chooseZone(zone);
    setZoneOpen(false);
  };

  const confirmZoneChange = () => {
    if (!pendingZone) return;
    clearCart();
    useZoneStore.getState().chooseZone(pendingZone);
    setPendingZone(null);
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
        <button type="button" onClick={triggerMyLocation} className="flex min-w-0 items-center gap-1 hover:opacity-80 transition-opacity">
          {locationBusy
            ? <Loader2 className="h-5 w-5 text-saffron-300 flex-shrink-0 animate-spin" />
            : <MapPin className="h-5 w-5 text-saffron-300 flex-shrink-0" />}
          <div className="min-w-0 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70 leading-none">Delivery area</p>
            <p className="truncate text-sm font-bold text-white leading-tight">
              {selectedZone.name}
            </p>
          </div>
        </button>
      );
    }
    return (
    <div className="relative">
      <button onClick={() => setZoneOpen(o => !o)}
        className="flex min-w-0 items-center gap-1 hover:opacity-80 transition-opacity">
        {locationBusy
          ? <Loader2 className="h-5 w-5 text-saffron-300 flex-shrink-0 animate-spin" />
          : <MapPin className="h-5 w-5 text-saffron-300 flex-shrink-0" />}
        <div className="min-w-0 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70 leading-none">Delivery area</p>
          <p className="truncate text-sm font-bold text-white leading-tight">
            {selectedZone ? selectedZone.name : 'Select area'}
          </p>
        </div>
        <ChevronDown className={`w-3 h-3 self-end mb-0.5 text-white/80 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
      </button>

      {zoneOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 max-h-[70vh] w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-cream-200 bg-white py-1.5 shadow-lift dark:border-slate-700 dark:bg-slate-800">
            <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">Delivery areas</p>
            {onUseMyLocation && (
              <button onClick={triggerMyLocation} disabled={locationBusy}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gokez-50 disabled:opacity-60 dark:hover:bg-slate-700">
                {locationBusy
                  ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-gokez-700" />
                  : <LocateFixed className="h-4 w-4 flex-shrink-0 text-gokez-700" />}
                <span className="text-label font-semibold text-gray-900 dark:text-white">{locationBusy ? 'Finding location...' : 'Use my location'}</span>
              </button>
            )}
            <div className="my-1 border-t border-cream-200 dark:border-slate-700" />
            {zones.map(zone => (
              <button key={zone.id} onClick={() => selectZone(zone)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gokez-50 dark:hover:bg-slate-700">
                <div className="min-w-0 text-left">
                  <p className="truncate text-label font-semibold text-gray-900 dark:text-white">{zone.name}</p>
                  <p className="text-[11px] text-gray-500">{zone.radiusKm} km radius</p>
                </div>
                {selectedZone?.id === zone.id && <Check className="h-4 w-4 flex-shrink-0 text-gokez-700" />}
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
    <>
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gokez-700 pt-[env(safe-area-inset-top)] shadow-sm dark:border-slate-800 dark:bg-[#18191a]">

      {/* Row 1 — 56px (3.5rem), the same app-bar height as PageHeader, the
          Profile header and the OTP/brand bars so every header matches. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[56px] flex items-center gap-3">

        {/* Location / account identity — left. flex-1 + min-w-0 gives it half of
            the free space so the centred nav never moves when the identity
            changes width (zone picker vs. account greeting). */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {activeView === 'account' ? <AccountGreeting /> : <ZoneDropdown />}
        </div>

        {/* ── Desktop layout ── */}
        {/* Center: nav items + Cart. Pinned to the container centre by the two
            equal-width side slots so the nav is stable across views. */}
        <nav className="hidden sm:flex shrink-0 items-center gap-1">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)} aria-label={label}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 lg:px-4 ${
                  isActive ? 'bg-white text-gokez-800 shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}>
                <Icon className="w-4 h-4" />
                <span className="hidden lg:inline">{label}</span>
              </button>
            );
          })}
          {/* Cart in center */}
          <button onClick={onCheckout} aria-label="Cart"
            className="relative ml-1 flex items-center gap-1.5 rounded-full bg-saffron-400 px-3 py-2 text-sm font-bold text-saffron-900 shadow-sm transition-colors hover:bg-saffron-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 lg:px-4">
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden lg:inline">Cart</span>
            {totalItems > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-gokez-800 shadow-sm">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </button>
        </nav>

        {/* Right slot — balances the left identity so the nav stays centred.
            Empty by design; never renders content. */}
        <div className="hidden flex-1 sm:block" aria-hidden="true" />
      </div>

      {/* Row 2: Search — the Categories view owns its own category-scoped filter. */}
      {activeView !== 'account' && activeView !== 'orders' && activeView !== 'categories' && (
        <div className="sm:hidden px-4 py-1">
          <button type="button" onClick={onSearchOpen} className="relative w-full text-left">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-gokez-700 dark:text-slate-200" />
            <span className="block w-full overflow-hidden whitespace-nowrap rounded-xl border border-white/70 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-500 shadow-sm transition-colors hover:bg-cream-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text">{searchPrompt}</span></span>
          </button>
        </div>
      )}
    </header>
    {pendingZone && (
      <ConfirmDialog
        title="Change delivery area?"
        message={`Your cart was built for ${selectedZone?.name || 'the current area'}. Switching to ${pendingZone.name} will clear it because products and prices can differ by area.`}
        confirmLabel="Change and clear cart"
        cancelLabel="Keep current area"
        danger={false}
        onConfirm={confirmZoneChange}
        onCancel={() => setPendingZone(null)}
      />
    )}
    </>
  );
}
