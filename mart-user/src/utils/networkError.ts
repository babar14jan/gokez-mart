/**
 * Honest, network-aware copy for a failed request.
 *
 * A transport-level failure (no HTTP response at all) means the device could
 * not reach the server — either it has no usable connection, or the server
 * never answered. Telling the customer "Invalid coupon" or "Your cart changed"
 * in that situation is simply false: nothing was checked. Every catch that
 * shows user-facing copy goes through here so the message always matches the
 * real cause.
 */
export function requestErrorMessage(err: any, fallback: string): string {
  if (!err?.response) {
    return typeof navigator !== 'undefined' && !navigator.onLine
      ? 'You\u2019re offline. Check your connection and try again.'
      : 'We could not reach Gokez Mart right now. Please try again shortly.';
  }
  return err.response.data?.error || fallback;
}

/** True when the request never received an HTTP response (offline / server unreachable). */
export function isTransportFailure(err: any): boolean {
  return !err?.response;
}
