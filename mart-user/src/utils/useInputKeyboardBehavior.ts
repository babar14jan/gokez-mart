import { useCallback } from 'react';

/**
 * Reusable focus/blur handlers for mobile text inputs that open the on-screen
 * keyboard. Mirrors LoginFlow's behaviour so the keyboard collapse feels smooth
 * across forms.
 *
 * On focus: optionally adds `login-field-focused` to <html> to hide the fixed
 * bottom nav (only use this on screens that actually have a bottom nav).
 * On blur: removes that class (if present) and scrolls the window to the top
 * after a short delay to let iOS finish the keyboard animation before restoring
 * the layout.
 *
 * Android often resizes the layout viewport instead of panning, so the timeout
 * is harmless there.
 */
export function useInputKeyboardBehavior(options?: { hideBottomNav?: boolean }) {
  const hideBottomNav = options?.hideBottomNav ?? false;

  const onFocus = useCallback(() => {
    if (hideBottomNav) {
      document.documentElement.classList.add('login-field-focused');
    }
  }, [hideBottomNav]);

  const onBlur = useCallback(() => {
    if (hideBottomNav) {
      document.documentElement.classList.remove('login-field-focused');
    }
    // Let the keyboard animate down on iOS before resetting scroll.
    window.setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }
    }, 240);
  }, [hideBottomNav]);

  return { onFocus, onBlur };
}
