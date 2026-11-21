import { useState } from 'react';
import { Home } from 'lucide-react';

interface GokezMarkIconProps {
  className?: string;
  filled?: boolean;
}

export default function GokezMarkIcon({ className = '', filled = false }: GokezMarkIconProps) {
  const [source, setSource] = useState<'webp' | 'png'>('webp');
  const [failed, setFailed] = useState(false);
  const iconClass = `${className} ${filled ? 'opacity-100' : 'opacity-75'}`;

  if (failed) return <Home className={iconClass} />;

  return (
    <img
      src={source === 'webp' ? '/icons/gokez_mart_nav.webp' : '/icons/gokez_mart_nav.png'}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={iconClass}
      onError={() => {
        if (source === 'webp') setSource('png');
        else setFailed(true);
      }}
    />
  );
}
