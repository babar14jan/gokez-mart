import { useState } from 'react';

/**
 * True when the primary pointer can hover, false on touch.
 *
 * autoFocus on a text input is a desktop convenience. On a phone it opens the
 * keyboard the instant the field mounts, and the browser then scrolls that field
 * into view -- on a full-height page that reads as the page jumping or shaking
 * on arrival, which is exactly the instability this gates. Mobile therefore
 * waits for a deliberate tap.
 *
 * Resolved once on mount. A hybrid laptop that later switches to touch keeps the
 * desktop behaviour, which is the safe direction to be wrong in: nothing breaks,
 * the keyboard just does not spring open by itself.
 */
export function useFinePointer(): boolean {
  const [fine] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: fine)').matches,
  );
  return fine;
}