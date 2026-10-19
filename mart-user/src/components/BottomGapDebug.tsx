import { useEffect } from 'react';

/**
 * Throwaway iOS bottom-geometry readout. Renders nothing unless the URL carries
 * `?debuggap`, so it is inert in normal use. It exists to measure — on a real
 * device — the exact relationship between the layout viewport, the visual
 * viewport, the bottom safe-area and where the in-flow nav actually lands, so a
 * precise (rather than guessed) bottom offset can be chosen.
 */
export default function BottomGapDebug() {
  useEffect(() => {
    const q = location.search;
    if (q.includes('debuggap=off')) {
      try {
        localStorage.removeItem('debuggap');
      } catch {
        /* ignore */
      }
      return;
    }
    const inUrl = q.includes('debuggap');
    if (inUrl) {
      try {
        localStorage.setItem('debuggap', '1');
      } catch {
        /* ignore */
      }
    }
    let flagged = inUrl;
    if (!flagged) {
      try {
        flagged = localStorage.getItem('debuggap') === '1';
      } catch {
        /* ignore */
      }
    }
    if (!flagged) return;

    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483647;background:#000c;color:#0f0;' +
      'font:11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;' +
      'white-space:pre;pointer-events:none;line-height:1.35;border-bottom-right-radius:6px;';
    document.body.appendChild(el);

    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;bottom:0;left:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);

    const round = (n: number) => Math.round(n * 10) / 10;

    const read = () => {
      const vv = window.visualViewport;
      const shell = document.querySelector('.app-shell') as HTMLElement | null;
      const nav = document.querySelector('.mobile-bottom-nav') as HTMLElement | null;
      const navRect = nav ? nav.getBoundingClientRect() : null;
      const visBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const safeB = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      const vvBottomVar =
        getComputedStyle(document.documentElement).getPropertyValue('--vv-bottom').trim() || '0px';

      el.textContent =
        `innerH     ${window.innerHeight}\n` +
        `vvH        ${vv ? round(vv.height) : '-'}\n` +
        `vvTop      ${vv ? round(vv.offsetTop) : '-'}\n` +
        `--vv-bottom ${vvBottomVar}\n` +
        `safeB      ${safeB}\n` +
        `pwa        ${document.documentElement.classList.contains('installed-pwa')}  standalone ${matchMedia('(display-mode: standalone)').matches}\n` +
        `shell bot  ${shell ? getComputedStyle(shell).bottom : '-'}\n` +
        `nav bottom ${navRect ? round(navRect.bottom) : '-'}\n` +
        `visBottom  ${round(visBottom)}\n` +
        `gapToVis   ${navRect ? round(visBottom - navRect.bottom) : '-'}   (px between nav bottom and visual-viewport bottom; 0 = flush, <0 = under it)\n` +
        `navToLayoutBot ${navRect ? round(window.innerHeight - navRect.bottom) : '-'}`;
    };

    read();
    const id = window.setInterval(read, 400);
    return () => {
      window.clearInterval(id);
      el.remove();
      probe.remove();
    };
  }, []);

  return null;
}
