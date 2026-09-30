import { query } from '../database/db';

/**
 * First-party funnel instrumentation. No third-party tracker is involved
 * anywhere in this file or its callers.
 *
 * Privacy posture:
 *   - `props` is scrubbed against a key allowlist and size-capped, so a caller
 *     cannot accidentally persist a phone number, token or address.
 *   - Nothing here stores personal data. The customer link is written by
 *     `linkSessionToCustomer`, which the auth controller calls only after a
 *     successful OTP verification, when the phone is already in hand.
 */

export const FUNNEL_EVENTS = [
  'session_start',
  'login_viewed',
  'login_field_focused',
  'login_number_entered',
  'otp_requested',
  'otp_viewed',
  'login_verified',
  'login_abandoned',
  'product_viewed',
  'cart_added',
  'cart_updated',
  'cart_removed',
  'cart_cleared',
  'checkout_started',
  'order_completed',
] as const;

export type FunnelEventName = typeof FUNNEL_EVENTS[number];

/**
 * Only these prop keys are ever stored. Anything else is dropped rather than
 * rejected, so a caller adding a new key cannot break the client but also
 * cannot leak a new field by accident.
 */
const ALLOWED_PROP_KEYS = new Set([
  'productId', 'productName', 'unit', 'quantity', 'itemCount', 'subtotal',
  'orderId', 'orderNumber', 'step', 'campaignId', 'code', 'channel', 'value',
  'hasItems', 'source', 'attempt', 'reason',
]);

const MAX_PROPS_BYTES = 1024;
/** Shared so the cart service truncates a session id to the same bound. */
export const MAX_SESSION_ID_LENGTH = 64;
const MAX_PATH_LENGTH = 300;
const VALID_CHANNEL = /^[a-z0-9_-]{1,32}$/i;

const isFunnelEvent = (value: unknown): value is FunnelEventName =>
  typeof value === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(value);

function sanitiseString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function sanitiseProps(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, 120);
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  // A phone number can never be a legitimate funnel prop, but strip anything
  // that looks like one regardless of key, as a second line of defence.
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'string' && /\d{10}/.test(out[key] as string)) delete out[key];
  }
  const encoded = JSON.stringify(out);
  if (encoded.length <= MAX_PROPS_BYTES) return out;
  // Too large: keep the first keys that fit rather than storing a truncated
  // JSON string that would not parse back out of JSONB cleanly.
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(out)) {
    if (JSON.stringify({ ...trimmed, [key]: value }).length > MAX_PROPS_BYTES) break;
    trimmed[key] = value;
  }
  return trimmed;
}

export function normaliseChannel(value: unknown): string {
  if (typeof value !== 'string') return 'unattributed';
  // Length is checked BEFORE any truncation. Truncating first would let a
  // 99-character label be cut to a 32-character string that then passes the
  // pattern, silently manufacturing a junk channel bucket.
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return 'unattributed';
  return VALID_CHANNEL.test(trimmed) ? trimmed.toLowerCase() : 'unattributed';
}

export class FunnelEventService {
  /**
   * Idempotent session touch. A session row is created on first sight and only
   * bumps `last_seen_at` afterwards, so replayed beacons cannot inflate the
   * session count.
   */
  static async touchSession(params: {
    sessionId: string;
    channel?: string;
    landingPath?: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  }): Promise<void> {
    const sessionId = sanitiseString(params.sessionId, MAX_SESSION_ID_LENGTH);
    if (!sessionId) return;
    await query(
      `INSERT INTO mart_funnel_sessions
         (session_id, channel, landing_path, referrer, utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET last_seen_at = NOW()`,
      [
        sessionId,
        normaliseChannel(params.channel),
        sanitiseString(params.landingPath, MAX_PATH_LENGTH),
        sanitiseString(params.referrer, MAX_PATH_LENGTH),
        sanitiseString(params.utmSource, 120),
        sanitiseString(params.utmMedium, 120),
        sanitiseString(params.utmCampaign, 120),
      ]
    );
  }

  static async recordEvent(params: {
    sessionId: string;
    eventName: string;
    path?: string;
    props?: unknown;
    channel?: string;
  }): Promise<boolean> {
    const sessionId = sanitiseString(params.sessionId, MAX_SESSION_ID_LENGTH);
    if (!sessionId) return false;
    if (!isFunnelEvent(params.eventName)) return false;

    // The session row must exist first: an event with no session would be an
    // orphan that no aggregation could ever join back to a visitor.
    await FunnelEventService.touchSession({
      sessionId,
      channel: params.channel,
      landingPath: params.path,
    });
    await query(
      `INSERT INTO mart_funnel_events (session_id, event_name, path, props)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, params.eventName, sanitiseString(params.path, MAX_PATH_LENGTH), JSON.stringify(sanitiseProps(params.props))]
    );
    return true;
  }

  /**
   * Called by the auth controller after a successful OTP verification. The
   * customer id is already known there, so the session becomes attributable
   * without any personal data ever entering the events table.
   */
  static async linkSessionToCustomer(sessionId: string, customerId: string): Promise<void> {
    const sid = sanitiseString(sessionId, MAX_SESSION_ID_LENGTH);
    if (!sid || !customerId) return;
    await query(
      `UPDATE mart_funnel_sessions
       SET customer_id = $2,
           last_seen_at = NOW()
       WHERE session_id = $1`,
      [sid, customerId]
    );
  }

  /**
   * Resolves the verified customer behind an anonymous session.
   *
   * `linkSessionToCustomer` above is a bare UPDATE, so a session_id can only
   * carry a customer_id if that session actually completed OTP verification.
   * Reading the link back is therefore a safe way for an unauthenticated request
   * to attach itself to a customer -- unlike trusting a customer_id supplied in
   * the request body, which lets anyone name any account.
   */
  static async resolveSessionCustomer(sessionId: string): Promise<string | null> {
    const sid = sanitiseString(sessionId, MAX_SESSION_ID_LENGTH);
    if (!sid) return null;
    const result = await query<{ customer_id: string | null }>(
      `SELECT customer_id FROM mart_funnel_sessions WHERE session_id = $1`,
      [sid]
    );
    return result.rows[0]?.customer_id ?? null;
  }

  /** Records a campaign impression so first-touch and last-touch can differ. */
  static async recordCampaignTouch(sessionId: string, campaignId: string): Promise<void> {
    const sid = sanitiseString(sessionId, MAX_SESSION_ID_LENGTH);
    if (!sid || !campaignId) return;
    await query(
      `UPDATE mart_funnel_sessions
       SET first_campaign_id = COALESCE(first_campaign_id, $2),
           last_campaign_id = $2,
           last_seen_at = NOW()
       WHERE session_id = $1`,
      [sid, campaignId]
    );
  }
}
