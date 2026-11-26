import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { newIdempotencyKey } from '@/utils/idempotency';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
const CHANNEL_ALLOW = /^[a-z0-9_-]{1,32}$/i;

export interface FunnelState {
  sessionId: string;
  visitorId: string;
  channel: string;
  lastActiveAt: number;
  getSessionId: () => string;
  getVisitorId: () => string;
  setChannelFrom: (input: string | null | undefined) => string;
  resetSession: () => string;
}

function newId(): string {
  return newIdempotencyKey();
}

function parseChannel(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'unattributed';
  const fromQuery = raw.match(/[?&#](?:ch|channel)=([a-z0-9_-]{1,32})/i) ?? raw.match(/utm_source=([a-z0-9_-]{1,32})/i);
  const candidate = fromQuery?.[1] ?? raw;
  return CHANNEL_ALLOW.test(candidate) ? candidate.toLowerCase() : 'unattributed';
}

export const useFunnelStore = create<FunnelState>()(
  persist(
    (set, get) => ({
      sessionId: newId(),
      visitorId: newId(),
      channel: 'unattributed',
      lastActiveAt: Date.now(),
      getSessionId: () => {
        const { sessionId, lastActiveAt } = get();
        const expired = !sessionId || sessionId.length > 64 || !lastActiveAt
          || Date.now() - lastActiveAt > SESSION_IDLE_MS;
        if (expired) return get().resetSession();
        set({ lastActiveAt: Date.now() });
        return sessionId;
      },
      getVisitorId: () => {
        const { visitorId } = get();
        if (visitorId) return visitorId;
        const fresh = newId();
        set({ visitorId: fresh });
        return fresh;
      },
      setChannelFrom: (input: string | null | undefined) => {
        const channel = parseChannel(input);
        set({ channel });
        return channel;
      },
      resetSession: () => {
        const sessionId = newId();
        set({ sessionId, lastActiveAt: Date.now() });
        return sessionId;
      },
    }),
    { name: 'mart-funnel', storage: createJSONStorage(() => AsyncStorage) }
  )
);
