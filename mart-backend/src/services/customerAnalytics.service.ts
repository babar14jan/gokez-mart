import { query } from '../database/db';
import type { FunnelRange } from './funnel.service';

const where = (column: string, range: FunnelRange, from?: string, to?: string): string => {
  if (range === 'custom') return from && to ? `${column} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')` : 'FALSE';
  if (range === 'today') return `${column} >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : null;
  return `($1::int IS NULL OR ${column} >= ((date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - (($1::int - 1) * INTERVAL '1 day')))`;
};
const params = (range: FunnelRange, from?: string, to?: string): unknown[] => range === 'custom' ? [from, to] : range === 'today' ? [] : [range === '7d' ? 7 : range === '30d' ? 30 : null];

export class CustomerAnalyticsService {
  static async getReport(range: FunnelRange, from?: string, to?: string) {
    const values = params(range, from, to);
    const sessionWhere = where('s.first_seen_at', range, from, to);
    const eventWhere = where('e.created_at', range, from, to);
    const orderWhere = where('o.created_at', range, from, to);
    const deliveryWhere = where('o.delivered_at', range, from, to);
    const [funnel, visitorLifecycle, customerLifecycle, events, otp, orders, channels, reconciliation] = await Promise.all([
      query<{ sessions: number; visitors: number; discovery: number; cart: number; checkout: number; ordered: number }>(
        `WITH flags AS (
          SELECT s.session_id, s.visitor_id,
            EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name = 'product_viewed') AS discovery,
            EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
            EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout,
            EXISTS (SELECT 1 FROM mart_orders o WHERE o.funnel_session_id = s.session_id AND ${orderWhere}) AS ordered
          FROM mart_funnel_sessions s WHERE ${sessionWhere}
        ) SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
          COUNT(*) FILTER (WHERE discovery OR cart OR checkout OR ordered)::int AS discovery,
          COUNT(*) FILTER (WHERE cart OR checkout OR ordered)::int AS cart,
          COUNT(*) FILTER (WHERE checkout OR ordered)::int AS checkout,
          COUNT(*) FILTER (WHERE ordered)::int AS ordered FROM flags`, values),
      query<{ new_visitors: number; returning_visitors: number }>(
        `WITH scoped AS (
            SELECT COALESCE(s.visitor_id, s.session_id) AS visitor_key,
                s.visitor_id,
                MIN(s.first_seen_at) AS first_session_in_range
           FROM mart_funnel_sessions s WHERE ${sessionWhere}
            GROUP BY COALESCE(s.visitor_id, s.session_id), s.visitor_id
         )
         SELECT COUNT(*) FILTER (
                  WHERE s.visitor_id IS NULL OR NOT EXISTS (
                    SELECT 1 FROM mart_funnel_sessions prior
                    WHERE prior.visitor_id = s.visitor_id AND prior.first_seen_at < s.first_session_in_range
                  )
                )::int AS new_visitors,
                COUNT(*) FILTER (
                  WHERE s.visitor_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM mart_funnel_sessions prior
                    WHERE prior.visitor_id = s.visitor_id AND prior.first_seen_at < s.first_session_in_range
                  )
                )::int AS returning_visitors
         FROM scoped s`, values),
      query<{ new_customers: number; returning_customers: number }>(
        `WITH delivered_in_range AS (
           SELECT o.customer_id, MIN(o.delivered_at) AS first_delivery_in_range
           FROM mart_orders o
           WHERE o.status = 'delivered'
             AND o.customer_id IS NOT NULL
             AND o.delivered_at IS NOT NULL
             AND ${deliveryWhere}
           GROUP BY o.customer_id
         )
         SELECT COUNT(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM mart_orders prior
             WHERE prior.customer_id = customer.customer_id
               AND prior.status = 'delivered'
               AND prior.delivered_at < customer.first_delivery_in_range
           )
         )::int AS new_customers,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM mart_orders prior
             WHERE prior.customer_id = customer.customer_id
               AND prior.status = 'delivered'
               AND prior.delivered_at < customer.first_delivery_in_range
           )
         )::int AS returning_customers
         FROM delivered_in_range customer`, values),
      query<{ event_name: string; count: number }>(`SELECT e.event_name, COUNT(*)::int AS count FROM mart_funnel_events e WHERE ${eventWhere} GROUP BY e.event_name`, values),
      query<{ mobile_interactions: number; otp_requests: number; otp_verified: number }>(
        `SELECT COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'login_field_focused')::int AS mobile_interactions,
                COUNT(*) FILTER (WHERE e.event_name = 'otp_requested')::int AS otp_requests,
                COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'login_verified')::int AS otp_verified
         FROM mart_funnel_events e WHERE ${eventWhere}`,
        values
      ),
      query<{ placed: number; accepted: number; preparing: number; out_for_delivery: number; delivered: number; paid: number; cancelled: number; gmv: string | number }>(
        `SELECT COUNT(*)::int AS placed, COUNT(*) FILTER (WHERE status IN ('confirmed','preparing','picked_up','out_for_delivery','delivered'))::int AS accepted,
          COUNT(*) FILTER (WHERE status IN ('preparing','picked_up','out_for_delivery','delivered'))::int AS preparing,
          COUNT(*) FILTER (WHERE status IN ('out_for_delivery','delivered'))::int AS out_for_delivery,
          COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered, COUNT(*) FILTER (WHERE payment_collected_at IS NOT NULL)::int AS paid,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0) AS gmv
         FROM mart_orders o WHERE ${orderWhere}`, values),
      query<{ source: string; medium: string; campaign: string | null; sessions: number; cart_sessions: number; checkout_sessions: number; orders: number }>(
        `WITH flags AS (SELECT s.session_id, COALESCE(NULLIF(s.source, ''), CASE WHEN s.channel = 'unattributed' THEN 'direct' ELSE s.channel END) AS source,
          COALESCE(NULLIF(s.medium, ''), CASE WHEN s.channel = 'qr' THEN 'qr' WHEN s.channel = 'unattributed' THEN 'none' ELSE 'referral' END) AS medium, NULLIF(s.utm_campaign, '') AS campaign,
          EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
          EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout,
          EXISTS (SELECT 1 FROM mart_orders o WHERE o.funnel_session_id = s.session_id AND ${orderWhere}) AS ordered
          FROM mart_funnel_sessions s WHERE ${sessionWhere})
         SELECT source, medium, campaign, COUNT(*)::int AS sessions, COUNT(*) FILTER (WHERE cart)::int AS cart_sessions,
          COUNT(*) FILTER (WHERE checkout)::int AS checkout_sessions, COUNT(*) FILTER (WHERE ordered)::int AS orders FROM flags GROUP BY source, medium, campaign ORDER BY sessions DESC`, values),
      query<{ total: number; attributed: number; guest: number }>(
        `WITH scoped AS (SELECT o.id, o.customer_id, o.funnel_session_id FROM mart_orders o WHERE ${orderWhere}), attributed AS (SELECT id FROM scoped WHERE funnel_session_id IS NOT NULL)
         SELECT (SELECT COUNT(*)::int FROM scoped) AS total, (SELECT COUNT(*)::int FROM attributed) AS attributed, (SELECT COUNT(*)::int FROM scoped WHERE customer_id IS NULL) AS guest`, values),
    ]);
    const f = funnel.rows[0] ?? { sessions: 0, visitors: 0, discovery: 0, cart: 0, checkout: 0, ordered: 0 };
    const visitors = visitorLifecycle.rows[0] ?? { new_visitors: 0, returning_visitors: 0 };
    const customers = customerLifecycle.rows[0] ?? { new_customers: 0, returning_customers: 0 };
    const o = orders.rows[0] ?? { placed: 0, accepted: 0, preparing: 0, out_for_delivery: 0, delivered: 0, paid: 0, cancelled: 0, gmv: 0 };
    const otpFunnel = otp.rows[0] ?? { mobile_interactions: 0, otp_requests: 0, otp_verified: 0 };
    const r = reconciliation.rows[0] ?? { total: 0, attributed: 0, guest: 0 };
    return { timezone: 'Asia/Kolkata' as const,
      acquisition: { sessions: f.sessions, uniqueVisitors: f.visitors, newVisitors: visitors.new_visitors, returningVisitors: visitors.returning_visitors },
      customerLifecycle: { newCustomers: customers.new_customers, returningCustomers: customers.returning_customers },
      sessionFunnel: [
        ['sessions', 'Sessions', f.sessions],
        ['productDiscovery', 'Product Discovery Sessions', f.discovery],
        ['cart', 'Cart Sessions', f.cart],
        ['checkout', 'Checkout Sessions', f.checkout],
        ['ordersPlaced', 'Order Placed Sessions', f.ordered],
      ].map(([key, label, count]) => ({ key: String(key), label: String(label), count: Number(count) })),
      eventTotals: events.rows.map(row => ({ key: row.event_name, count: row.count })),
      otp: { mobileInteractions: otpFunnel.mobile_interactions, otpRequests: otpFunnel.otp_requests, otpVerified: otpFunnel.otp_verified },
      orders: { placed: o.placed, accepted: o.accepted, preparing: o.preparing, outForDelivery: o.out_for_delivery, delivered: o.delivered, paid: o.paid, cancelled: o.cancelled, gmv: Number(o.gmv) },
      channels: channels.rows.map(row => ({ source: row.source, medium: row.medium, campaign: row.campaign, sessions: row.sessions, cartSessions: row.cart_sessions, checkoutSessions: row.checkout_sessions, orders: row.orders })),
      reconciliation: { orderTableCount: r.total, attributedOrderCount: r.attributed, unattributedOrderCount: r.total - r.attributed, guestOrderCount: r.guest, customerLinkedOrderCount: r.total - r.guest },
    };
  }
}