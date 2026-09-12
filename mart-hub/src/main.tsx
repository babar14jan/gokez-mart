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
