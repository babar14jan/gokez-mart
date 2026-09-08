import { Home, LayoutGrid, ClipboardList, User } from 'lucide-react';

type NavView = 'home' | 'categories' | 'orders' | 'account';

interface BottomNavProps {
  active: NavView;
  onChange: (v: NavView) => void;
}

const tabs = [
  { id: 'home',       label: 'Home',       Icon: Home },
  { id: 'categories', label: 'Categories', Icon: LayoutGrid },
  { id: 'orders',     label: 'Orders',     Icon: ClipboardList },
  { id: 'account',    label: 'Account',    Icon: User },
] as const;

export default function BottomNav({ active, onChange }: BottomNavProps) {

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 safe-area-pb">
      <div className="flex items-stretch h-20 max-w-lg mx-auto">
        {tabs.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors
                ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-slate-500'}`}
            >
              <div className="relative">
                <Icon className={`w-6 h-6 transition-transform ${isActive ? 'scale-110' : ''}`} />
              </div>
              <span className={`text-[11px] font-semibold ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                {label}
              </span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
