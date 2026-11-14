import { useEffect } from 'react';
import { trackInstall } from '../utils/track';
import { detectPlatform, isStandalone, INSTALLED_KEY } from '../utils/install';

const TRACKED_KEY = 'mart_install_tracked';

export default function InstallPrompt() {
  useEffect(() => {
    const markInstalled = (platform: 'android' | 'ios') => {
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* noop */ }
      let alreadyTracked = false;
      try { alreadyTracked = localStorage.getItem(TRACKED_KEY) === '1'; } catch { /* noop */ }
      if (!alreadyTracked) {
        try { localStorage.setItem(TRACKED_KEY, '1'); } catch { /* noop */ }
        trackInstall('app_installed', platform);
      }
      window.dispatchEvent(new Event('gokez:pwa-installed'));
    };

    // Chromium (Android/desktop) fires `appinstalled` after the native prompt
    // is accepted. Record the install from that event.
    const handleInstalled = () => {
      markInstalled(detectPlatform() ?? 'android');
    };
    window.addEventListener('appinstalled', handleInstalled);

    // iOS has no `appinstalled` event (installs are manual via "Add to Home
    // Screen"), so detect an install by the app running in standalone mode.
    // Record it once per device to avoid inflating the funnel on every launch.
    if (isStandalone()) {
      markInstalled(detectPlatform() ?? 'ios');
    }

    return () => window.removeEventListener('appinstalled', handleInstalled);
  }, []);

  return null;
}
