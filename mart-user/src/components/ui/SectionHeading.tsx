import type { ReactNode } from 'react';

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export default function SectionHeading({ title, subtitle, action, className = '' }: SectionHeadingProps) {
  return (
    <div className={`mb-3 flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-balance text-[17px] font-bold tracking-tight text-ink dark:text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-micro text-gray-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
