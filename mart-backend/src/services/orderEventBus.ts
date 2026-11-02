import { EventEmitter } from 'events';

// In-process relay for live order events. The hub holds a Server-Sent-Event
// stream on /admin/events and gets an instant, network-agnostic signal whenever
// an order is placed or changes status — instead of relying only on web-push,
// whose delivery the browser/push-service controls (and which can lag badly on
// a weak or flaky connection).
export interface OrderLivePayload {
  id: string;
  orderNumber?: string;
  status?: string;
  total?: number;
  guestName?: string;
  /** Head store that owns the order. */
  storeId?: string;
  /** Every store with lines in the order, so member stores get live updates too. */
  storeIds?: string[];
}

export interface OrderLiveEvent {
  type: 'order.created' | 'order.updated';
  order: OrderLivePayload;
}

export const orderEventBus = new EventEmitter();
orderEventBus.setMaxListeners(0);

export const emitOrderEvent = (event: OrderLiveEvent): void => {
  orderEventBus.emit('order', event);
};