import { type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface PageHeaderProps {
  /** Heading text. Omit for a bar that holds only controls (e.g. search). */
  title?: string;
  /** Optional second line under the title (combo/deal sheets). */
  subtitle?: string;
  /** Back action. Defaults to history.back() when omitted. */
  onBack?: () => void;
  /** Accessible label for the back button. */
  backLabel?: string;
  /** 'standard' = 56px title bar; 'sheet' = 64px bar with room for a search field or controls. */
  size?: 'standard' | 'sheet';
  /** 'sticky' pins to the top with z-20 (sub-pages, checkout); 'static' stays in flow (sheets, overlays). */
  position?: 'sticky' | 'static';
  /** Gradient direction — 'b' (default) is the app standard; 'r' for the profile/login bars. */
  gradient?: 'b' | 'r';
  /** Back-button shape: 'round' (title bars) or 'square' (sheet/checkout). */
  backStyle?: 'round' | 'square';
  /** Back-button size for the 'square' variant only. */
  backSize?: 'sm' | 'md';
  /** Dark-mode gradient tail. The login flow uses a dark green instead of flat black. */
  darkTo?: '#18191a' | '#14532d';
  /** Optional leading icon badge (combo/deal sheets). */
  icon?: ReactNode;
  /** Extra inline content after the title (search input, cart button, …). */
  children?: ReactNode;
}

// Single source of truth for the green app bar. Every page/sheet header renders
// through this so the colour, height and back-button stay identical everywhere.
//
// NOTE: every Tailwind class below is a full static string. Tailwind's JIT only
// scans for literal class names, so building them via interpolation
// using template interpolation would silently drop them from the CSS bundle.
export default function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  size = 'standard',
  position = 'sticky',
  gradient = 'b',
  backStyle = 'round',
  backSize = 'md',
  darkTo = '#18191a',
  icon,
  children,
}: PageHeaderProps) {
  const goBack = () => (onBack ? onBack() : window.history.back());

  const positionClass = position === 'sticky' ? 'sticky top-0 z-20' : '';
  const sizeClass =
    size === 'sheet'
      ? 'min-h-[calc(64px_+_env(safe-area-inset-top))] gap-3 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]'
      : 'min-h-[calc(3.5rem+env(safe-area-inset-top))] gap-1 px-2 pt-[env(safe-area-inset-top)]';
  const gradientClass =
    gradient === 'r' ? 'bg-gradient-to-r from-[#09623a] to-[#087a43]' : 'bg-gradient-to-b from-[#09623a] to-[#087a43]';
  const darkClass = darkTo === '#14532d' ? 'dark:from-[#18191a] dark:to-[#14532d]' : 'dark:from-[#18191a] dark:to-[#18191a]';

  const backClass =
    backStyle === 'square'
      ? backSize === 'sm'
        ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
        : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
      : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

  return (
    <div className={`${positionClass} flex shrink-0 items-center ${sizeClass} ${gradientClass} ${darkClass}`}>
      <button type="button" onClick={goBack} aria-label={backLabel} className={backClass}>
        <ChevronLeft
          className={backStyle === 'square' ? 'h-7 w-7' : 'h-6 w-6'}
          strokeWidth={backStyle === 'square' ? 2.5 : undefined}
        />
      </button>

      {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">{icon}</span>}

      {title && (
        <div className="min-w-0 flex-1">
          <h1 className="min-w-0 truncate text-base font-bold text-white">{title}</h1>
          {subtitle && <p className="truncate text-xs text-white/80">{subtitle}</p>}
        </div>
      )}

      {children}
    </div>
  );
}
