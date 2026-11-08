const TERMINAL = ['delivered', 'cancelled', 'failed_delivery', 'terminated'];

/**
 * The date an order should be browsed under in the hub.
 *
 * Active scheduled orders belong to their delivery slot, delivered orders to
 * the moment they were delivered, and stopped orders to the event that ended
 * them. Everything else stays on the date it was placed.
 */
export function orderBrowseDate(order: any): Date {
  if (order.deliveryPreference === 'scheduled' && !TERMINAL.includes(order.status) && order.scheduledFor) {
    return new Date(order.scheduledFor);
  }
  if (order.status === 'delivered' && order.deliveredAt) return new Date(order.deliveredAt);
  if (TERMINAL.includes(order.status)) {
    const terminalEvent = [...(order.statusEvents || [])]
      .reverse()
      .find((event: any) => event.toStatus === order.status);
    if (terminalEvent?.createdAt) return new Date(terminalEvent.createdAt);
  }
  return new Date(order.createdAt);
}
