import { query } from '../database/db';
import type { FunnelRange } from './funnel.service';

const where = (column: string, range: FunnelRange, from?: string, to?: string): string => {
  if (range === 'custom') return from && to ? `${column} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')` : 'FALSE';
  if (range === 'today') return `${column} >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : null;
  return `($1::int IS NULL OR ${column} >= ((date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') - (($1::int - 1) * INTERVAL '1 day')))`;
};
const params = (range: FunnelRange, from?: string, to?: string): unknown[] => range === 'custom' ? [from, to] : range === 'today' ? [] : [range === '7d' ? 7 : range === '30d' ? 30 : null];

// The journey ladder, shallowest first. A session's stop point is the deepest
// rung it reached, so these keys must stay in the same order as the canonical
// session funnel.
const JOURNEY_STOP_ORDER = ['sessions', 'engaged', 'productDiscovery', 'cart', 'checkout', 'ordersPlaced'] as const;
const JOURNEY_STOP_LABELS: Record<string, string> = {
  sessions: 'No interaction',
  engaged: 'Browsed the site',
  productDiscovery: 'Viewed a product',
  cart: 'Added to cart',
  checkout: 'Reached checkout',
  ordersPlaced: 'Placed an order',
};

// Retention is reported as weekly cohorts: keep the newest few and the first
// few weeks of each, which is all a dashboard can read at a glance.
const MAX_COHORTS = 6;
const MAX_COHORT_WEEKS = 6;

export class CustomerAnalyticsService {
  static async getReport(range: FunnelRange, from?: string, to?: string) {
    const values = params(range, from, to);
    const sessionWhere = where('s.first_seen_at', range, from, to);
    const eventWhere = where('e.created_at', range, from, to);
    const orderWhere = where('o.created_at', range, from, to);
    const deliveryWhere = where('o.delivered_at', range, from, to);
    const [funnel, visitorLifecycle, customerLifecycle, events, discovery, otp, orders, channels, reconciliation, devices, browsers, pwa, stopPoints, timing, abandonedSummary, abandonedItems, retention] = await Promise.all([
      query<{ sessions: number; visitors: number; engaged: number; discovery: number; cart: number; checkout: number; ordered: number }>(
        `WITH flags AS (
          SELECT s.session_id, s.visitor_id,
            EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name IN ('category_viewed', 'product_search', 'product_viewed', 'cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared', 'checkout_started', 'checkout_address_started', 'checkout_address_completed', 'checkout_reviewed', 'order_placed')) AS engaged_event,
            EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name = 'product_viewed') AS discovery,
            EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name IN ('cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared')) OR EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
            EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout,
            EXISTS (SELECT 1 FROM mart_orders o WHERE o.funnel_session_id = s.session_id AND ${orderWhere}) AS ordered
          FROM mart_funnel_sessions s WHERE ${sessionWhere}
        ) SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT COALESCE(visitor_id, session_id))::int AS visitors,
          COUNT(*) FILTER (WHERE engaged_event OR discovery OR cart OR checkout OR ordered)::int AS engaged,
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
      // Customer lifecycle is keyed by phone, so guest and signed-in orders
      // belong to one customer. A delivered first order plus a later live order
      // makes that customer returning immediately; the later order need not be
      // delivered yet.
      query<{ new_customers: number; returning_customers: number }>(
        `WITH scoped_orders AS (
           SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS phone,
                  o.created_at
           FROM mart_orders o
           LEFT JOIN mart_customers cu ON cu.id = o.customer_id
           WHERE o.status NOT IN ('cancelled', 'failed_delivery', 'terminated')
             AND ${orderWhere}
         ), first_deliveries AS (
           SELECT NULLIF(regexp_replace(COALESCE(o.guest_phone, cu.phone), '\\D', '', 'g'), '') AS phone,
                  MIN(o.delivered_at) AS first_delivered_at
           FROM mart_orders o
           LEFT JOIN mart_customers cu ON cu.id = o.customer_id
           WHERE o.status = 'delivered'
           GROUP BY 1
         ), active_customers AS (
           SELECT s.phone, BOOL_OR(s.created_at > f.first_delivered_at) AS is_returning
           FROM scoped_orders s
           JOIN first_deliveries f ON f.phone = s.phone
           WHERE s.phone IS NOT NULL
           GROUP BY s.phone
         )
         SELECT COUNT(*) FILTER (WHERE NOT is_returning)::int AS new_customers,
                COUNT(*) FILTER (WHERE is_returning)::int AS returning_customers
         FROM active_customers`, values),
      query<{ event_name: string; count: number }>(`SELECT e.event_name, COUNT(*)::int AS count FROM mart_funnel_events e WHERE ${eventWhere} GROUP BY e.event_name`, values),
      query<{ category_interactions: number; search_interactions: number; product_view_sessions: number; product_view_events: number; zero_result_searches: number }>(
        `SELECT COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'category_viewed')::int AS category_interactions,
                COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'product_search')::int AS search_interactions,
                COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_name = 'product_viewed')::int AS product_view_sessions,
                COUNT(*) FILTER (WHERE e.event_name = 'product_viewed')::int AS product_view_events,
                COUNT(*) FILTER (WHERE e.event_name = 'search_zero_results')::int AS zero_result_searches
         FROM mart_funnel_events e WHERE ${eventWhere}`,
        values),
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
      query<{ source: string; sessions: number; cart_sessions: number; checkout_sessions: number; orders: number }>(
        `WITH session_flags AS (
           SELECT s.session_id,
             COALESCE(NULLIF(s.source, ''), CASE WHEN s.channel = 'unattributed' THEN 'unattributed' ELSE s.channel END) AS source,
             EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name IN ('cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared')) OR EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
             EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout
           FROM mart_funnel_sessions s WHERE ${sessionWhere}
         ), session_metrics AS (
           SELECT source, COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE cart)::int AS cart_sessions,
             COUNT(*) FILTER (WHERE checkout)::int AS checkout_sessions
           FROM session_flags GROUP BY source
         ), order_attribution AS (
           SELECT COALESCE(NULLIF(s.source, ''), CASE WHEN s.channel = 'unattributed' THEN 'unattributed' ELSE s.channel END) AS source
           FROM mart_orders o
           JOIN mart_funnel_sessions s ON s.session_id = o.funnel_session_id
           WHERE ${orderWhere}
         ), order_metrics AS (
           SELECT source, COUNT(*)::int AS orders
           FROM order_attribution
           GROUP BY source
         )
         SELECT COALESCE(sm.source, om.source) AS source, COALESCE(sm.sessions, 0)::int AS sessions,
           COALESCE(sm.cart_sessions, 0)::int AS cart_sessions, COALESCE(sm.checkout_sessions, 0)::int AS checkout_sessions,
           COALESCE(om.orders, 0)::int AS orders
         FROM session_metrics sm FULL OUTER JOIN order_metrics om
           ON sm.source = om.source
         ORDER BY sessions DESC, orders DESC`, values),
      query<{ total: number; attributed: number; guest: number }>(
        `WITH scoped AS (SELECT o.id, o.customer_id, o.funnel_session_id FROM mart_orders o WHERE ${orderWhere}), attributed AS (SELECT id FROM scoped WHERE funnel_session_id IS NOT NULL)
         SELECT (SELECT COUNT(*)::int FROM scoped) AS total, (SELECT COUNT(*)::int FROM attributed) AS attributed, (SELECT COUNT(*)::int FROM scoped WHERE customer_id IS NULL) AS guest`, values),
      // Device breakdown. `platform`/`browser`/`is_pwa` are written once when the
      // session first appears; a session with no device (written before the
      // client shipped) is labelled 'unknown' rather than dropped, so the rows
      // still add up to the session total.
      query<{ platform: string; sessions: number; cart_sessions: number; checkout_sessions: number; orders: number }>(
        `WITH session_flags AS (
           SELECT s.session_id,
             COALESCE(NULLIF(s.platform, ''), 'unknown') AS platform,
             EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND ${eventWhere} AND e.event_name IN ('cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared')) OR EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
             EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout,
             EXISTS (SELECT 1 FROM mart_orders o WHERE o.funnel_session_id = s.session_id AND ${orderWhere}) AS ordered
           FROM mart_funnel_sessions s WHERE ${sessionWhere}
         )
         SELECT platform, COUNT(*)::int AS sessions,
           COUNT(*) FILTER (WHERE cart)::int AS cart_sessions,
           COUNT(*) FILTER (WHERE checkout)::int AS checkout_sessions,
           COUNT(*) FILTER (WHERE ordered)::int AS orders
         FROM session_flags GROUP BY platform ORDER BY sessions DESC`, values),
      query<{ browser: string; sessions: number }>(
        `SELECT COALESCE(NULLIF(s.browser, ''), 'unknown') AS browser, COUNT(*)::int AS sessions
         FROM mart_funnel_sessions s WHERE ${sessionWhere}
         GROUP BY 1 ORDER BY sessions DESC`, values),
      query<{ pwa_sessions: number; total_sessions: number }>(
        `SELECT COUNT(*) FILTER (WHERE s.is_pwa)::int AS pwa_sessions, COUNT(*)::int AS total_sessions
         FROM mart_funnel_sessions s WHERE ${sessionWhere}`, values),
      // Where each session stopped: its furthest step on the same ladder the
      // canonical funnel uses, so the stop distribution reconciles with the
      // funnel above. Events are read for the whole session (not filtered by
      // range) so a session that started near midnight still counts the steps
      // it went on to take.
      query<{ stop_key: string; sessions: number }>(
        `WITH scoped AS (
           SELECT s.session_id,
             EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND e.event_name IN ('category_viewed', 'product_search', 'product_viewed', 'cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared', 'checkout_started', 'checkout_address_started', 'checkout_address_completed', 'checkout_reviewed', 'order_placed')) AS engaged,
             EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND e.event_name = 'product_viewed') AS discovery,
             EXISTS (SELECT 1 FROM mart_funnel_events e WHERE e.session_id = s.session_id AND e.event_name IN ('cart_started', 'cart_added', 'cart_updated', 'cart_removed', 'cart_cleared')) OR EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.item_count > 0) AS cart,
             EXISTS (SELECT 1 FROM mart_carts c WHERE c.session_id = s.session_id AND c.reached_checkout) AS checkout,
             EXISTS (SELECT 1 FROM mart_orders o WHERE o.funnel_session_id = s.session_id AND ${orderWhere}) AS ordered
           FROM mart_funnel_sessions s WHERE ${sessionWhere}
         )
         SELECT CASE
             WHEN ordered THEN 'ordersPlaced'
             WHEN checkout THEN 'checkout'
             WHEN cart THEN 'cart'
             WHEN discovery THEN 'productDiscovery'
             WHEN engaged THEN 'engaged'
             ELSE 'sessions' END AS stop_key,
           COUNT(*)::int AS sessions
         FROM scoped GROUP BY 1`, values),
      // Dwell: how long sessions last and how long they take to reach each
      // milestone. percentiles ignore NULLs, so a median is only reported over
      // the sessions that actually reached that step.
      query<{ sessions: number; avg_duration_s: number; median_duration_s: number; median_to_cart_s: number | null; median_to_checkout_s: number | null; median_to_order_s: number | null }>(
        `WITH scoped AS (
           SELECT s.session_id, s.first_seen_at, s.last_seen_at FROM mart_funnel_sessions s WHERE ${sessionWhere}
         ), timed AS (
           SELECT sc.session_id,
             EXTRACT(EPOCH FROM (sc.last_seen_at - sc.first_seen_at)) AS duration_s,
             (SELECT MIN(e.created_at) FROM mart_funnel_events e WHERE e.session_id = sc.session_id AND e.event_name IN ('cart_started', 'cart_added', 'cart_updated')) - sc.first_seen_at AS cart_lag,
             (SELECT MIN(e.created_at) FROM mart_funnel_events e WHERE e.session_id = sc.session_id AND e.event_name IN ('checkout_started', 'checkout_address_started')) - sc.first_seen_at AS checkout_lag,
             (SELECT MIN(e.created_at) FROM mart_funnel_events e WHERE e.session_id = sc.session_id AND e.event_name = 'order_placed') - sc.first_seen_at AS order_lag
           FROM scoped sc
         )
         SELECT COUNT(*)::int AS sessions,
           COALESCE(ROUND(AVG(duration_s)::numeric), 0)::int AS avg_duration_s,
           COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_s)::numeric), 0)::int AS median_duration_s,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM cart_lag))::numeric)::int AS median_to_cart_s,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM checkout_lag))::numeric)::int AS median_to_checkout_s,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM order_lag))::numeric)::int AS median_to_order_s
         FROM timed`, values),
      // Abandoned carts, read straight from the durable mirror. A cart is
      // "abandoned" when it still holds items, was never converted, and has
      // been idle past the window -- so a cart that converts later drops out on
      // its own. `reached_checkout` splits it into "left at cart" vs "left at
      // checkout" without a second event scan.
      query<{ abandoned_carts: number; checkout_stage: number; cart_stage: number; value: string | number }>(
        `SELECT COUNT(*)::int AS abandoned_carts,
           COUNT(*) FILTER (WHERE c.reached_checkout)::int AS checkout_stage,
           COUNT(*) FILTER (WHERE NOT c.reached_checkout)::int AS cart_stage,
           COALESCE(SUM(c.subtotal), 0)::numeric AS value
         FROM mart_carts c
         WHERE c.converted_at IS NULL
           AND c.item_count > 0
           AND c.last_active_at < NOW() - INTERVAL '2 hours'
           AND ${where('c.last_active_at', range, from, to)}`, values),
      // Which products each abandoned cart was holding. One row per product, so
      // the panel can rank the goods that get left behind.
      query<{ product_id: string; product_name: string; unit: string; carts: number; quantity: number; value: string | number }>(
        `SELECT item->>'productId' AS product_id,
           MAX(item->>'productName') AS product_name,
           MAX(item->>'unit') AS unit,
           COUNT(DISTINCT c.id)::int AS carts,
           COALESCE(SUM((item->>'quantity')::int), 0)::int AS quantity,
           COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::int), 0)::numeric AS value
         FROM mart_carts c
         CROSS JOIN LATERAL jsonb_array_elements(c.items) AS item
         WHERE c.converted_at IS NULL
           AND c.item_count > 0
           AND c.last_active_at < NOW() - INTERVAL '2 hours'
           AND ${where('c.last_active_at', range, from, to)}
           AND item->>'productId' IS NOT NULL
         GROUP BY item->>'productId'
         ORDER BY carts DESC, quantity DESC
         LIMIT 20`, values),
      // Weekly retention cohorts. Each visitor is assigned to the week of their
      // first-ever session (within the selected period), then every later week
      // they came back is counted. Activity is read over all time, so a cohort
      // born inside the range still shows the weeks that followed it.
      query<{ cohort_week: string; weeks_since: number; visitors: number }>(
        `WITH visitors AS (
           SELECT COALESCE(s.visitor_id, s.session_id) AS visitor_key,
                  MIN(s.first_seen_at) AS first_seen
           FROM mart_funnel_sessions s
           GROUP BY 1
         ), cohorts AS (
           SELECT visitor_key,
                  date_trunc('week', first_seen AT TIME ZONE 'Asia/Kolkata')::date AS cohort_week
           FROM visitors
           WHERE ${where('first_seen', range, from, to)}
         ), activity AS (
           SELECT COALESCE(s.visitor_id, s.session_id) AS visitor_key,
                  date_trunc('week', s.first_seen_at AT TIME ZONE 'Asia/Kolkata')::date AS activity_week
           FROM mart_funnel_sessions s
           GROUP BY 1, 2
         )
         SELECT to_char(c.cohort_week, 'YYYY-MM-DD') AS cohort_week,
                ((a.activity_week - c.cohort_week) / 7)::int AS weeks_since,
                COUNT(DISTINCT a.visitor_key)::int AS visitors
         FROM cohorts c
         JOIN activity a ON a.visitor_key = c.visitor_key AND a.activity_week >= c.cohort_week
         GROUP BY c.cohort_week, weeks_since
         ORDER BY c.cohort_week DESC, weeks_since`, values),
    ]);
    const f = funnel.rows[0] ?? { sessions: 0, visitors: 0, engaged: 0, discovery: 0, cart: 0, checkout: 0, ordered: 0 };
    const visitors = visitorLifecycle.rows[0] ?? { new_visitors: 0, returning_visitors: 0 };
    const customers = customerLifecycle.rows[0] ?? { new_customers: 0, returning_customers: 0 };
    const productDiscovery = discovery.rows[0] ?? { category_interactions: 0, search_interactions: 0, product_view_sessions: 0, product_view_events: 0, zero_result_searches: 0 };
    const o = orders.rows[0] ?? { placed: 0, accepted: 0, preparing: 0, out_for_delivery: 0, delivered: 0, paid: 0, cancelled: 0, gmv: 0 };
    const otpFunnel = otp.rows[0] ?? { mobile_interactions: 0, otp_requests: 0, otp_verified: 0 };
    const r = reconciliation.rows[0] ?? { total: 0, attributed: 0, guest: 0 };
    const appVsBrowser = pwa.rows[0] ?? { pwa_sessions: 0, total_sessions: 0 };
    const stopCounts = new Map(stopPoints.rows.map(row => [row.stop_key, row.sessions]));
    const timingRow = timing.rows[0] ?? { sessions: 0, avg_duration_s: 0, median_duration_s: 0, median_to_cart_s: null, median_to_checkout_s: null, median_to_order_s: null };
    const abandoned = abandonedSummary.rows[0] ?? { abandoned_carts: 0, checkout_stage: 0, cart_stage: 0, value: 0 };
    // Fold the flat (cohort, week) rows into the newest cohorts, each with a
    // dense week series so the grid never has gaps.
    const cohortMap = new Map<string, { size: number; weeks: Map<number, number> }>();
    for (const row of retention.rows) {
      let entry = cohortMap.get(row.cohort_week);
      if (!entry) { entry = { size: 0, weeks: new Map() }; cohortMap.set(row.cohort_week, entry); }
      entry.weeks.set(row.weeks_since, row.visitors);
      if (row.weeks_since === 0) entry.size = row.visitors;
    }
    const retentionCohorts = [...cohortMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, MAX_COHORTS)
      .map(([cohort, entry]) => ({
        cohort,
        size: entry.size,
        weeks: Array.from({ length: Math.min(MAX_COHORT_WEEKS, Math.max(0, ...entry.weeks.keys()) + 1) }, (_, week) => {
          const visitors = entry.weeks.get(week) ?? 0;
          return { week, visitors, percent: entry.size > 0 ? Math.round((visitors / entry.size) * 100) : 0 };
        }),
      }));
    const sessionFunnel = [
      ['sessions', 'Sessions', f.sessions],
      ['engaged', 'Engaged Sessions', f.engaged],
      ['productDiscovery', 'Product Discovery Sessions', f.discovery],
      ['cart', 'Cart Sessions', f.cart],
      ['checkout', 'Checkout Sessions', f.checkout],
      ['ordersPlaced', 'Order Placed Sessions', f.ordered],
    ].map(([key, label, count]) => ({ key: String(key), label: String(label), count: Number(count) }));
    const largestDrop = sessionFunnel.slice(1).reduce<{ from: string; to: string; count: number; percent: number } | null>((largest, stage, index) => {
      const previous = sessionFunnel[index];
      if (previous.count === 0) return largest;
      const count = Math.max(0, previous.count - stage.count);
      const percent = Math.round((count / previous.count) * 100);
      return !largest || percent > largest.percent
        ? { from: previous.label, to: stage.label, count, percent }
        : largest;
    }, null);
    return { timezone: 'Asia/Kolkata' as const,
      acquisition: { sessions: f.sessions, uniqueVisitors: f.visitors, newVisitors: visitors.new_visitors, returningVisitors: visitors.returning_visitors },
      customerLifecycle: { newCustomers: customers.new_customers, returningCustomers: customers.returning_customers },
      sessionFunnel,
      nonEngagedSessions: Math.max(0, f.sessions - f.engaged),
      largestDrop,
      productDiscovery: {
        categoryInteractionSessions: productDiscovery.category_interactions,
        searchInteractionSessions: productDiscovery.search_interactions,
        productViewSessions: productDiscovery.product_view_sessions,
        productViewEvents: productDiscovery.product_view_events,
        zeroResultSearches: productDiscovery.zero_result_searches,
      },
      eventTotals: events.rows.map(row => ({ key: row.event_name, count: row.count })),
      otp: { mobileInteractions: otpFunnel.mobile_interactions, otpRequests: otpFunnel.otp_requests, otpVerified: otpFunnel.otp_verified },
      orders: { placed: o.placed, accepted: o.accepted, preparing: o.preparing, outForDelivery: o.out_for_delivery, delivered: o.delivered, paid: o.paid, cancelled: o.cancelled, gmv: Number(o.gmv) },
      channels: channels.rows.map(row => ({ source: row.source, sessions: row.sessions, cartSessions: row.cart_sessions, checkoutSessions: row.checkout_sessions, orders: row.orders })),
      reconciliation: { orderTableCount: r.total, attributedOrderCount: r.attributed, unattributedOrderCount: r.total - r.attributed, guestOrderCount: r.guest, customerLinkedOrderCount: r.total - r.guest },
      devices: {
        platforms: devices.rows.map(row => ({
          platform: row.platform,
          sessions: row.sessions,
          cartSessions: row.cart_sessions,
          checkoutSessions: row.checkout_sessions,
          orders: row.orders,
        })),
        browsers: browsers.rows.map(row => ({ browser: row.browser, sessions: row.sessions })),
        installed: {
          pwaSessions: appVsBrowser.pwa_sessions,
          browserSessions: Math.max(0, appVsBrowser.total_sessions - appVsBrowser.pwa_sessions),
        },
      },
      journey: {
        stopPoints: JOURNEY_STOP_ORDER.map(key => ({
          key,
          label: JOURNEY_STOP_LABELS[key],
          sessions: stopCounts.get(key) ?? 0,
        })),
        timing: {
          sessions: timingRow.sessions,
          avgDurationSeconds: timingRow.avg_duration_s,
          medianDurationSeconds: timingRow.median_duration_s,
          medianSecondsToCart: timingRow.median_to_cart_s,
          medianSecondsToCheckout: timingRow.median_to_checkout_s,
          medianSecondsToOrder: timingRow.median_to_order_s,
        },
      },
      abandonedCarts: {
        carts: abandoned.abandoned_carts,
        checkoutStage: abandoned.checkout_stage,
        cartStage: abandoned.cart_stage,
        value: Number(abandoned.value),
        topItems: abandonedItems.rows.map(row => ({
          productId: row.product_id,
          productName: row.product_name,
          unit: row.unit,
          carts: row.carts,
          quantity: row.quantity,
          value: Number(row.value),
        })),
      },
      retention: { granularity: 'week' as const, cohorts: retentionCohorts },
    };
  }
}