import { useEffect, useRef } from 'react';
import { useLoginFlowStore } from '../store/loginFlowStore';

const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function useAppUpdate() {
  const currentVersion = useRef<string | null>(null);
  const pendingReload = useRef(false);
  const otpPhone = useLoginFlowStore(state => state.phone);
  const otpExpiresAt = useLoginFlowStore(state => state.expiresAt);
  const isOtpFlowActive = Boolean(otpPhone && otpExpiresAt && otpExpiresAt > Date.now());

  const check = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (currentVersion.current === null) {
        currentVersion.current = v;
      } else if (currentVersion.current !== v) {
        if (useLoginFlowStore.getState().getActiveOtpFlow()) {
          pendingReload.current = true;
        } else {
          window.location.reload();
        }
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

  useEffect(() => {
    if (!isOtpFlowActive && pendingReload.current) window.location.reload();
  }, [isOtpFlowActive]);
}
