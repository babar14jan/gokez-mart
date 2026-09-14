import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, ClipboardList, User, Search, X } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
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

const navItems = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Profile',    Icon: User },
] as const;

export default function Navbar({ zones, selectedZone, onZoneChange, activeView, onNavChange, onCheckout, search, onSearch }: NavbarProps) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const totalItems = useCartStore(s => s.totalItems());

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-slate-900 shadow-sm">

      {/* Row 1: Logo + Location + Desktop nav */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-3">

        {/* Logo */}
        <img src="/mart_web_logo.png?v=2" alt="Gokez Mart"
          className="h-8 w-32 sm:h-10 sm:w-44 object-contain object-left flex-shrink-0" />

        {/* Zone selector — prominent on mobile */}
        <div className="relative flex-1 sm:flex-none">
          <button onClick={() => setZoneOpen(o => !o)}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity">
            <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <div className="text-left">
              <p className="text-[9px] text-gray-400 dark:text-slate-500 leading-none">Delivery in</p>
              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight truncate max-w-[100px]">
                {selectedZone ? selectedZone.name : 'Select area'}
              </p>
            </div>
            <ChevronDown className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${zoneOpen ? 'rotate-180' : ''}`} />
          </button>

          {zoneOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
              <div className="absolute top-full mt-1 left-0 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-2 z-20">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 pb-1.5">Delivery Areas</p>
                {zones.map(zone => (
                  <button key={zone.id} onClick={() => { onZoneChange(zone); setZoneOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{zone.name}</p>
                      <p className="text-[10px] text-gray-400">{zone.radiusKm}km radius</p>
                    </div>
                    {selectedZone?.id === zone.id && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  </button>
                ))}
                {zones.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">No areas available</p>}
              </div>
            </>
          )}
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1 ml-auto">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  isActive ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
          <button onClick={onCheckout}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
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

      {/* Row 2: Search bar — mobile only */}
      <div className="sm:hidden px-4 pb-2.5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search groceries, vegetables..."
            className="w-full pl-10 pr-9 py-2.5 bg-gray-100 dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white dark:focus:bg-slate-700 transition-all border-0"
          />
          {search && (
            <button onClick={() => onSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom border */}
      <div className="border-b border-gray-100 dark:border-slate-800" />
    </header>
  );
}
