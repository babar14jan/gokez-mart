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
      <div className="flex items-stretch justify-between h-20 max-w-lg mx-auto px-2">
        {tabs.map(({ id, label, Icon }, index) => {
          const isActive = active === id;
          return (
            <Fragment key={id}>
              {/* Fresh — bigger image than the tab icons, anchored to the same icon baseline so the label stays in line. */}
              {index === 2 && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Vegetables"
                  className="flex-none flex flex-col items-center justify-center gap-0.5 relative px-1 transition-all duration-200"
                >
                  <div className="relative flex h-6 w-6 items-center justify-center">
                    <img src="/Fresh.png" alt="Vegetables" className="absolute bottom-0 left-1/2 h-10 w-auto max-w-none -translate-x-1/2 bg-white object-contain" />
                  </div>
                  <span className="whitespace-nowrap text-[12px] font-semibold text-gray-500 dark:text-slate-400">Vegetables</span>
                </button>
              )}
              <button
                onClick={() => onChange(id)}
                className={`flex-none flex flex-col items-center justify-center gap-0.5 relative px-1 transition-all duration-200
                  ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}
              >
                <div className="relative">
                  <Icon className="w-6 h-6" />
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
