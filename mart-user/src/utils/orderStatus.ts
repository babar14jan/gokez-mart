export const ORDER_PROGRESS_LABELS = ['Order Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'];

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed', confirmed: 'Order Confirmed', preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery', ready_to_pickup: 'Being Prepared', picked_up: 'On the Way', delivered: 'Order Delivered',
  cancelled: 'Order Cancelled', failed_delivery: 'Delivery Failed', terminated: 'Cancelled by Store',
};

const CLOSED = ['cancelled', 'failed_delivery', 'terminated'];
const DELIVERED = ['delivered'];
export const ALL_CLOSED = [...CLOSED, ...DELIVERED];

export function isRecentlyDelivered(order: any): boolean {
  if (order.status !== 'delivered') return false;
  const updated = new Date(order.updatedAt || order.createdAt).getTime();
  return Date.now() - updated < 30 * 60 * 1000;
}

export function hasActiveOrder(orders: any[]): boolean {
  return orders.some(order => !ALL_CLOSED.includes(order.status));
}

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
    + ' at ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}