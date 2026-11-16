import { Fragment } from 'react';
import { Home, LayoutGrid, Package, User } from 'lucide-react';

type NavView = 'home' | 'categories' | 'orders' | 'account';

interface BottomNavProps {
  active: NavView;
  onChange: (v: NavView) => void;
  onOpenSearch: () => void;
  freshActive?: boolean;
}

const tabs = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: Package },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function BottomNav({ active, onChange, onOpenSearch, freshActive = false }: BottomNavProps) {

  return (
    <nav className="mobile-bottom-nav relative z-40 border-t border-gray-200 bg-[#f7f8fa] dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-5 pb-2">
        {tabs.map(({ id, label, Icon }, index) => {
          const isActive = active === id;
          return (
            <Fragment key={id}>
              {index === 2 && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Fresh products"
                  className="relative flex flex-none items-center justify-center px-1 transition-transform duration-200 active:scale-95"
                >
                  {freshActive && (
                    <span className="absolute inset-0 m-auto h-[54px] w-[54px] rounded-full border-[5px] border-green-600 dark:border-green-500" aria-hidden="true" />
                  )}
                  <img src="/fresh_icon.webp" alt="" width={freshActive ? 44 : 54} height={freshActive ? 44 : 54} {...{ fetchpriority: 'high' }} decoding="async" className="nav-veg-icon object-contain" />
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
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
