import { Fragment } from 'react';
import { Home, LayoutGrid, ClipboardList, User } from 'lucide-react';

type NavView = 'home' | 'categories' | 'orders' | 'account';

interface BottomNavProps {
  active: NavView;
  onChange: (v: NavView) => void;
  onOpenSearch: () => void;
}

const tabs = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function BottomNav({ active, onChange, onOpenSearch }: BottomNavProps) {

  return (
    <nav className="mobile-bottom-nav relative z-40 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
      <div className="flex items-stretch h-20 max-w-lg mx-auto">
        {tabs.map(({ id, label, Icon }, index) => {
          const isActive = active === id;
          return (
            <Fragment key={id}>
              {/* Fresh — transparent PNG (image carries its own icon + name), centered, opens the search page (all products). */}
              {index === 2 && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Fresh"
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all duration-200"
                >
                  <img src="/fresh_vegi.png" alt="Fresh" width={56} height={56} className="h-14 w-14 object-contain" />
                </button>
              )}
              <button
                onClick={() => onChange(id)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all duration-200
                  ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" />
                </div>
                <span className={`text-[11px] font-semibold ${isActive ? 'font-bold text-emerald-800 dark:text-emerald-300' : ''}`}>
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
