import { useEffect } from 'react';
import { trackInstall } from '../utils/track';
import { detectPlatform } from '../utils/install';

const INSTALLED_KEY = 'mart_install_done';

export default function InstallPrompt() {
  useEffect(() => {
    const handleInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1');
      // `appinstalled` fires from the browser's own install flow, which so far
      // only exists on Chromium (Android/desktop). Resolve the platform rather
      // than assuming Android, so a desktop Chrome install is not mislabelled.
      trackInstall('app_installed', detectPlatform() ?? 'android');
      window.dispatchEvent(new Event('gokez:pwa-installed'));
    };
    window.addEventListener('appinstalled', handleInstalled);
    return () => window.removeEventListener('appinstalled', handleInstalled);
  }, []);

  return null;
}
