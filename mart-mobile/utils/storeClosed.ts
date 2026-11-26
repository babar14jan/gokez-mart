import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicSettings } from '@/services/api';

const CLOSED_COPY_KEY = 'mart-closed-copy';

export interface StoreClosedCopy {
  greeting: string;
  message: string;
}

type ClosedSettings = Pick<PublicSettings, 'openState' | 'store_open'> | null | undefined;

export function isStoreOpen(settings?: ClosedSettings): boolean {
  const openState = settings?.openState;
  if (openState && typeof openState.isOpen === 'boolean') return openState.isOpen;
  const raw = String(settings?.store_open ?? '').trim().toLowerCase();
  if (!raw) return true;
  if (['true', '1', 'yes', 'open'].includes(raw)) return true;
  return false;
}

export function isStoreClosed(settings?: ClosedSettings): boolean {
  return !isStoreOpen(settings);
}

export function defaultClosedHeading(): string {
  return 'Your neighbourhood store is closed right now.';
}

export function reopenLine(resumeLabel?: string | null): string {
  if (!resumeLabel) {
    return "You can still place your order — we'll start delivering as soon as we reopen.";
  }
  return `You can still place your order — we'll start delivering ${resumeLabel}.`;
}

export function reopenBlockLine(resumeLabel?: string | null): string {
  if (!resumeLabel) {
    return "You can still place your order — we'll deliver it as soon as we reopen.";
  }
  return "You can still place your order — we'll deliver it then.";
}

export function formatClosedMessage(
  template?: string | null,
  options?: string | null | { until?: string | null; resumeLabel?: string | null },
): string {
  const until = typeof options === 'string'
    ? options
    : options?.until ?? options?.resumeLabel ?? '';
  const source = String(template ?? '').trim();
  if (!source) {
    return `${defaultClosedHeading()} ${until ? reopenLine(until) : ''}`.trim();
  }
  return source
    .replace(/\{\s*until\s*\}/gi, String(until ?? '').trim())
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let closedCopy: StoreClosedCopy | null = null;
let hydratePromise: Promise<void> | null = null;

function hydrateClosedCopy(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getItem(CLOSED_COPY_KEY)
      .then(value => {
        if (!value) return;
        const parsed = JSON.parse(value);
        if (parsed?.greeting || parsed?.message) {
          closedCopy = { greeting: String(parsed.greeting ?? ''), message: String(parsed.message ?? '') };
        }
      })
      .catch(() => undefined);
  }
  return hydratePromise;
}

void hydrateClosedCopy();

export function rememberClosedCopy(greeting?: string | null, message?: string | null): void {
  const g = String(greeting ?? '').trim();
  const m = String(message ?? '').trim();
  if (!g && !m) {
    closedCopy = null;
    void AsyncStorage.removeItem(CLOSED_COPY_KEY).catch(() => undefined);
    return;
  }
  closedCopy = { greeting: g, message: m };
  void AsyncStorage.setItem(CLOSED_COPY_KEY, JSON.stringify(closedCopy)).catch(() => undefined);
}

export function readClosedCopy(): StoreClosedCopy | null {
  void hydrateClosedCopy();
  return closedCopy;
}

export function closedMessage(settings?: Pick<PublicSettings, 'store_closed_message' | 'openState'> | null): string {
  return formatClosedMessage(settings?.store_closed_message, settings?.openState?.closedUntilLabel);
}
