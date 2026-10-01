import { useEffect } from 'react';

/**
 * Publishes how much of the layout viewport the on-screen keyboard is covering,
 * as the `--kb` custom property on <html>. Pair it with `.page-shell` in
 * index.css.
 *
 * Why this is needed at all: `min-h-screen` resolves to 100vh, which on a phone
 * is the height of the page WITHOUT the keyboard. So the moment a keyboard
 * opens, a full-height shell is still taller than anything visible -- the
 * customer gets a page that scrolls far past the fold with the form sitting
 * somewhere in the middle of it. That reads as "unstable".
 *
 * Why one mechanism covers both platforms:
 *
 *   Android honours `interactive-widget=resizes-content`, so it shrinks
 *   window.innerHeight itself. visualViewport.height then matches it and the
 *   inset computes to 0. No double counting -- 100dvh is already short enough.
 *
 *   iOS ignores that directive. It keeps the layout viewport at full height and
 *   shrinks only the visual viewport, so innerHeight - visualViewport.height is
 *   the covered strip and --kb carries it.
 *
 * rAF-throttled because visualViewport fires resize and scroll in bursts while
 * the keyboard animates; writing the property on every event is itself a cause
 * of visible jitter.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // offsetTop matters on iOS: when the caret is scrolled near the bottom
        // Safari pans the visual viewport, and without subtracting that the
        // inset over-reports and the shell collapses too far.
        const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const root = document.documentElement;
        root.style.setProperty('--kb', `${Math.round(covered)}px`);
        // A class as well as the variable: some adjustments (the bottom-nav
        // reservation, the login hero cap) are only sensible while the keyboard
        // is actually up, and keying them off one flag keeps them in CSS.
        root.classList.toggle('kb-open', covered > 80);
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
      document.documentElement.classList.remove('kb-open');
    };
  }, []);
}