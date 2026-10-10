import { api } from './api';

// Client-side live order stream. Backs the hub's "new order / status change"
// signals with a Server-Sent-Event connection so an open tab gets the event
// instantly even when web-push (which the browser/push-service controls) is
// delayed on a weak or flaky network.
//
// Resilience for bad connections:
//  - automatic reconnect with exponential backoff (1s → 20s)
//  - a stall watchdog aborts the stream if no bytes arrive for 90s (the socket
//    can sit "open" on dead links), forcing a fresh connection
//  - onOrdersStreamConnect notifies subscribers after every (re)connect so
//    pages can refetch and catch up on whatever was missed while offline

export interface LiveOrderPayload {
  id: string;
  orderNumber?: string;
  status?: string;
  total?: number;
  guestName?: string;
  storeId?: string;
}

export interface LiveOrderEvent {
  type: 'order.created' | 'order.updated';
  order: LiveOrderPayload;
}

type EventListener = (event: LiveOrderEvent) => void;
type ConnectListener = () => void;

const STALL_MS = 90_000;
const MAX_BACKOFF_MS = 20_000;
const WATCHDOG_MS = 15_000;

let started = false;
let controller: AbortController | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastDataAt = 0;
let retryDelay = 1000;

const eventListeners = new Set<EventListener>();
const connectListeners = new Set<ConnectListener>();

function bearerToken(): string {
  return localStorage.getItem('mart_admin_token') || '';
}

function dispatch(event: LiveOrderEvent): void {
  eventListeners.forEach(l => { try { l(event); } catch { /* ignore */ } });
}

function signalConnected(): void {
  retryDelay = 1000;
  connectListeners.forEach(l => { try { l(); } catch { /* ignore */ } });
}

function stopWatchdog(): void {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

function scheduleReconnect(): void {
  stopWatchdog();
  if (!started) return;
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(connectStream, delay);
}

function clearTimers(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopWatchdog();
}

async function connectStream(): Promise<void> {
  if (!started) return;
  controller = new AbortController();
  lastDataAt = Date.now();
  try {
    const res = await fetch(`${api.defaults.baseURL}/admin/events`, {
      headers: { Authorization: `Bearer ${bearerToken()}` },
      signal: controller.signal,
    });
    if (res.status === 401) {
      // Token is gone/expired — stop reconnecting. The next successful login
      // (App's isAuthenticated effect) restarts the stream with the new token.
      stopOrderStream();
      return;
    }
    if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
    signalConnected();

    watchdog = setInterval(() => {
      if (Date.now() - lastDataAt > STALL_MS) controller?.abort();
    }, WATCHDOG_MS);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastDataAt = Date.now();
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let sep = buf.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            try { dispatch(JSON.parse(line.slice(6))); } catch { /* skip malformed frame */ }
          }
        }
        sep = buf.indexOf('\n\n');
      }
    }
  } catch {
    // aborted, network error, or server closed — reconnect below
  } finally {
    stopWatchdog();
    scheduleReconnect();
  }
}

export function startOrderStream(): void {
  if (started) return;
  started = true;
  connectStream();
}

export function stopOrderStream(): void {
  started = false;
  clearTimers();
  if (controller) { controller.abort(); controller = null; }
}

export function onOrderEvent(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function onOrderStreamConnect(listener: ConnectListener): () => void {
  connectListeners.add(listener);
  return () => connectListeners.delete(listener);
}