const TERMINAL = ['delivered', 'cancelled', 'failed_delivery', 'terminated'];

type HubDateRange = 'today' | 'yesterday' | 'custom' | 'all';

const istDay = (offsetDays = 0) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** Backend params for the same IST browse-day window the hub chips display. */
export function hasCompleteCustomRange(range: HubDateRange | null, from: string, to: string) {
  return range !== 'custom' || Boolean(from && to);
}

export function orderListDateParams(range: HubDateRange | null, from: string, to: string) {
  if (range === 'yesterday') {
    const day = istDay(-1);
    return { range: 'custom' as const, from: day, to: day, dateBasis: 'browse' as const };
  }
  if (range === 'custom') {
    return { range: 'custom' as const, from: from || undefined, to: to || undefined, dateBasis: 'browse' as const };
  }
  if (range === 'today') return { range: 'today' as const, dateBasis: 'browse' as const };
  return { range: 'all' as const, dateBasis: 'browse' as const };
}

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
