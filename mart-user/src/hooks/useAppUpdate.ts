import { useEffect, useRef } from 'react';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);

  const check = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (currentVersion.current === null) {
        currentVersion.current = v;
      } else if (currentVersion.current !== v) {
        window.location.reload();
      }
    } catch {}
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    // Re-check when user brings app to foreground — critical for iOS PWA
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
