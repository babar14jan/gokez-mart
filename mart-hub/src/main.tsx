import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { registerAdminSW } from './services/push';
import { HeaderActionProvider } from './store/headerActionStore';

const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if (isLocalDevelopment) {
  navigator.serviceWorker?.getRegistrations().then(async registrations => {
    const removed = (await Promise.all(registrations.map(registration => registration.unregister()))).some(Boolean);
    if (removed && navigator.serviceWorker.controller && !sessionStorage.getItem('gokez-dev-worker-cleared')) {
      sessionStorage.setItem('gokez-dev-worker-cleared', '1');
      window.location.reload();
    }
  });
} else {
  registerAdminSW();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><HeaderActionProvider><App /></HeaderActionProvider></StrictMode>
);

// Signals the inline watchdog in index.html that the app module ran, so it does
// not mistake a slow start for a stale cached shell and clear the caches.
(window as any).__gokezBooted = true;
