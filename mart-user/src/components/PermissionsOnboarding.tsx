import { useEffect, useRef } from 'react';
import { Bell, ChevronRight, MapPin, type LucideIcon } from 'lucide-react';

interface PermissionsOnboardingProps {
  onAllow: () => Promise<void> | void;
  onMaybeLater: () => void;
}

interface PermissionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function PermissionCard({ icon: Icon, title, description }: PermissionCardProps) {
  return (
    <div className="flex gap-3 rounded-2xl bg-white p-3.5 shadow-[0_12px_32px_-20px_rgba(8,122,67,0.45)] ring-1 ring-black/5 sm:p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F0FAF1] text-[#087A43] ring-1 ring-[#087A43]/10">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="text-[14px] font-bold leading-snug text-slate-900 sm:text-[15px]">{title}</h2>
        <p className="mt-1 text-[12px] font-semibold leading-snug text-[#087A43] sm:text-[13px]">{description}</p>
      </div>
    </div>
  );
}

export default function PermissionsOnboarding({ onAllow, onMaybeLater }: PermissionsOnboardingProps) {
  const allowRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const action = actionRef.current;
    const section = sectionRef.current;
    if (!action || !section) return;
    const update = () => section.style.setProperty('--onboarding-action-height', `${Math.ceil(action.getBoundingClientRect().height)}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(action);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const handleAllow = () => {
    if (allowRef.current) return;
    allowRef.current = true;
    void Promise.resolve(onAllow()).catch(() => {});
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="permissions-heading"
      className="relative flex h-full flex-col overflow-hidden bg-[#ADFBBD]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#ADFBBD] to-transparent" aria-hidden="true" />
      <button
        type="button"
        onClick={onMaybeLater}
        className="permissions-later-button absolute z-30 inline-flex min-h-9 items-center gap-0.5 rounded-full bg-[#9AEFAF] px-3 text-xs font-bold text-[#087A43] shadow-sm ring-1 ring-[#087A43]/20 transition-colors hover:bg-[#8CE6A3] active:bg-[#7EDD96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A43] focus-visible:ring-offset-2 dark:bg-[#9AEFAF] dark:text-[#087A43] dark:ring-[#087A43]/20 sm:min-h-10 sm:px-4 sm:text-sm"
      >
        Maybe Later<ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="onboarding-scroll relative mx-auto h-full w-full max-w-sm overflow-y-auto px-4 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:px-6">
        <div className="flex min-h-full flex-col justify-center">
          <header className="shrink-0 text-center">
            <h1 id="permissions-heading" className="mx-auto max-w-sm text-[20px] font-extrabold leading-tight text-slate-900 sm:text-[22px]">
              Daily Freshness From Neighbourhoods Local Shops
            </h1>
            <div className="mx-auto mt-4 h-1.5 w-12 rounded-full bg-[#F4C400]" aria-hidden="true" />
          </header>

          <div className="mt-4 space-y-2.5 pb-1">
            <PermissionCard
              icon={MapPin}
              title="Fresh picks, and local deals-right from shops near you"
              description="Enable location access"
            />
            <PermissionCard
              icon={Bell}
              title="Order updates, price drops, flash sales, deals and new arrivals"
              description="Turn on notifications and offers"
            />
          </div>
          <p className="mt-3 px-1 text-center text-[11px] font-medium leading-snug text-[#087A43]/75">
            You can turn off any permission anytime from Account → Settings.
          </p>
        </div>
      </div>

      <div ref={actionRef} className="onboarding-action-bar">
        <button
          type="button"
          onClick={handleAllow}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#087A43] px-5 py-3 text-[15px] font-extrabold text-white shadow-lg shadow-[#087A43]/20 transition-colors hover:bg-[#076a39] active:bg-[#065d32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A43] focus-visible:ring-offset-2"
        >
          Allow &amp; Continue
        </button>
      </div>
    </section>
  );
}
