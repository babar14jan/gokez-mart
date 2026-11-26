interface OrderPackageIconProps {
  className?: string;
  filled?: boolean;
}

export default function OrderPackageIcon({ className = '', filled = false }: OrderPackageIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {filled ? (
        <>
          <path d="M12 2 22 8 12 12 2 8Z" fill="currentColor" />
          <path d="M2 8.8 11.2 12.8V22L2 17.2Z" fill="currentColor" />
          <path d="M12.8 12.8 22 8.8V17.2L12.8 22Z" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="m7.5 4.27 9 5.15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m3.3 7 8.7 5 8.7-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 22V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
