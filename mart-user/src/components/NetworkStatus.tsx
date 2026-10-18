import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../services/api';

const HEALTH_TIMEOUT_MS = 3500;
const RETRY_INTERVAL_MS = 2500;
const HEALTH_CHECK_INTERVAL_MS = 15000;
// How long an ambiguous outage must persist before the screen is taken over. A
// definitive signal (no network, or a transport-level request failure) is shown
// at once; only "we're online but the server is slow / erroring" waits, so a
// single hiccup never blanks the store.
const CONFIRM_MS = 1500;

type Status = 'checking' | 'connected' | 'failed';
type Mode = 'offline' | 'server' | 'timeout';

const COPY: Record<Mode, { img: string; width: number; height: number; title: string; body: string }> = {
  offline: {
    img: '/offline.webp',
    width: 586,
    height: 426,
    title: 'You\u2019re offline',
    body: 'Check your internet connection and try again.',
  },
  server: {
    img: '/server_unreachable.webp',
    width: 590,
    height: 423,
    title: 'Something went wrong',
    body: 'We\u2019re having trouble connecting to our server. Please try again shortly.',
  },
  timeout: {
    img: '/server_unreachable.webp',
    width: 590,
    height: 423,
    title: 'Connection timed out',
    body: 'This is taking longer than usual. Please check your connection and try again.',
  },
};

interface ApiFailedDetail {
  offline?: boolean;
  server?: boolean;
  timeout?: boolean;
}

export default function NetworkStatus({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [mode, setMode] = useState<Mode>('offline');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let failureTimer: ReturnType<typeof setTimeout> | undefined;

    const clearFailure = () => {
      if (failureTimer) { clearTimeout(failureTimer); failureTimer = undefined; }
    };

    /**
     * Surface an outage. `immediate` downgrades the confirmation delay for cases
     * that are conclusive on their own (an offline event, or an API call that
     * failed before any HTTP response). navigator.onLine === false always wins,
     * so a device we *know* is disconnected never gets the "server" message.
     */
    const showFailure = (nextMode: Mode, immediate: boolean) => {
      if (disposed) return;
      clearFailure();
      const resolved: Mode = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : nextMode;
      if (immediate || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        setMode(resolved);
        setStatus('failed');
        return;
      }
      failureTimer = setTimeout(() => {
        if (!disposed) { setMode(resolved); setStatus('failed'); }
      }, CONFIRM_MS);
    };

    const scheduleProbe = (delay: number) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => void probe(), delay);
    };

    const probe = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        showFailure('offline', true);
        scheduleProbe(RETRY_INTERVAL_MS);
        return;
      }

      try {
        await api.get('/health', { timeout: HEALTH_TIMEOUT_MS });
        if (disposed) return;
        clearFailure();
        setStatus('connected');
        scheduleProbe(HEALTH_CHECK_INTERVAL_MS);
      } catch (err: any) {
        if (disposed) return;
        const timedOut = err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT';
        const hasResponse = Boolean(err?.response);
        const nextMode: Mode = hasResponse ? 'server' : timedOut ? 'timeout' : 'offline';
        // No HTTP response (and not a timeout) is a transport error: treat it as
        // "no usable network" and show it right away. A 5xx or a timeout is
        // ambiguous, so it waits out the short confirmation window.
        showFailure(nextMode, !hasResponse && !timedOut);
        scheduleProbe(RETRY_INTERVAL_MS);
      }
    };

    // Any real API call that fails gives us an immediate, authoritative signal,
    // so the screen reacts without waiting for /health to time out.
    const onApiFailed = (event: Event) => {
      const detail = (event as CustomEvent<ApiFailedDetail>).detail || {};
      if (detail.offline) showFailure('offline', true);
      else if (detail.server) showFailure('server', false);
      else if (detail.timeout) showFailure('timeout', false);
    };

    const onOffline = () => {
      showFailure('offline', true);
      scheduleProbe(0);
    };
    const onOnline = () => {
      // Coming back online: drop the overlay right away so the store reappears,
      // then confirm with a probe (the app also refreshes its catalogue on
      // 'online', so recovery never clears what is already rendered).
      clearFailure();
      setStatus('checking');
      scheduleProbe(0);
    };

    void probe();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('mart:api-failed', onApiFailed);

    return () => {
      disposed = true;
      if (probeTimer) clearTimeout(probeTimer);
      clearFailure();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('mart:api-failed', onApiFailed);
    };
  }, [retryKey]);

  // Clear the launch splash ourselves: on a cold launch the app's own splash
  // dismissal may not have run yet, and the offline overlay must not sit behind it.
  useEffect(() => {
    if (status === 'failed') document.getElementById('app-splash')?.remove();
  }, [status]);

  const retry = () => {
    setStatus('checking');
    setRetryKey((key) => key + 1);
  };

  const view = COPY[mode];

  // The app stays mounted underneath at all times, so recovering from an outage
  // never discards the customer's view, scroll position or in-progress state.
  return (
    <>
      {children}
      {status === 'failed' && (
        <main className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-white px-6 py-10 text-center text-gray-900 dark:bg-slate-900 dark:text-white">
          <section className="w-full max-w-md" role="status" aria-live="polite">
            <img
              src={view.img}
              alt=""
              width={view.width}
              height={view.height}
              className="mx-auto h-auto w-56 sm:w-64"
            />
            <h1 className="mt-6 text-xl font-semibold">{view.title}</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600 dark:text-slate-400">
              {view.body}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try Again
            </button>
          </section>
        </main>
      )}
    </>
  );
}
