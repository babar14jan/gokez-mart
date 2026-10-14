import { useCallback, useRef, type KeyboardEvent, type MouseEvent } from 'react';

/**
 * Mobile keyboard-dismiss helpers for a search field.
 *
 * On touch devices the on-screen keyboard covers the lower half of a results
 * list, and there is no reliable native gesture that puts it away -- the user
 * ends up hunting for a blank strip to tap. This blurs the field on the three
 * things a shopper naturally reaches for:
 *   - scrolling the results (mirrors iOS keyboardDismissMode "on-drag"),
 *   - pressing Enter / the keyboard's Search key,
 *   - tapping blank space (padding, gaps, an empty list).
 *
 * A tap on an interactive element is never swallowed: only taps that miss every
 * button/link/input dismiss, so product cards, suggestions and clear buttons all
 * keep their own behaviour. Wire the four members to the field and the surface
 * that wraps it:
 *
 *   const { ref, dismiss, onKeyDown, onSurfaceClick } = useKeyboardDismiss();
 *   <div onClick={onSurfaceClick}>
 *     <input ref={ref} onKeyDown={onKeyDown} enterKeyHint="search" ... />
 *     <div onScroll={dismiss} className="overflow-y-auto">...</div>
 *   </div>
 */
export function useKeyboardDismiss() {
  const ref = useRef<HTMLInputElement>(null);

  const dismiss = useCallback(() => ref.current?.blur(), []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dismiss();
    }
  }, [dismiss]);

  const onSurfaceClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!(event.target as HTMLElement).closest('button, a, input, [role="button"]')) {
      dismiss();
    }
  }, [dismiss]);

  return { ref, dismiss, onKeyDown, onSurfaceClick };
}
