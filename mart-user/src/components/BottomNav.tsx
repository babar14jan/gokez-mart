import { Fragment } from 'react';
import { Store, LayoutGrid, Package, User } from 'lucide-react';

type NavView = 'home' | 'categories' | 'orders' | 'account';

interface BottomNavProps {
  active: NavView;
  onChange: (v: NavView) => void;
  onOpenSearch: () => void;
}

const tabs = [
  { id: 'home',       label: 'Home',       Icon: Store },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: Package },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function BottomNav({ active, onChange, onOpenSearch }: BottomNavProps) {

  return (
    <nav className="mobile-bottom-nav relative z-40 bg-white dark:bg-slate-900 border-t border-white dark:border-slate-800">
      <div className="flex items-stretch justify-between h-16 max-w-lg mx-auto px-5">
        {tabs.map(({ id, label, Icon }, index) => {
          const isActive = active === id;
          return (
            <Fragment key={id}>
              {/* Fresh — transparent asset, icon-only, sized larger than the labelled tabs. */}
              {index === 2 && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Vegetables"
                  className="flex-none flex items-center justify-center px-1 transition-transform duration-200 active:scale-95"
                >
                  <img src="/fresh_icon.webp" alt="Vegetables" width={48} height={48} {...{ fetchpriority: 'high' }} decoding="async" className="nav-veg-icon object-contain" />
                </button>
              )}
              <button
                onClick={() => onChange(id)}
                className={`flex-none flex flex-col items-center justify-center gap-0.5 relative px-1 transition-all duration-200
                  ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" fill={id === 'home' || id === 'orders' ? 'none' : isActive ? 'currentColor' : 'none'} strokeWidth={id === 'home' || id === 'orders' ? isActive ? 2.5 : 2 : isActive ? 1.5 : 2} />
                </div>
                <span className={`whitespace-nowrap text-[12px] font-semibold ${isActive ? 'font-bold text-emerald-800 dark:text-emerald-300' : ''}`}>
                  {label}
                </span>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />
                )}
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
