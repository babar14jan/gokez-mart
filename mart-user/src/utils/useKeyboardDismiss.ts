import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

/**
 * Mobile keyboard-dismiss helpers for a search field.
 *
 * On touch devices the on-screen keyboard covers the lower half of a results
 * list, and there is no reliable native gesture that puts it away -- the user
 * ends up hunting for a blank strip to tap. This blurs the field on the three
 * things a shopper naturally reaches for:
 *   - dragging the results (mirrors iOS keyboardDismissMode "on-drag"),
 *   - pressing Enter / the keyboard's Search key,
 *   - tapping blank space (padding, gaps, an empty list).
 *
 * The drag listener lives on the document, not on the list, because the list
 * is not always the thing that scrolls -- on a page whose outer scroller moves
 * (the category view) an `onScroll` on the list never fires. A real finger
 * drag is tracked instead, so the gesture dismisses no matter which container
 * the browser decides to scroll. A tap on an interactive element is never
 * swallowed: only taps that miss every button/link/input dismiss.
 *
 * Wire the members to the field and the surface that wraps it:
 *
 *   const { ref, dismiss, onKeyDown, onSurfaceClick } = useKeyboardDismiss();
 *   <div onClick={onSurfaceClick}>
 *     <input ref={ref} onKeyDown={onKeyDown} enterKeyHint="search" ... />
 *     <div className="overflow-y-auto">...</div>
 *   </div>
 */
export function useKeyboardDismiss() {
  const ref = useRef<HTMLInputElement>(null);
  // Where the finger first landed. Kept in a ref so the gesture start does not
  // re-render the sheet on every touch.
  const drag = useRef<{ x: number; y: number } | null>(null);

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

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      drag.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      // Only the focused field's own keyboard should react.
      if (document.activeElement !== ref.current) return;
      const start = drag.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      // A drag that misses the field itself means the shopper is scrolling the
      // list. Ignore movement on the field so text selection still works.
      if ((event.target as HTMLElement)?.closest?.('input, textarea')) return;
      if (Math.abs(touch.clientX - start.x) + Math.abs(touch.clientY - start.y) > 12) {
        dismiss();
      }
    };
    const onTouchEnd = () => { drag.current = null; };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [dismiss]);

  return { ref, dismiss, onKeyDown, onSurfaceClick };
}
