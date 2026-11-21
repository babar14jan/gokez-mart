import { useState } from 'react';
import { Home } from 'lucide-react';

interface GokezMarkIconProps {
  className?: string;
  filled?: boolean;
}

export default function GokezMarkIcon({ className = '', filled = false }: GokezMarkIconProps) {
  const [failed, setFailed] = useState(false);
  const iconClass = `${className} ${filled ? 'opacity-100' : 'opacity-75'}`;

  if (failed) return <Home className={iconClass} />;

  return (
    <img
      src="/icons/gokez_mart_nav.webp"
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={iconClass}
      onError={() => setFailed(true)}
    />
  );
}
