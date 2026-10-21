/**
 * Timeouts for outbound HTTP calls.
 *
 * Node's global fetch has no useful default: undici allows 300 seconds for
 * both the header and body timeouts. A call that hangs therefore holds an
 * HTTP request, a socket, and — when it happens inside a transaction — a
 * database connection, for five minutes. A third party that is slow, rate
 * limited or unreachable must not be able to pin the service.
 *
 * Each limit is set for the endpoint it belongs to:
 *
 *   geocode        — a free public geocoding service with no SLA. It is
 *                    optional, so it gets the tightest budget: the customer
 *                    is better served by being asked to type their address
 *                    than by waiting.
 *   storageUpload  — a product or profile image upload. The body is a
 *                    re-encoded WebP of at most 1200px, so it is small, but
 *                    it travels over the network, so it gets more room than
 *                    the geocode call.
 *   otpSms         — the SMS provider on the critical path of a customer
 *                    signing in. It gets the most room, because failing here
 *                    blocks a login rather than a convenience.
 */
export const OUTBOUND_TIMEOUTS = {
  geocode: 8_000,
  storageUpload: 15_000,
  otpSms: 10_000,
} as const;

/**
 * An abort signal that fires after the given number of milliseconds.
 *
 * `AbortSignal.timeout` is available in Node 20 and is the right tool here:
 * it does not need clearing afterwards, and it aborts the body stream as well
 * as the headers, so a response that starts arriving and then stalls is
 * caught too.
 */
export function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
