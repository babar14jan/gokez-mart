import { query } from '../database/db';
import type { FunnelEventName } from './funnelEvent.service';

export type FunnelRange = 'today' | '7d' | '30d' | '90d' | 'all';

const RANGE_DAYS: Record<FunnelRange, number | null> = { today: null, '7d': 7, '30d': 30, '90d': 90, all: null };

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface FunnelDailyPoint {
  date: string;
  requested: number;
  verified: number;
  ordered: number;
}

export interface FunnelSummary {
  range: FunnelRange;
  stages: FunnelStage[];
  dropoff: {
    retriedNeverVerified: number;
    verifiedNeverOrdered: number;
    avgOtpRequests: number;
  };
  daily: FunnelDailyPoint[];
  totals: {
    customers: number;
    orders: number;
    revenue: number;
  };
}

// One row per lead, with the two drop-off signals resolved up front.
// An order counts against a lead when it is tied to the verified customer OR
// was placed as a guest using the same phone, so a customer who ordered
// before logging in is not counted as a non-buyer.
const LEAD_BASE = (range: FunnelRange) => `
  SELECT
    l.id,
    l.otp_request_count,
    l.first_otp_requested_at,
    l.verified_at,
    (l.otp_request_count > 1 AND l.verified_at IS NULL) AS retried_never_verified,
    EXISTS (
      SELECT 1 FROM mart_orders o
      WHERE o.customer_id = l.customer_id OR o.guest_phone = l.phone
    ) AS has_order,
    EXISTS (
      SELECT 1 FROM mart_orders o
      WHERE (o.customer_id = l.customer_id OR o.guest_phone = l.phone)
        AND o.status = 'delivered'
    ) AS has_delivered
  FROM mart_customer_leads l
  WHERE ${RANGE_WHERE('l.first_otp_requested_at', range)}
`;

interface FunnelAggregateRow {
  leads: number;
  verified: number;
  ordered: number;
  delivered: number;
  retried_never_verified: number;
  verified_never_ordered: number;
  avg_otp_requests: string | number;
}

export class FunnelService {
  static async getSummary(range: FunnelRange): Promise<FunnelSummary> {
    const days = RANGE_DAYS[range];

    const [aggregate, daily, totals] = await Promise.all([
      query<FunnelAggregateRow>(
        `WITH lead_base AS (${LEAD_BASE(range)})
         SELECT COUNT(*)::int                                            AS leads,
                COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::int      AS verified,
                COUNT(*) FILTER (WHERE has_order)::int                    AS ordered,
                COUNT(*) FILTER (WHERE has_delivered)::int                AS delivered,
                COUNT(*) FILTER (WHERE retried_never_verified)::int       AS retried_never_verified,
                COUNT(*) FILTER (WHERE verified_at IS NOT NULL
                                   AND NOT has_order)::int               AS verified_never_ordered,
                COALESCE(ROUND(AVG(otp_request_count)::numeric, 2), 0)    AS avg_otp_requests
         FROM lead_base`,
        [days]
      ),
      query<FunnelDailyPoint>(
        `WITH lead_base AS (${LEAD_BASE(range)})
         SELECT to_char(DATE_TRUNC('day', first_otp_requested_at), 'YYYY-MM-DD') AS date,
                COUNT(*)::int                                        AS requested,
                COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::int  AS verified,
                COUNT(*) FILTER (WHERE has_order)::int                AS ordered
         FROM lead_base
         GROUP BY 1
         ORDER BY 1`,
        [days]
      ),
      query<{ customers: number; orders: number; revenue: string | number }>(
        `SELECT (SELECT COUNT(*)::int FROM mart_customers)            AS customers,
                (SELECT COUNT(*)::int FROM mart_orders
                  WHERE status <> 'cancelled')                        AS orders,
                (SELECT COALESCE(SUM(total), 0) FROM mart_orders
                  WHERE status <> 'cancelled')                        AS revenue`
      ),
    ]);

    const row = aggregate.rows[0];
    const t = totals.rows[0];

    // An ungrouped aggregate always yields a row in Postgres, but the response
    // is not built on that assumption: an empty result renders as a zeroed
    // funnel rather than a 500 on the super admin's screen.
    const leads = row?.leads ?? 0;
    const verified = row?.verified ?? 0;
    const ordered = row?.ordered ?? 0;
    const delivered = row?.delivered ?? 0;

    const stages: FunnelStage[] = [
      { key: 'requested', label: 'Number entered', count: leads },
      { key: 'verified', label: 'OTP verified', count: verified },
      { key: 'ordered', label: 'Placed first order', count: ordered },
      { key: 'delivered', label: 'Order delivered', count: delivered },
    ];

    return {
      range,
      stages,
      dropoff: {
        retriedNeverVerified: row?.retried_never_verified ?? 0,
        verifiedNeverOrdered: row?.verified_never_ordered ?? 0,
        avgOtpRequests: Number(row?.avg_otp_requests ?? 0),
      },
      daily: daily.rows,
      totals: {
        customers: t?.customers ?? 0,
        orders: t?.orders ?? 0,
        revenue: Number(t?.revenue ?? 0),
      },
    };
  }

  /**
   * Phase 2 view. Everything above is derived from data that already existed;
   * this adds the parts that only become measurable once the first-party event
   * pipeline is live: visit volume, channel split, and dual attribution.
   *
   * Stages count DISTINCT sessions, never raw events, so a user who fires
   * `product_viewed` thirty times counts once. Counting events would make a
   * funnel that goes up, not down.
   */
  static async getExtended(range: FunnelRange): Promise<FunnelExtended> {
    const days = RANGE_DAYS[range];
    const base = await FunnelService.getSummary(range);

    const [eventRows, channelRows, attributionRows, cartRows] = await Promise.all([
      query<{ event_name: FunnelEventName; sessions: number }>(
        `SELECT event_name, COUNT(DISTINCT session_id)::int AS sessions
         FROM mart_funnel_events
         WHERE ${RANGE_WHERE('mart_funnel_events.created_at', range)}
         GROUP BY event_name`,
        [days]
      ),
      query<ChannelRow>(
        `SELECT s.channel,
                COUNT(*)::int AS sessions,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM mart_orders o
                  WHERE o.customer_id = s.customer_id
                ))::int AS ordered
         FROM mart_funnel_sessions s
         WHERE ${RANGE_WHERE('s.first_seen_at', range)}
         GROUP BY s.channel
         ORDER BY sessions DESC`,
        [days]
      ),
      query<AttributionRow>(
        `WITH touches AS (
           SELECT first_campaign_id AS campaign_id, 'first'::text AS touch, customer_id
           FROM mart_funnel_sessions
           WHERE first_campaign_id IS NOT NULL AND customer_id IS NOT NULL
           UNION ALL
           SELECT last_campaign_id, 'last', customer_id
           FROM mart_funnel_sessions
           WHERE last_campaign_id IS NOT NULL AND customer_id IS NOT NULL
         ),
         buyers AS (
           SELECT DISTINCT customer_id FROM mart_orders
           WHERE customer_id IS NOT NULL AND status <> 'cancelled'
         )
         SELECT c.id AS "campaignId",
                c.title AS "campaignName",
                c.coupon_code AS code,
                COUNT(DISTINCT t.customer_id) FILTER (
                  WHERE t.touch = 'first' AND b.customer_id IS NOT NULL)::int AS "firstTouchOrders",
                COUNT(DISTINCT t.customer_id) FILTER (
                  WHERE t.touch = 'last'  AND b.customer_id IS NOT NULL)::int AS "lastTouchOrders"
         FROM touches t
         JOIN mart_campaigns c ON c.id = t.campaign_id
         LEFT JOIN buyers b ON b.customer_id = t.customer_id
         GROUP BY c.id, c.title, c.coupon_code
         ORDER BY "lastTouchOrders" DESC, "firstTouchOrders" DESC`,
        []
      ),
      query<{ carts: number; reached_checkout: number; converted: number }>(
        `SELECT COUNT(*)::int AS carts,
                COUNT(*) FILTER (WHERE reached_checkout)::int AS reached_checkout,
                -- Only count conversions that still point at a real order. The
                -- column is ON DELETE SET NULL, so deleting an order withdraws
                -- its conversion rather than leaving the funnel claiming a sale
                -- that no longer exists.
                COUNT(*) FILTER (WHERE converted_at IS NOT NULL AND order_id IS NOT NULL)::int AS converted
         FROM mart_carts
         WHERE ${RANGE_WHERE('created_at', range)}`,
        [days]
      ),
    ]);

    const eventCounts = new Map(eventRows.rows.map(r => [r.event_name, r.sessions]));
    const eventStages: FunnelEventStage[] = EVENT_STAGE_DEFS.map(def => ({
      key: def.key,
      label: def.label,
      sessions: eventCounts.get(def.key) ?? 0,
    }));

    const cart = cartRows.rows[0];
    const reachedCheckout = cart?.reached_checkout ?? 0;
    const converted = cart?.converted ?? 0;

    return {
      ...base,
      eventStages,
      channels: channelRows.rows,
      attribution: attributionRows.rows,
      cart: {
        carts: cart?.carts ?? 0,
        reachedCheckout,
        converted,
        // "Reached checkout and never ordered" is the number worth watching.
        abandoned: Math.max(0, reachedCheckout - converted),
      },
    };
  }
}

// ── Phase 2: event-derived funnel, channels and dual attribution ─────────────

export interface FunnelEventStage {
  key: FunnelEventName;
  label: string;
  sessions: number;
}

export interface ChannelRow {
  channel: string;
  sessions: number;
  ordered: number;
}

export interface AttributionRow {
  campaignId: string;
  campaignName: string;
  code: string;
  firstTouchOrders: number;
  lastTouchOrders: number;
}

export interface FunnelExtended extends FunnelSummary {
  eventStages: FunnelEventStage[];
  channels: ChannelRow[];
  attribution: AttributionRow[];
  cart: {
    carts: number;
    reachedCheckout: number;
    converted: number;
    abandoned: number;
  };
}

const EVENT_STAGE_DEFS: Array<{ key: FunnelEventName; label: string }> = [
  { key: 'session_start', label: 'Session started' },
  { key: 'login_viewed', label: 'Login screen viewed' },
  { key: 'login_field_focused', label: 'Mobile field focused' },
  { key: 'login_number_entered', label: 'Number entered' },
  { key: 'otp_requested', label: 'OTP requested' },
  { key: 'otp_viewed', label: 'OTP screen viewed' },
  { key: 'login_verified', label: 'OTP verified' },
  { key: 'product_viewed', label: 'Product viewed' },
  { key: 'cart_added', label: 'Added to cart' },
  { key: 'checkout_started', label: 'Checkout started' },
  { key: 'order_completed', label: 'Order completed' },
];

const RANGE_WHERE = (column: string, range: FunnelRange): string =>
  // "Today" is one calendar day from midnight, not a sliding 24h window --
  // "1 day" would spill into yesterday evening. Number ranges stay as sliding
  // windows, which is the semantics the labels imply.
  range === 'today'
    ? `${column} >= date_trunc('day', NOW())`
    : `($1::int IS NULL OR ${column} >= NOW() - ($1::int * INTERVAL '1 day'))`;
