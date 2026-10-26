import type { ReactNode } from 'react';

type Tone = 'green' | 'saffron' | 'neutral' | 'danger';

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

const tones: Record<Tone, string> = {
  green: 'bg-gokez-100 text-gokez-800 dark:bg-gokez-900/40 dark:text-gokez-200',
  saffron: 'bg-saffron-400 text-saffron-900',
  neutral: 'bg-cream-100 text-ink/70 dark:bg-slate-700 dark:text-slate-200',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
};

export default function Badge({ children, tone = 'green', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold leading-none ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
