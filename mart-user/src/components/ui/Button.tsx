import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'offer';
type Size = 'xs' | 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: 'bg-gokez-700 text-white hover:bg-gokez-800 shadow-sm',
  secondary: 'border border-gokez-200 bg-white text-gokez-800 hover:border-gokez-300 hover:bg-gokez-50 dark:border-gokez-800 dark:bg-slate-800 dark:text-white dark:hover:bg-gokez-900/30',
  ghost: 'text-gokez-700 hover:bg-gokez-50 dark:text-white dark:hover:bg-gokez-900/30',
  offer: 'bg-saffron-400 text-saffron-900 hover:bg-saffron-300 shadow-sm',
};

const sizes: Record<Size, string> = {
  xs: "relative h-8 rounded-full px-3 text-xs !font-bold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
  sm: 'h-9 rounded-full px-3.5 text-xs',
  md: 'h-11 rounded-xl px-4 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
