interface CategoryGridIconProps {
  className?: string;
  filled?: boolean;
}

export default function CategoryGridIcon({ className = '', filled = false }: CategoryGridIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.2" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="3" width="7" height="7" rx="1.2" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
      <rect x="3" y="14" width="7" height="7" rx="1.2" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
      <rect x="14" y="14" width="7" height="7" rx="1.2" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
