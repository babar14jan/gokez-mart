import { useEffect } from 'react';
import { trackInstall } from '../utils/track';

const INSTALLED_KEY = 'mart_install_done';

export default function InstallPrompt() {
  useEffect(() => {
    const handleInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1');
      trackInstall('app_installed', 'android');
      window.dispatchEvent(new Event('gokez:pwa-installed'));
    };
    window.addEventListener('appinstalled', handleInstalled);
    return () => window.removeEventListener('appinstalled', handleInstalled);
  }, []);

  return null;
}
