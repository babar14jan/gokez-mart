import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerAdminSW } from './services/push';
import { HeaderActionProvider } from './store/headerActionStore';

registerAdminSW();

createRoot(document.getElementById('root')!).render(
  <StrictMode><HeaderActionProvider><App /></HeaderActionProvider></StrictMode>
);

// Signals the inline watchdog in index.html that the app module ran, so it does
// not mistake a slow start for a stale cached shell and clear the caches.
(window as any).__gokezBooted = true;
