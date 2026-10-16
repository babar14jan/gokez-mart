import { ChevronLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
}

// Shared header for the secondary Account/Profile sub-pages (feedback, grievance,
// privacy, terms, delete account). Matches the Profile and Checkout headers so
// these screens show one green app bar instead of the browsing Navbar (with its
// delivery-zone selector) stacked above a second page header.
export default function PageHeader({ title, onBack }: PageHeaderProps) {
  const goBack = () => (onBack ? onBack() : window.history.back());
  return (
    <div className="sticky top-0 z-20 flex min-h-[calc(4rem+env(safe-area-inset-top))] items-center gap-1 bg-gradient-to-b from-[#218044] to-[#2e8b57] px-2 pt-[env(safe-area-inset-top)] dark:from-[#18191a] dark:to-[#18191a]">
      <button
        type="button"
        onClick={goBack}
        aria-label="Back"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <h1 className="text-base font-bold text-white">{title}</h1>
    </div>
  );
}
