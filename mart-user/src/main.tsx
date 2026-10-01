import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { registerServiceWorker } from './services/push';

// The static block in index.html exists only for crawlers that do not run
// JavaScript. The .js class in <head> already hides it before first paint;
// removing it here guarantees the rendered DOM never contains that text or a
// second <h1>. Done before render() so it is never in the DOM alongside the app.
document.getElementById('seo-static')?.remove();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// After the first render on purpose: a throw in service-worker registration
// would otherwise leave the document empty, with no boundary mounted yet to
// catch it, which is the white screen the boundary exists to prevent.
registerServiceWorker();