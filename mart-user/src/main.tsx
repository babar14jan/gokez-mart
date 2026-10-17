import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import InstallPrompt from './components/InstallPrompt';
import { registerServiceWorker } from './services/push';

// The static block in index.html exists only for crawlers that do not run
// JavaScript. The .js class in <head> already hides it before first paint;
// removing it here guarantees the rendered DOM never contains that text or a
// second <h1>. Done before render() so it is never in the DOM alongside the app.
document.getElementById('seo-static')?.remove();

// Detect iOS 26+ (Safari/WebKit) which has a dvh viewport height bug causing
// empty gap below the bottom nav on iOS Safari browser. Add a class so CSS can
// use 100lvh for the shell there.
try {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
  if (isIOS) {
    // iOS 26 Safari shows the gap; applying lvh for iOS WebKit helps. For
    // older iOS this could push nav under toolbar when visible, but the app
    // is a PWA primarily; browser-tab usage is affected by the iOS 26 bug.
    document.documentElement.classList.add('ios-webkit');
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <InstallPrompt />
    </ErrorBoundary>
  </StrictMode>
);

// The launch splash is removed by App once the first data load has finished
// (see App.tsx). This timeout is only a safety net so the overlay can never
// outlive a failed render, and index.html carries a slightly longer inline
// fallback for the case where this module never runs at all. Kept comfortably
// above a normal slow load so the splash is not cut short mid-animation.
window.setTimeout(() => document.getElementById('app-splash')?.remove(), 6000);

// After the first render on purpose: a throw in service-worker registration
// would otherwise leave the document empty, with no boundary mounted yet to
// catch it, which is the white screen the boundary exists to prevent.
registerServiceWorker();