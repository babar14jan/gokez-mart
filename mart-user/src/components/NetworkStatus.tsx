import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { BACKEND_NOTICE } from '../constants/backendNotice';

const HEALTH_TIMEOUT_MS = 3500;
const RETRY_INTERVAL_MS = 2500;
const HEALTH_CHECK_INTERVAL_MS = 15000;

// A transport failure only tells us that *something* is unreachable, and the
// browser reports "customer has no wifi" and "our backend's DNS is gone" as the
// exact same error. This same-origin URL is the tie-breaker: it is a tiny static
// file served by Cloudflare Pages and never by the API, so if it loads the
// customer's connection is fine and the problem is our backend — and if it does
// not, the customer is genuinely offline.
const CONNECTIVITY_PROBE_URL = '/version.json';
const CONNECTIVITY_TIMEOUT_MS = 3000;

async function hasUsableNetwork(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);
  try {
    await fetch(CONNECTIVITY_PROBE_URL, { cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type Status = 'checking' | 'connected' | 'failed';
// `server` and `timeout` both mean "the backend did not answer" and carry the
// configurable BACKEND_NOTICE; `offline` means the customer's own device has
// no connection and keeps its dedicated copy.
type Mode = 'offline' | 'server' | 'timeout';

interface NoticeView {
  img: string;
  width: number;
  height: number;
  title: string;
  body: string[];
  button: string;
}

const OFFLINE_VIEW: NoticeView = {
  img: '/offline.webp',
  width: 586,
  height: 426,
  title: 'You’re offline',
  body: ['Check your internet connection and try again.'],
  button: 'Try Again',
};

const SERVER_FALLBACK: NoticeView = {
  img: '/server_unreachable.webp',
  width: 590,
  height: 423,
  title: 'Something went wrong',
  body: ['We’re having trouble connecting to our server. Please try again shortly.'],
  button: 'Try Again',
};

const TIMEOUT_FALLBACK: NoticeView = {
  img: '/server_unreachable.webp',
  width: 590,
  height: 423,
  title: 'Connection timed out',
  body: ['This is taking longer than usual. Please check your connection and try again.'],
  button: 'Try Again',
};

const BACKEND_DOWN_VIEW: NoticeView = BACKEND_NOTICE.enabled
  ? {
      img: BACKEND_NOTICE.image,
      width: BACKEND_NOTICE.imageWidth,
      height: BACKEND_NOTICE.imageHeight,
      title: BACKEND_NOTICE.title,
      body: BACKEND_NOTICE.body,
      button: BACKEND_NOTICE.checkAgainLabel,
    }
  : SERVER_FALLBACK;

const VIEWS: Record<Mode, NoticeView> = {
  offline: OFFLINE_VIEW,
  server: BACKEND_DOWN_VIEW,
  timeout: BACKEND_NOTICE.enabled ? BACKEND_DOWN_VIEW : TIMEOUT_FALLBACK,
};

interface ApiFailedDetail {
  offline?: boolean;
  server?: boolean;
  timeout?: boolean;
}

export default function NetworkStatus({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [mode, setMode] = useState<Mode>('offline');
  // True only between the customer pressing the button and that check settling,
  // so the notice stays on screen (with a busy button) instead of flashing the
  // broken store underneath.
  const [checking, setChecking] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;

    // Both screens come up the moment they are known — there is no confirmation
    // delay, so an outage is never a silent stall.
    const showFailure = (nextMode: Mode) => {
      if (disposed) return;
      setMode(nextMode);
      setStatus('failed');
      setChecking(false);
    };

    const scheduleProbe = (delay: number) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = setTimeout(() => void probe(), delay);
    };

    const probe = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        showFailure('offline');
        scheduleProbe(RETRY_INTERVAL_MS);
        return;
      }

      try {
        await api.get('/health', { timeout: HEALTH_TIMEOUT_MS });
        if (disposed) return;
        setStatus('connected');
        setChecking(false);
        scheduleProbe(HEALTH_CHECK_INTERVAL_MS);
      } catch (err: any) {
        if (disposed) return;
        // An HTTP response proves the connection works, so the backend itself is
        // unhealthy. No response (or a timeout) is ambiguous — ask the network.
        const answered = Boolean(err?.response);
        showFailure(answered || (await hasUsableNetwork()) ? 'server' : 'offline');
        scheduleProbe(RETRY_INTERVAL_MS);
      }
    };

    // Any real API call that fails gives us an authoritative signal, so the
    // screen reacts without waiting for its own /health poll.
    const onApiFailed = (event: Event) => {
      const detail = (event as CustomEvent<ApiFailedDetail>).detail || {};
      void (async () => {
        if (detail.server) {
          // An HTTP 5xx: the backend answered, so the customer's connection is fine.
          showFailure('server');
          return;
        }
        if (!detail.offline && !detail.timeout) return;
        if (disposed) return;
        showFailure((await hasUsableNetwork()) ? 'server' : 'offline');
      })();
    };

    const onOffline = () => {
      showFailure('offline');
      scheduleProbe(0);
    };
    const onOnline = () => {
      // Coming back online: drop the overlay right away so the store reappears,
      // then confirm with a probe (the app also refreshes its catalogue on
      // 'online', so recovery never clears what is already rendered).
      setChecking(false);
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
    setChecking(true);
    setRetryKey((key) => key + 1);
  };

  const view = VIEWS[mode];
  const visible = status === 'failed' || checking;

  // The app stays mounted underneath at all times, so recovering from an outage
  // never discards the customer's view, scroll position or in-progress state.
  return (
    <>
      {children}
      {visible && (
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
            {view.body.map((line, index) => (
              <p
                key={`${index}:${line}`}
                className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600 dark:text-slate-400"
              >
                {line}
              </p>
            ))}
            <button
              type="button"
              onClick={retry}
              disabled={checking}
              aria-busy={checking}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:ring-offset-slate-900"
            >
              <RefreshCw
                className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {view.button}
            </button>
          </section>
        </main>
      )}
    </>
  );
}
