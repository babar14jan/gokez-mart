export type CancellationPolicyOrder = {
  status: string;
  deliveryPreference?: string | null;
  scheduledFor?: string | Date | null;
  promisedDeliveryAt?: string | Date | null;
  cancellationWindowEndsAt?: string | Date | null;
};

export type CancellationPolicy = {
  canCancel: boolean;
  reason: string | null;
  windowEndsAt: string | null;
  promisedDeliveryAt: string | null;
  canReportDelay: boolean;
  canEditAddress: boolean;
  message: string;
};

const asDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asIso = (value: string | Date | null | undefined): string | null => asDate(value)?.toISOString() ?? null;

export function getCancellationPolicy(order: CancellationPolicyOrder, now = new Date()): CancellationPolicy {
  const promisedDeliveryAt = asDate(order.promisedDeliveryAt)
    ?? (order.deliveryPreference === 'scheduled' ? asDate(order.scheduledFor) : null);
  const storedWindowEnd = asDate(order.cancellationWindowEndsAt);
  const scheduledCutoff = storedWindowEnd
    ?? (order.deliveryPreference === 'scheduled' && promisedDeliveryAt
      ? new Date(promisedDeliveryAt.getTime() - 30 * 60 * 1000)
      : null);
  const windowEndsAt = scheduledCutoff?.toISOString() ?? null;
  const canReportDelay = Boolean(promisedDeliveryAt && now.getTime() > promisedDeliveryAt.getTime());
  const canEditAddress = ['pending', 'confirmed'].includes(order.status);

  if (!['pending', 'confirmed'].includes(order.status)) {
    return {
      canCancel: false,
      reason: 'This order can no longer be cancelled because preparation has started or it has already been completed.',
      windowEndsAt,
      promisedDeliveryAt: promisedDeliveryAt?.toISOString() ?? null,
      canReportDelay,
      canEditAddress: false,
      message: 'Please contact support if you still need help with this order.',
    };
  }
  if (scheduledCutoff && now.getTime() >= scheduledCutoff.getTime()) {
    return {
      canCancel: false,
      reason: 'Scheduled orders can be cancelled until 30 minutes before the delivery time.',
      windowEndsAt,
      promisedDeliveryAt: promisedDeliveryAt?.toISOString() ?? null,
      canReportDelay,
      canEditAddress,
      message: 'The scheduled cancellation window has closed. Please contact support for help.',
    };
  }
  return {
    canCancel: true,
    reason: null,
    windowEndsAt,
    promisedDeliveryAt: promisedDeliveryAt?.toISOString() ?? null,
    canReportDelay,
    canEditAddress,
    message: 'You can cancel this order until preparation begins.',
  };
}

export const CUSTOMER_CANCELLATION_MESSAGES: Record<string, string> = {
  ordered_by_mistake: 'Customer says this order was placed by mistake.',
  changed_my_mind: 'Customer says they changed their mind about this order.',
  wrong_address: 'Customer reports incorrect address or delivery details; check before dispatch.',
  duplicate_order: 'Customer reports this is a duplicate order.',
  found_better_price: 'Customer found a better price elsewhere.',
  delivery_too_slow: 'Customer reports delivery has passed the promised window.',
  other: 'Customer requested cancellation.',
};