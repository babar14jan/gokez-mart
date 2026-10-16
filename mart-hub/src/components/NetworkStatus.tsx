import { useEffect, useState, type ReactNode } from 'react';
import { CloudOff, RefreshCw, Store } from 'lucide-react';
import { api } from '../services/api';

const HEALTH_TIMEOUT_MS = 3500;
const RETRY_INTERVAL_MS = 2500;
const FAILURE_DELAY_MS = 10000;
const HEALTH_CHECK_INTERVAL_MS = 15000;

type Status = 'checking' | 'connected' | 'failed';

export default function NetworkStatus({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let recoveryStarted = false;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let failureTimer: ReturnType<typeof setTimeout> | undefined;

    const startRecovery = () => {
      if (recoveryStarted) return;
      recoveryStarted = true;
      setStatus('checking');
      failureTimer = setTimeout(() => {
        if (!disposed) setStatus('failed');
      }, FAILURE_DELAY_MS);
    };

    const scheduleProbe = (delay: number) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => void probe(), delay);
    };

    const probe = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        startRecovery();
        scheduleProbe(RETRY_INTERVAL_MS);
        return;
      }

      try {
        await api.get('/health', { timeout: HEALTH_TIMEOUT_MS });
        if (disposed) return;
        recoveryStarted = false;
        if (failureTimer) clearTimeout(failureTimer);
        setStatus('connected');
        scheduleProbe(HEALTH_CHECK_INTERVAL_MS);
      } catch {
        if (disposed) return;
        startRecovery();
        scheduleProbe(RETRY_INTERVAL_MS);
      }
    };

    const onOffline = () => {
      startRecovery();
      scheduleProbe(0);
    };
    const onOnline = () => scheduleProbe(0);

    startRecovery();
    void probe();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      if (probeTimer) clearTimeout(probeTimer);
      if (failureTimer) clearTimeout(failureTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [retryKey]);

  if (status === 'connected') return children;

  const online = typeof navigator === 'undefined' || navigator.onLine;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6faf7] px-6 text-center text-gray-900 dark:bg-[#18191a] dark:text-white">
      <section className="w-full max-w-sm" role="status" aria-live="polite">
        {status === 'checking' ? (
          <>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <RefreshCw className="h-9 w-9 animate-spin" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold">Getting your connection back</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              {online ? 'Reconnecting to Gokez Hub…' : 'Waiting for your internet connection…'}
            </p>
          </>
        ) : (
          <>
            <div className="relative mx-auto mb-6 flex h-36 w-40 items-center justify-center">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Store className="h-14 w-14" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <span className="absolute bottom-1 right-3 flex h-12 w-12 items-center justify-center rounded-full border-4 border-[#f6faf7] bg-white text-rose-600 dark:border-[#18191a] dark:bg-[#242526] dark:text-rose-300">
                <CloudOff className="h-6 w-6" aria-hidden="true" />
              </span>
            </div>
            <h1 className="text-xl font-semibold">{online ? 'Hub is taking a break' : 'You’re offline'}</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600 dark:text-slate-400">
              {online
                ? 'We can’t reach the server right now. We’ll keep trying to reconnect.'
                : 'Check your internet connection. We’ll reconnect as soon as you’re back online.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus('checking');
                setRetryKey((key) => key + 1);
              }}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#18191a]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}