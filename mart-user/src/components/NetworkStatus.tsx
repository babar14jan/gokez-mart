import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { hideSplash } from '../utils/splash';
import { readClosedCopy, type StoreClosedCopy } from '../utils/storeClosed';

// Generous on purpose. A dead backend rejects the connection instantly (or
// answers with a 5xx), so a long ceiling costs nothing there; what it buys is
// that a slow 3G phone is not blanked with an outage screen for being slow.
const HEALTH_TIMEOUT_MS = 8000;
// Same reasoning for the tie-breaker below: a device with no internet fails
// this in milliseconds, only a slow link approaches the ceiling.
const CONNECTIVITY_TIMEOUT_MS = 8000;
// A second, shorter probe after the first timed out. A genuinely slow-but-alive
// link almost always completes this one (the file is tiny), which is what earns
// the `slow` verdict; a dead data path times out again and is called offline.
const CONNECTIVITY_RETRY_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 2500;
const HEALTH_CHECK_INTERVAL_MS = 15000;
// How often to re-check while an outage screen is already up, waiting for the
// second confirmation that lets it come down.
const RECHECK_INTERVAL_MS = 2000;
// A screen that is already up needs this many consecutive successes to come
// down, so one lucky response on a flaky link cannot blink the store.
const RECOVER_SUCCESSES = 2;
// How long a failed request has to persist before the outage screen takes
// over the app. A single failed request is a blip — a flaky connection, a
// request that happened to time out, a deploy that is rolling — and none of
// those should take the screen away from a customer who is happily browsing.
// The screen appears only when the failure is real and has lasted.
const OUTAGE_CONFIRM_MS = 6000;
// A request that timed out may be a slow link rather than a dead server, so it
// waits longer before the screen takes over. A customer on a weak connection
// browsing normally should not lose the app to a timeout.
const TIMEOUT_CONFIRM_MS = 10000;

// A transport failure only tells us that *something* is unreachable, and the
// browser reports "customer has no wifi" and "our backend's DNS is gone" as the
// exact same error. This same-origin URL is the tie-breaker: it is a tiny static
// file served by Cloudflare Pages and never by the API, so if it loads the
// customer's connection is fine and the problem is our backend.
const CONNECTIVITY_PROBE_URL = '/version.json';

type Connectivity = 'online' | 'offline' | 'slow';

// One same-origin fetch to the static probe. Returns the raw outcome so the
// caller can decide what a timeout means:
//   'ok'      — the file loaded; the connection carries data.
//   'failed'  — the fetch threw a network error (DNS, refused, no route). This
//               is the classic "device has no working data path".
//   'timeout' — the request neither succeeded nor failed within the ceiling.
async function fetchProbe(signal: AbortSignal): Promise<'ok' | 'failed' | 'timeout'> {
  try {
    await fetch(CONNECTIVITY_PROBE_URL, { cache: 'no-store', signal });
    return 'ok';
  } catch (err: any) {
    return err?.name === 'AbortError' ? 'timeout' : 'failed';
  }
}

// Tell "the customer has no usable connection" apart from "our backend is down".
// They are reported identically by the browser, so this same-origin static file
// (served by Cloudflare Pages, never by the API) is the tie-breaker.
//
// The hard case is a phone whose radio is ON but whose data is dead — no plan,
// no credit, a captive portal. navigator.onLine is true throughout, and on iOS
// the request frequently HANGS rather than failing fast. A single timed-out
// probe therefore cannot be read as "slow network": a functioning-but-slow link
// still answers a file this small well within the ceiling. So a timeout is
// retried with a short ceiling; if the retry also cannot complete, the data path
// is dead and this is `offline`, not `slow`. Only a link that measurably
// completes — just late — is called slow.
async function probeConnectivity(): Promise<Connectivity> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

  const first = await timedProbe(CONNECTIVITY_TIMEOUT_MS);
  if (first === 'ok') return 'online';
  if (first === 'failed') return 'offline';

  // Timed out. Give a slow-but-working link one short chance to prove itself.
  const second = await timedProbe(CONNECTIVITY_RETRY_TIMEOUT_MS);
  if (second === 'ok') return 'slow';
  return 'offline';
}

// Run one probe under its own abort timer.
async function timedProbe(ceilingMs: number): Promise<'ok' | 'failed' | 'timeout'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ceilingMs);
  try {
    return await fetchProbe(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// A burst of failing requests (a page of catalogue tiles on a dead backend)
// would otherwise fire one probe each. Share a single in-flight probe instead.
let inFlightConnectivity: Promise<Connectivity> | null = null;
function probeConnectivityOnce(): Promise<Connectivity> {
  if (!inFlightConnectivity) {
    inFlightConnectivity = probeConnectivity().finally(() => { inFlightConnectivity = null; });
  }
  return inFlightConnectivity;
}

type Status = 'checking' | 'connected' | 'failed';
// `server` and `timeout` both mean "the backend did not answer" and share one
// screen; `offline` means the customer's own device has no connection and keeps
// its own.
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

// The backend itself is unreachable — a suspended or stopped server, a failed
// deploy, a database outage. It is not the customer's own device being
// offline; that keeps its own screen above.
//
// There is one server-down screen, not a separate notice for it: the artwork
// is the closed storefront and the copy says the store is taking a break,
// which is what the customer is actually experiencing.
const SERVER_DOWN_VIEW: NoticeView = {
  img: '/backend_donw.webp',
  width: 841,
  height: 619,
  // Plainly a connection problem, and not the store having shut. The store is
  // open; our server is the thing that is down, and the customer should not
  // be left thinking the shop has closed because of it.
  title: 'We can\u2019t reach your neighbourhood store right now.',
  body: ['Please try again in a moment.'],
  button: 'Check Again',
};

const VIEWS: Record<Mode, NoticeView> = {
  offline: OFFLINE_VIEW,
  server: SERVER_DOWN_VIEW,
  timeout: SERVER_DOWN_VIEW,
};

/**
 * The store's own words, for the screen that says the store cannot be reached.
 *
 * "We could not load the store" is the platform talking about itself. What the
 * customer needs to know is that the store is taking a break and that their
 * order still counts — and that is what the store wrote for exactly this
 * situation, so it is what is shown. The wording is kept on the device, because
 * when the backend is down the app cannot ask it for the message.
 */
function withStoreCopy(view: NoticeView, copy: StoreClosedCopy | null): NoticeView {
  if (!copy) return view;
  const greeting = copy.greeting.trim();
  const message = copy.message.trim();
  if (!greeting && !message) return view;
  // The store's own words go underneath the heading, not instead of it. The
  // heading says what is actually happening -- we cannot reach the store --
  // and the store's message says what the customer should make of it.
  //
  // The message may carry the "{until}" placeholder. There is no reopening
  // time to put in it here -- the server that would tell us is the thing
  // that is down -- so the customer would have been shown the placeholder
  // itself. A soft phrase is the honest answer.
  const body = [
    ...(greeting ? [greeting] : []),
    ...(message ? [message.replace(/\{until\}/g, 'shortly')] : []),
  ];
  return {
    ...view,
    body: body.length ? body : view.body,
  };
}

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
    // Local, not state: these only steer the loop below and must never trigger
    // a re-render. `showingFailure` mirrors that an outage screen is up so the
    // dismissal rules can be applied without reading stale state.
    let showingFailure = false;
    let consecutiveSuccesses = 0;
    // A pending confirmation that the failure has lasted. Cancelled if the
    // app talks to the server again in the meantime.
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    // Both screens come up the moment they are known — there is no confirmation
    // delay, so an outage is never a silent stall.
    const showFailure = (nextMode: Mode) => {
      if (disposed) return;
      showingFailure = true;
      consecutiveSuccesses = 0;
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
        consecutiveSuccesses += 1;
        if (!showingFailure || consecutiveSuccesses >= RECOVER_SUCCESSES) {
          // Whether an outage screen was up. Only then is there something to
          // recover from, and only then does the app need telling.
          const recovered = showingFailure;
          showingFailure = false;
          consecutiveSuccesses = 0;
          // The server answered, so whatever failed was a one-off.
          if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = undefined; }
          // Only when the app was actually down. A healthy app probes every
          // fifteen seconds, and telling it to reload the catalogue on each of
          // those would re-download the whole catalogue for no reason.
          if (recovered) {
            try { window.dispatchEvent(new CustomEvent('mart:api-back')); } catch {}
          }
          setStatus('connected');
          setChecking(false);
          scheduleProbe(HEALTH_CHECK_INTERVAL_MS);
        } else {
          scheduleProbe(RECHECK_INTERVAL_MS);
        }
      } catch (err: any) {
        if (disposed) return;
        // An HTTP response proves the connection works, so the backend itself is
        // unhealthy. No response (or a timeout) is ambiguous — ask the network.
        const answered = Boolean(err?.response);
        if (!answered) {
          const connectivity = await probeConnectivityOnce();
          if (disposed) return;
          if (connectivity === 'offline') { showFailure('offline'); scheduleProbe(RETRY_INTERVAL_MS); return; }
          if (connectivity === 'online') { showFailure('server'); scheduleProbe(RETRY_INTERVAL_MS); return; }
          // Reachable but slow: honest about it rather than blaming the wifi,
          // and the notice still offers a way to re-check.
          showFailure('timeout');
          scheduleProbe(RETRY_INTERVAL_MS);
          return;
        }
        showFailure('server');
        scheduleProbe(RETRY_INTERVAL_MS);
      }
    };

    // Any real API call that fails gives us an authoritative signal, so the
    // screen reacts without waiting for its own /health poll.
    const onApiFailed = (event: Event) => {
      const detail = (event as CustomEvent<ApiFailedDetail>).detail || {};
      // One failed request is not an outage. A flaky connection, a request that
      // happened to time out, a deploy that is rolling -- none of those should
      // take the screen over from a customer who is happily browsing. The
      // failure has to persist before the screen appears, and a success in the
      // meantime cancels it.
      if (confirmTimer) return;
      const delay = detail.timeout ? TIMEOUT_CONFIRM_MS : OUTAGE_CONFIRM_MS;
      confirmTimer = setTimeout(() => {
        confirmTimer = undefined;
        void (async () => {
        if (disposed) return;
        if (detail.server) {
          // An HTTP 5xx: the backend answered, so the customer's connection is fine.
          showFailure('server');
          return;
        }
        if (!detail.offline && !detail.timeout) return;
        const connectivity = await probeConnectivityOnce();
        if (disposed) return;
        if (connectivity === 'offline') showFailure('offline');
        else if (connectivity === 'online') showFailure('server');
        else showFailure('timeout');
        })();
      }, delay);
    };

    const onOffline = () => {
      showFailure('offline');
      scheduleProbe(0);
    };
    const onOnline = () => {
      // Coming back online: drop the overlay right away so the store reappears,
      // then confirm with a probe (the app also refreshes its catalogue on
      // 'online', so recovery never clears what is already rendered).
      // A pending confirmation is dropped with it: the connection is back, so
      // a failure that has not lasted is not a failure at all, and letting the
      // timer fire would put the outage screen over a working app.
      if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = undefined; }
      showingFailure = false;
      consecutiveSuccesses = 0;
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
      if (confirmTimer) clearTimeout(confirmTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('mart:api-failed', onApiFailed);
    };
  }, [retryKey]);

  // Clear the launch splash ourselves: on a cold launch the app's own splash
  // dismissal may not have run yet, and the offline overlay must not sit behind it.
  useEffect(() => {
    if (status === 'failed') hideSplash();
  }, [status]);

  const retry = () => {
    setChecking(true);
    setRetryKey((key) => key + 1);
  };

  // Read once per mount: the store's copy only changes when the store
  // changes it, and the outage screen is the only place that uses it.
  const [storeCopy] = useState(() => readClosedCopy());
  const view = mode === 'offline'
    ? VIEWS.offline
    : withStoreCopy(VIEWS[mode], storeCopy);
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
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gokez-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gokez-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:ring-offset-slate-900"
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
