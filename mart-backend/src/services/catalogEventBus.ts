import { EventEmitter } from 'events';
import { CatalogService } from './catalog.service';

export interface CatalogChangeEvent {
  stamp: string;
}

interface CatalogScope {
  storeId: string;
  zoneId?: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

const subscribers = new Map<string, number>();
const timers = new Map<string, NodeJS.Timeout>();
const lastStamps = new Map<string, string>();

const scopeKey = ({ storeId, zoneId }: CatalogScope) => zoneId ? `zone:${zoneId}` : `store:${storeId}`;
const MAX_SCOPES = 100;

const readStamp = (scope: CatalogScope) => CatalogService.getScopedStamp(scope.storeId, scope.zoneId);

export function subscribeToCatalog(
  scope: CatalogScope,
  listener: (event: CatalogChangeEvent) => void,
  stampReader: (scope: CatalogScope) => Promise<string> = readStamp
): () => void {
  const key = scopeKey(scope);
  if (!timers.has(key) && timers.size >= MAX_SCOPES) throw new Error('Catalog stream limit reached');
  bus.on(key, listener);
  subscribers.set(key, (subscribers.get(key) ?? 0) + 1);

  if (!timers.has(key)) {
    void stampReader(scope).then(stamp => {
      if (timers.has(key)) lastStamps.set(key, stamp);
    }).catch(() => {});
    const timer = setInterval(() => {
      void stampReader(scope).then(stamp => {
        if (!timers.has(key) || stamp === lastStamps.get(key)) return;
        lastStamps.set(key, stamp);
        bus.emit(key, { stamp } satisfies CatalogChangeEvent);
      }).catch(() => {});
    }, 5000);
    timers.set(key, timer);
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    bus.off(key, listener);
    const remaining = (subscribers.get(key) ?? 1) - 1;
    if (remaining > 0) {
      subscribers.set(key, remaining);
      return;
    }
    subscribers.delete(key);
    const timer = timers.get(key);
    if (timer) clearInterval(timer);
    timers.delete(key);
    lastStamps.delete(key);
  };
}
