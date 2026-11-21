import { useState } from 'react';
import { ChevronDown, Check, Home, ShoppingCart, LayoutGrid, Package, User, Search, Loader2, LocateFixed } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { useZoneStore, type ZoneAction } from '../store/zoneStore';
import AccountGreeting from './AccountGreeting';
import ConfirmDialog from './ConfirmDialog';

type View = 'home' | 'categories' | 'orders' | 'account' | 'fresh';

interface NavbarProps {
  onUseMyLocation?: () => void | Promise<ZoneAction | void>;
  activeView: View;
  onNavChange: (v: View) => void;
  onCheckout: () => void;
  onSearchOpen: () => void;
  searchPrompt: string;
  /**
   * Driven by the app-wide useScrollChrome() hook (App.tsx) — NOT by a local
   * listener. Passing the shared boolean in is what guarantees the delivery
   * row flips in the same commit as the rest of the chrome.
   */
  deliveryHidden?: boolean;
  cartActive?: boolean;
}

interface ZoneDropdownProps {
  onUseMyLocation?: () => void | Promise<ZoneAction | void>;
}

function ZoneDropdown({ onUseMyLocation }: ZoneDropdownProps) {
  const zones = useZoneStore(s => s.zones);
  const selectedZone = useZoneStore(s => s.selectedZone);
  const locationBusy = useZoneStore(s => s.locating);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [pendingZone, setPendingZone] = useState<(typeof zones)[number] | null>(null);
  const [logoSource, setLogoSource] = useState<'webp' | 'png'>('webp');
  const [logoFailed, setLogoFailed] = useState(false);
  const totalItems = useCartStore(s => s.totalItems());
  const clearCart = useCartStore(s => s.clearCart);

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

  const zoneLogo = logoFailed ? (
    <Home
      className={`h-[26px] w-[26px] flex-shrink-0 text-gokez-700 ${locationBusy ? 'animate-pulse' : ''}`}
      aria-hidden="true"
    />
  ) : (
    <img
      src={logoSource === 'webp' ? '/icons/gokez_mart_nav.webp' : '/icons/gokez_mart_nav.png'}
      alt=""
      className={`h-[26px] w-[26px] flex-shrink-0 object-contain ${locationBusy ? 'animate-pulse' : ''}`}
      onError={() => {
        if (logoSource === 'webp') setLogoSource('png');
        else setLogoFailed(true);
      }}
    />
  );

  return (
    <>
      {zones.length <= 1 ? (
        selectedZone && (
          <button type="button" onClick={triggerMyLocation} className="flex min-w-0 items-center gap-1 hover:opacity-80 transition-opacity">
            {zoneLogo}
            <div className="min-w-0 text-left">
              <p className="text-[10px] font-semibold tracking-wide text-gokez-900/70 leading-none">Delivery Area</p>
              <p className="truncate text-[13px] font-bold text-gokez-900 leading-tight">
                {selectedZone.name}
              </p>
            </div>
          </button>
        )
      ) : (
        <div className="relative">
          <button onClick={() => setZoneOpen(o => !o)}
            className="flex min-w-0 items-center gap-1 hover:opacity-80 transition-opacity">
            {zoneLogo}
            <div className="min-w-0 text-left">
              <p className="text-[10px] font-semibold tracking-wide text-gokez-900/70 leading-none">Delivery Area</p>
              <p className="truncate text-[13px] font-bold text-gokez-900 leading-tight">
                {selectedZone ? selectedZone.name : 'Select area'}
              </p>
            </div>
            <ChevronDown className={`w-3 h-3 self-end mb-0.5 text-gokez-900/70 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
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
      )}

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

// Nav items — all including Cart and Profile in center
const navItems = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: Package },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function Navbar({ onUseMyLocation, activeView, onNavChange, onCheckout, onSearchOpen, searchPrompt, deliveryHidden = false, cartActive = false }: NavbarProps) {
  const totalItems = useCartStore(s => s.totalItems());

  return (
    <>
    {/* Fixed header band: AppShell renders this ABOVE the scroller, so it
        never scrolls with the page. `relative z-40` (not sticky) — it is a
        flex child of the frame now, and the z-index keeps it above in-page
        sticky content (search rows, cards) that pin at top-0 of the scroller. */}
    <header className={`relative z-40 border-b border-[#7bd69a] bg-[#ADFBBD] pt-[env(safe-area-inset-top)] shadow-sm ${deliveryHidden ? 'band-collapsed' : ''}`}>

      {/* Row 1 — 44px (2.75rem), the same app-bar height as PageHeader and the
          Profile header so every header matches.

          Auto-hide: the row's height is written per scroll event as the
          --band-collapse custom property (useScrollChrome), so it leaves and
          returns in step with the finger instead of on a timer — this row is
          in flow above the scroller, so a timed collapse moved the page
          content (a 44px bump under a centred product card). The row is
          clipped, not unmounted, so the zone dropdown keeps its state, and
          desktop pins it open: the centred nav pills live in this row. */}
      <div className="band-delivery grid">
        <div className="band-slide min-h-0 overflow-hidden">
          <div className="mx-auto flex min-h-[44px] max-w-6xl items-center gap-3 page-x">

            {/* Location / account identity — left. flex-1 + min-w-0 gives it half of
                the free space so the centred nav never moves when the identity
                changes width (zone picker vs. account greeting). */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className={`min-w-0 ${activeView === 'account' ? 'hidden' : 'flex items-center'}`}>
                <ZoneDropdown onUseMyLocation={onUseMyLocation} />
              </div>
              {activeView === 'account' && <AccountGreeting />}
            </div>

            {/* ── Desktop layout ── */}
            {/* Center: nav items + Cart. Pinned to the container centre by the two
                equal-width side slots so the nav is stable across views. */}
            <nav className="hidden sm:flex shrink-0 items-center gap-1">
              {navItems.map(({ id, label, Icon }) => {
                const isActive = activeView === id;
                return (
                  <button key={id} onClick={() => onNavChange(id)} aria-label={label}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-700/50 lg:px-4 ${
                      isActive ? 'bg-gokez-700 text-white shadow-sm' : 'text-gokez-900/75 hover:bg-white/35 hover:text-gokez-950'
                    }`}>
                    <Icon className="w-4 h-4" />
                    <span className="hidden lg:inline">{label}</span>
                  </button>
                );
              })}
              {/* Cart in center */}
              <button onClick={onCheckout} aria-label="Cart"
                className={`relative ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-700/50 lg:px-4 ${
                  cartActive ? 'bg-gokez-700 font-bold text-white shadow-sm' : 'font-semibold text-gokez-900/75 hover:bg-white/35 hover:text-gokez-950'
                }`}>
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
        </div>
      </div>

      {/* Pages that own a search row in the band (Fresh, Categories, Orders) portal it
          into this slot, so it sits where Home's row 2 sits — full-bleed,
          outside the scroller (no scrollbar indicator can overlap it), and it
          stays put while the delivery row collapses. The band's own
          border/shadow then closes the green section, same as on Home. */}
      {(activeView === 'fresh' || activeView === 'categories' || activeView === 'orders') && <div id="band-search-slot" />}

      {/* Row 2: Search — the Categories view owns its own category-scoped filter. */}
      {activeView !== 'account' && activeView !== 'orders' && activeView !== 'categories' && activeView !== 'fresh' && (
        <div className="band-row sm:hidden page-x pb-1">
          <button type="button" onClick={onSearchOpen} className="relative block w-full text-left">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[2.5] text-gray-900 dark:text-white" />
            <span className="block w-full overflow-hidden whitespace-nowrap rounded-xl border border-gokez-400 bg-white py-2.5 pl-10 pr-3 text-base leading-5 text-gray-700 shadow-sm transition-colors hover:bg-cream-50 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"><span key={searchPrompt} className="search-prompt-text">{searchPrompt}</span></span>
          </button>
        </div>
      )}
    </header>
    </>
  );
}
