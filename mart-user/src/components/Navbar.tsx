import { useState } from 'react';
import { MapPin, ChevronDown, Check, Home, ShoppingCart, LayoutGrid, ClipboardList, User } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import type { MartZone } from '../services/api';

type View = 'home' | 'categories' | 'orders' | 'account';

interface NavbarProps {
  zones: MartZone[];
  selectedZone: MartZone | null;
  onZoneChange: (zone: MartZone) => void;
  activeView: View;
  onNavChange: (v: View) => void;
}

const navItems = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function Navbar({ zones, selectedZone, onZoneChange, activeView, onNavChange }: NavbarProps) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const totalItems = useCartStore(s => s.totalItems());

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">

        {/* Logo */}
        <img src="/mart_web_logo.png?v=2" alt="Gokez Mart" className="h-8 w-40 sm:h-11 sm:w-56 object-contain object-left flex-shrink-0" />

        {/* Desktop nav items — hidden on mobile */}
        <nav className="hidden sm:flex items-center gap-1">
          {navItems.map(({ id, label, Icon }) => {
            const isActive = activeView === id;
            return (
              <button key={id} onClick={() => onNavChange(id)}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors
                  ${isActive ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
          {/* Cart button — desktop */}
          <button onClick={() => onNavChange('categories' as any)}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800">
            <ShoppingCart className="w-4 h-4" />
            Cart
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-emerald-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                {totalItems > 9 ? '9+' : totalItems}
              </span>
            )}
          </button>
        </nav>

        {/* Zone selector */}
        <div className="relative flex-shrink-0">
          <button onClick={() => setZoneOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
            <MapPin className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <span className="text-xs text-gray-400 dark:text-slate-500 font-medium">Deliver to</span>
            <span className="text-xs font-bold text-gray-900 dark:text-white truncate max-w-[90px]">
              {selectedZone ? selectedZone.name : 'Select area'}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${zoneOpen ? 'rotate-180' : ''}`} />
          </button>

          {zoneOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setZoneOpen(false)} />
              <div className="absolute top-full mt-1 right-0 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-700 py-2 z-20">
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
      </div>
    </header>
  );
}
