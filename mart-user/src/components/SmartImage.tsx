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

// Session-lifetime memory of images that have painted at least once. Browsers do
// not reliably report `img.complete` for an already-cached image (WebKit in
// particular), so remounting a component would otherwise flash its skeleton even
// though the pixels are sitting in the HTTP cache — which reads as the whole list
// flickering every time you navigate. This lets a repeat visit paint instantly.
const loadedSrcs = new Set<string>();

/**
 * An <img> with a reserved box and a static placeholder, so a photo never "pops"
 * in after a blank frame and nothing below it shifts. The box is sized by
 * `className`, so it occupies its final space from the first paint.
 *
 * The placeholder never animates (no pulse), and images that have already loaded
 * in this session skip both the placeholder and the fade entirely.
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
  const [ready, setReady] = useState(() => !!src && loadedSrcs.has(src));
  const [failed, setFailed] = useState(false);

  useIsoLayoutEffect(() => {
    setFailed(false);
    const img = imgRef.current;
    if (!src) {
      setReady(false);
      return;
    }
    if (loadedSrcs.has(src) || (img && img.complete && img.naturalWidth > 0)) {
      loadedSrcs.add(src);
      setReady(true);
    } else {
      setReady(false);
    }
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  const box = fill ? 'absolute inset-0 block overflow-hidden' : 'relative block overflow-hidden';
  const known = loadedSrcs.has(src);

  return (
    <span className={`${box} ${className}`}>
      <span
        aria-hidden="true"
        className={`absolute inset-0 block bg-gray-100 dark:bg-slate-700 ${ready ? 'opacity-0' : 'opacity-100'}`}
      />
      <span className={`absolute inset-0 block ${ready ? 'opacity-100' : 'opacity-0'} ${ready && known ? '' : 'transition-opacity duration-300'}`}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
          className={`h-full w-full ${imgClassName}`}
          onLoad={() => {
            loadedSrcs.add(src);
            setReady(true);
          }}
          onError={() => setFailed(true)}
        />
      </span>
    </span>
  );
}
