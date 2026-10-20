import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import InstallPrompt from './components/InstallPrompt';
import NetworkStatus from './components/NetworkStatus';
import { registerServiceWorker } from './services/push';
import { hideSplash } from './utils/splash';

// The static block in index.html exists only for crawlers that do not run
// JavaScript. The .js class in <head> already hides it before first paint;
// removing it here guarantees the rendered DOM never contains that text or a
// second <h1>. Done before render() so it is never in the DOM alongside the app.
document.getElementById('seo-static')?.remove();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NetworkStatus>
        <App />
        <InstallPrompt />
      </NetworkStatus>
    </ErrorBoundary>
  </StrictMode>
);

// Signals the inline watchdog in index.html that the app module ran, so it does
// not mistake a slow start for a stale cached shell and clear the caches.
(window as any).__gokezBooted = true;

// The launch splash is removed by App once the first data load has finished
// (see App.tsx). This timeout is only a safety net so the overlay can never
// outlive a failed render, and index.html carries a slightly longer inline
// fallback for the case where this module never runs at all. Kept comfortably
// above a normal slow load so the splash is not cut short mid-animation.
window.setTimeout(hideSplash, 6000);

// After the first render on purpose: a throw in service-worker registration
// would otherwise leave the document empty, with no boundary mounted yet to
// catch it, which is the white screen the boundary exists to prevent.
registerServiceWorker();