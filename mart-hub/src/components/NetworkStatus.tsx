import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
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

  // A probe that is merely re-checking (a slow response, a cold backend, a
  // page switch firing a burst of requests) must never blank the hub: the
  // app only leaves the screen once the outage is confirmed, 10s in.
  if (status !== 'failed') return children;

  // Distinguish "no connection at all" from "we're online but the server is not
  // answering" — the fix the person can try is different in each case.
  const online = typeof navigator === 'undefined' || navigator.onLine;

  const retry = () => {
    setStatus('checking');
    setRetryKey((key) => key + 1);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6faf7] px-6 py-10 text-center text-gray-900 dark:bg-[#18191a] dark:text-white">
      <section className="w-full max-w-md" role="status" aria-live="polite">
        {online ? (
          <>
            <img
              src="/server_unreachable.webp"
              alt=""
              width={590}
              height={423}
              className="mx-auto h-auto w-56 sm:w-64"
            />
            <h1 className="mt-6 text-xl font-semibold">Oops! Something Went Wrong</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600 dark:text-slate-400">
              We couldn&rsquo;t load the page. Please try again.
            </p>
          </>
        ) : (
          <>
            <img
              src="/offline.webp"
              alt=""
              width={586}
              height={426}
              className="mx-auto h-auto w-56 sm:w-64"
            />
            <h1 className="mt-6 text-xl font-semibold">No Internet Connection</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600 dark:text-slate-400">
              It looks like your device isn&rsquo;t connected to the internet. Please check your
              connection and try again.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#18191a]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try Again
        </button>
      </section>
    </main>
  );
}
