import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerServiceWorker } from './services/push';

registerServiceWorker();

// The static block in index.html exists only for crawlers that do not run
// JavaScript. The .js class in <head> already hides it before first paint;
// removing it here guarantees the rendered DOM never contains that text or a
// second <h1>. Done before render() so it is never in the DOM alongside the app.
document.getElementById('seo-static')?.remove();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
