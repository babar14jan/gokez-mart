import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface SmartImageProps {
  src?: string | null;
  alt?: string;
  /** Sizing / shape for the placeholder box — the sizing the <img> used to carry. */
  className?: string;
  /** Extra classes for the <img> itself (object-fit, opacity, rounding of the photo). */
  imgClassName?: string;
  /** Shown instead of the photo when `src` is missing or the image fails to load. */
  fallback?: ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  fetchPriority?: 'high' | 'low' | 'auto';
  /** Fill an already-positioned parent (absolute inset-0) instead of sizing itself. */
  fill?: boolean;
}

// On the server (prerender) there is no DOM/paint, so the layout effect degrades
// to a no-op rather than warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * An <img> with a reserved box, a shimmering skeleton and a fade-in, so a photo
 * never "pops" in after a blank frame. The box is sized by `className`, so it
 * occupies its final space from the first paint and nothing below it shifts.
 *
 * Cached images are adopted before paint (via their `complete` flag) so a repeat
 * visit — the common case, since these photos were just shown on the home page —
 * never flashes the skeleton at all.
 */
export default function SmartImage({
  src,
  alt = '',
  className = '',
  imgClassName = '',
  fallback = null,
  loading = 'lazy',
  decoding = 'async',
  fetchPriority,
  fill = false,
}: SmartImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useIsoLayoutEffect(() => {
    setFailed(false);
    const img = imgRef.current;
    if (src && img && img.complete && img.naturalWidth > 0) setReady(true);
    else setReady(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  const box = fill ? 'absolute inset-0 block overflow-hidden' : 'relative block overflow-hidden';

  return (
    <span className={`${box} ${className}`}>
      <span
        aria-hidden="true"
        className={`absolute inset-0 block bg-gray-100 transition-opacity duration-300 dark:bg-slate-700 ${ready ? 'opacity-0' : 'animate-pulse opacity-100'}`}
      />
      <span className={`absolute inset-0 block transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
          className={`h-full w-full ${imgClassName}`}
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      </span>
    </span>
  );
}
