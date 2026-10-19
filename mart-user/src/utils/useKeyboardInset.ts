import { useEffect } from 'react';

/** Input types that do not open the on-screen keyboard. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image', 'hidden',
]);

/** True for the elements that bring up the on-screen keyboard. */
function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

/**
 * Single, app-wide keyboard hook. Mount it once (App) and nothing else needs to
 * know the keyboard exists. It publishes two things on <html>:
 *
 *   1. `.input-focused` — set whenever any text field anywhere is focused, on
 *      every phone. Pages use it in CSS to hide the bottom nav, drop the room
 *      reserved for it, or otherwise step aside while the customer types.
 *      Driven by document-level focusin/focusout, so a page never wires its own
 *      onFocus/onBlur and the behaviour cannot drift between screens.
 *
 *   2. `--kb` and `.kb-open` — how much of the layout viewport the keyboard is
 *      covering, from the VisualViewport API. `.kb-open` is what the keyboard
 *      CSS in index.css keys off. `--kb` is still published as a px value, but
 *      the fixed `.app-shell` / `.page-shell` no longer consume it: a fixed
 *      frame must keep a stable height while the keyboard animates, and the
 *      browser's own scroll-into-view handles the focused field. Treat `--kb`
 *      as available for future opt-in rules, not as a shell input.
 *
 * Why both are needed:
 *
 *   Android honours `interactive-widget=resizes-content`, so it shrinks
 *   window.innerHeight itself. visualViewport.height then matches it and the
 *   inset computes to 0 -- 100dvh is already short enough, and `--kb` stays 0.
 *
 *   iOS ignores that directive. It keeps the layout viewport at full height and
 *   shrinks only the visual viewport, so innerHeight - visualViewport.height is
 *   the covered strip and `--kb` carries it.
 *
 * `.input-focused` is separate from `.kb-open` on purpose: some browsers report
 * no inset while a hardware keyboard is attached, and the nav should still hide
 * whenever a field owns the screen.
 */
export function useKeyboardInset(): void {
  // 1) A text field is focused -> .input-focused on <html>.
  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      if (isTextField(document.activeElement)) root.classList.add('input-focused');
      else root.classList.remove('input-focused');
    };
    const onFocusIn = () => { sync(); };
    const onFocusOut = () => {
      // focusout fires before the next element has received focus; re-check on
      // the next frame so moving between two fields does not flicker the class.
      requestAnimationFrame(sync);
    };
    // A sheet can unmount while its auto-focused input owns focus, and some
    // browsers never fire focusout when the node is removed. Any later pointer
    // interaction re-checks, so the nav can never stay stuck hidden.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
      requestAnimationFrame(sync);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      root.classList.remove('input-focused');
    };
  }, []);

  // 2) Publish the covered height as --kb / .kb-open.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // A real on-screen keyboard covers far more than this; browser chrome
    // collapsing, the home indicator and safe-area rounding never do. Requiring
    // a threshold (with a lower one to release) keeps a stray few-pixel delta
    // from shrinking the shell and lifting the bottom nav on every scroll.
    const OPEN_AT = 120;
    const CLOSE_AT = 80;
    let open = false;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // offsetTop matters on iOS: when the caret is scrolled near the bottom
        // Safari pans the visual viewport, and without subtracting that the
        // inset over-reports and the shell collapses too far.
        const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        open = open ? covered > CLOSE_AT : covered > OPEN_AT;
        const root = document.documentElement;
        root.style.setProperty('--kb', `${open ? Math.round(covered) : 0}px`);
        // --vv-bottom: how far the LAYOUT viewport bottom sits below the VISIBLE
        // bottom. The fixed `.app-shell` is `inset: 0`, i.e. sized to the layout
        // viewport, so in an iOS Safari tab it ends behind the bottom toolbar and
        // the in-flow nav rides under that chrome. A `position: fixed; bottom: 0`
        // element (what mart-hub's nav uses) instead tracks the visual viewport,
        // which is why the hub has no gap. Publishing the strip lets the shell
        // shrink its bottom edge to the visible bottom, so the in-flow nav lands
        // exactly where the hub's fixed nav does. Zero while the keyboard is up so
        // the frame never collapses with it.
        root.style.setProperty('--vv-bottom', `${open ? 0 : Math.round(covered)}px`);
        // A class as well as the variable: some adjustments (the bottom-nav
        // reservation, the login hero cap) are only sensible while the keyboard
        // is actually up, and keying them off one flag keeps them in CSS.
        root.classList.toggle('kb-open', open);
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--kb');
      document.documentElement.style.removeProperty('--vv-bottom');
      document.documentElement.classList.remove('kb-open');
    };
  }, []);
}
