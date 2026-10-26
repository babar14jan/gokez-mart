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
    <nav className="mobile-bottom-nav relative z-40 border-t border-gray-200 bg-[#f7f8fa] dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-between px-5">
        {tabs.map(({ id, label, Icon }, index) => {
          const isActive = active === id;
          return (
            <Fragment key={id}>
              {index === 2 && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Fresh products"
                  className="flex flex-none items-center justify-center px-1 transition-transform duration-200 active:scale-95"
                >
                  <img src="/fresh_icon.webp" alt="" width={48} height={48} {...{ fetchpriority: 'high' }} decoding="async" className="nav-veg-icon object-contain" />
                </button>
              )}
              <button
                onClick={() => onChange(id)}
                className={`relative flex flex-none flex-col items-center justify-center gap-0.5 px-1 transition-colors duration-200 ${
                  isActive ? 'text-gokez-700 dark:text-gokez-300' : 'text-gray-500 hover:text-gokez-700 dark:text-slate-400 dark:hover:text-gokez-300'
                }`}
              >
                <Icon className="h-6 w-6" fill={id === 'account' && isActive ? 'currentColor' : 'none'} strokeWidth={isActive ? 2.4 : 2} />
                <span className={`whitespace-nowrap text-[12px] font-semibold ${isActive ? 'font-bold' : ''}`}>
                  {label}
                </span>
                {isActive && (
                  <span className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-gokez-700 dark:bg-gokez-400" />
                )}
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
