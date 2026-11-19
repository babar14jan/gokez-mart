import { query, transaction } from '../database/db';
import { PushService } from './push.service';
import { config } from '../config';

const TYPES = ['new_product', 'combo', 'offer', 'back_in_stock', 'we_miss_you', 'custom'] as const;
type PromotionType = typeof TYPES[number];
type PromotionStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export const AUDIENCE_COHORTS = [
  'recent_purchaser',
  'winback_7',
  'winback_15',
  'winback_30',
  'first_order_followup',
  'repeat_buyer',
  'signed_in_no_order',
  'signed_in_one_order',
  'signed_in_repeat_lapsed_7',
  'guest_0_1_delivered',
  'guest_2_plus_delivered',
] as const;
export type AudienceCohort = typeof AUDIENCE_COHORTS[number];

export interface AudienceRules {
  cohorts: AudienceCohort[];
}

export interface AudienceExclusions {
  notConsented: number;
  noSubscription: number;
  cohortMismatch: number;
  sentPromotionLast7d: number;
  activeOrder: number;
  recentDelivery: number;
  recentCancellationOrFailure: number;
  lateDeliverySuppression: number;
}

export interface AudienceCohortCount {
  cohort: AudienceCohort;
  count: number;
}

export interface AudiencePreview {
  matchedCustomers: number;
  recipients: number;
  subscriptions: number;
  exclusions: AudienceExclusions;
  cohorts: AudienceCohortCount[];
}

export interface AudienceCustomer {
  id: string;
  name: string | null;
  phone: string;
  address: string;
  address2: string;
  deliveredOrders: number;
  lastDeliveredAt: string | null;
  isSignedIn: boolean;
  cohorts: AudienceCohort[];
  eligible: boolean;
  exclusionReason: string | null;
}

export interface AudienceCustomerPage {
  total: number;
  customers: AudienceCustomer[];
  limit: number;
  offset: number;
}

export interface PromotionTestTarget {
  phone: string;
  name: string | null;
  customerId: string | null;
  subscriptions: number;
  sent: number;
  failed: number;
  note?: string;
}

export interface PromotionTestResult {
  sent: number;
  failed: number;
  recipients: number;
  targets: PromotionTestTarget[];
}

/**
 * Internal test recipients for every draft, regardless of type or selected
 * audience. Keep this in one place so live-test sends are consistent.
 */
export const PROMOTION_TEST_PHONES = ['9330317102', '8777376280', '7479868999', '8084025786'] as const;

interface PromotionInput {
  type: PromotionType;
  title: string;
  body: string;
  imageUrl?: string | null;
  destinationUrl: string;
  zoneIds?: string[] | null;
  audienceRules?: AudienceRules;
  scheduledAt?: string | null;
}

interface Subscription {
  id: string;
  customerId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface AudienceDeliveryStats {
  deliveredOrders: number;
  lastDeliveredAt: Date | null;
  /** OTP-verified customers are signed in; everyone else is a guest. */
  isSignedIn?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KOLKATA_TIME_ZONE = 'Asia/Kolkata';

export const parsePromotionSchedule = (value: string): Date | null => {
  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/);
  const date = localMatch
    ? new Date(Date.UTC(
      Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]),
      Number(localMatch[4]) - 5, Number(localMatch[5]) - 30, Number(localMatch[6] || 0),
    ))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isPromotionQuietHours = (date: Date): boolean => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: KOLKATA_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).find(part => part.type === 'hour')?.value);
  return hour >= 21 || hour < 9;
};

export const matchesAudienceCohorts = (cohorts: AudienceCohort[], stats: AudienceDeliveryStats, now = new Date()): boolean => {
  if (!cohorts.length) return true;
  const ageMs = stats.lastDeliveredAt ? now.getTime() - stats.lastDeliveredAt.getTime() : null;
  return cohorts.some(cohort => {
    if (cohort === 'signed_in_no_order') return stats.isSignedIn === true && stats.deliveredOrders === 0;
    if (cohort === 'signed_in_one_order') return stats.isSignedIn === true && stats.deliveredOrders === 1;
    if (cohort === 'signed_in_repeat_lapsed_7') {
      return stats.isSignedIn === true && stats.deliveredOrders > 2 && ageMs !== null && ageMs >= 7 * DAY_MS;
    }
    if (cohort === 'guest_0_1_delivered') return stats.isSignedIn !== true && stats.deliveredOrders < 2;
    if (cohort === 'guest_2_plus_delivered') return stats.isSignedIn !== true && stats.deliveredOrders >= 2;
    if (ageMs === null) return false;
    if (cohort === 'recent_purchaser') return ageMs >= 3 * DAY_MS && ageMs < 7 * DAY_MS;
    if (cohort === 'winback_7') return ageMs >= 7 * DAY_MS && ageMs < 14 * DAY_MS;
    if (cohort === 'winback_15') return ageMs >= 14 * DAY_MS && ageMs < 30 * DAY_MS;
    if (cohort === 'winback_30') return ageMs >= 30 * DAY_MS;
    if (cohort === 'first_order_followup') return stats.deliveredOrders === 1 && ageMs >= 7 * DAY_MS;
    return stats.deliveredOrders >= 3;
  });
};

export const normalizeAudienceRules = (value: unknown): AudienceRules => {
  if (value === undefined) return { cohorts: [] };
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Audience rules must be an object');
  const cohorts = (value as Record<string, unknown>).cohorts;
  if (cohorts === undefined) return { cohorts: [] };
  if (!Array.isArray(cohorts) || cohorts.some(cohort => typeof cohort !== 'string' || !AUDIENCE_COHORTS.includes(cohort as AudienceCohort))) {
    throw new Error('Audience cohorts must contain only supported cohorts');
  }
  return { cohorts: [...new Set(cohorts as AudienceCohort[])] };
};

export const isSafePromotionDestination = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false;
  try {
    return new URL(value, 'https://customer.invalid').origin === 'https://customer.invalid';
  } catch {
    return false;
  }
};

const customerDestination = (destination: unknown): string | null => {
  if (!isSafePromotionDestination(destination)) return null;
  try {
    return new URL(destination, config.urls.customerApp).toString();
  } catch {
    return null;
  }
};

const normalizePhoneDigits = (value: string): string => value.replace(/\D/g, '').slice(-10);

export const normalizePromotionInput = (data: Record<string, unknown>, partial = false): Partial<PromotionInput> => {
  const result: Partial<PromotionInput> = {};
  const type = data.type;
  if (!partial || type !== undefined) {
    if (typeof type !== 'string' || !TYPES.includes(type as PromotionType)) throw new Error('Invalid promotion type');
    result.type = type as PromotionType;
  }
  for (const field of ['title', 'body'] as const) {
    const value = data[field];
    if (!partial || value !== undefined) {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 240) throw new Error(`${field} is required and must be 240 characters or fewer`);
      result[field] = value.trim();
    }
  }
  const destinationUrl = data.destinationUrl ?? data.destination_url;
  if (!partial || destinationUrl !== undefined) {
    if (!isSafePromotionDestination(destinationUrl)) throw new Error('Destination must be a root-relative path');
    result.destinationUrl = destinationUrl;
  }
  const hasImageUrl = Object.prototype.hasOwnProperty.call(data, 'imageUrl') || Object.prototype.hasOwnProperty.call(data, 'image_url');
  const imageUrl = Object.prototype.hasOwnProperty.call(data, 'imageUrl') ? data.imageUrl : data.image_url;
  if (hasImageUrl) {
    if (imageUrl !== null && (typeof imageUrl !== 'string' || imageUrl.length > 2000)) throw new Error('Invalid image URL');
    result.imageUrl = imageUrl as string | null;
  }
  const hasZoneIds = Object.prototype.hasOwnProperty.call(data, 'zoneIds') || Object.prototype.hasOwnProperty.call(data, 'zone_ids');
  const zoneIds = Object.prototype.hasOwnProperty.call(data, 'zoneIds') ? data.zoneIds : data.zone_ids;
  if (hasZoneIds) {
    if (zoneIds !== null && (!Array.isArray(zoneIds) || zoneIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Zone IDs must be an array');
    result.zoneIds = zoneIds ? [...new Set(zoneIds as string[])] : null;
  }
  const audienceRules = data.audienceRules !== undefined ? data.audienceRules : data.audience_rules;
  if (!partial || audienceRules !== undefined) result.audienceRules = normalizeAudienceRules(audienceRules);
  const hasScheduledAt = Object.prototype.hasOwnProperty.call(data, 'scheduledAt') || Object.prototype.hasOwnProperty.call(data, 'scheduled_at');
  const scheduledAt = Object.prototype.hasOwnProperty.call(data, 'scheduledAt') ? data.scheduledAt : data.scheduled_at;
  if (hasScheduledAt) {
    if (scheduledAt !== null && typeof scheduledAt !== 'string') throw new Error('Invalid scheduled time');
    if (scheduledAt !== null) {
      const date = parsePromotionSchedule(scheduledAt);
      if (!date) throw new Error('Invalid scheduled time');
      if (isPromotionQuietHours(date)) throw new Error('Promotions may only be scheduled between 09:00 and 20:59 Asia/Kolkata');
      result.scheduledAt = date.toISOString();
    } else result.scheduledAt = null;
  }
  return result;
};

interface AudienceResult {
  subscriptions: Subscription[];
  matchedCustomers: number;
  recipients: number;
  exclusions: AudienceExclusions;
  cohortCounts: Record<string, number>;
}

const audienceBaseSql = (zoneIds: string[], cohorts: AudienceCohort[]) => ({
  text: `WITH delivery_stats AS MATERIALIZED (
           SELECT customer_id, COUNT(*)::int AS delivered_orders, MAX(delivered_at) AS last_delivered_at
           FROM mart_orders
           WHERE customer_id IS NOT NULL AND status = 'delivered' AND delivered_at IS NOT NULL
           GROUP BY customer_id
         ),
         latest_zone_order AS MATERIALIZED (
           SELECT DISTINCT ON (o.customer_id) o.customer_id, z.id AS zone_id
           FROM mart_orders o
           JOIN mart_zones z ON z.store_id = o.store_id
           WHERE o.customer_id IS NOT NULL AND o.status NOT IN ('cancelled', 'failed_delivery', 'terminated')
           ORDER BY o.customer_id, o.created_at DESC, o.id DESC
         ),
         promotion_sends AS MATERIALIZED (
           SELECT customer_id, COUNT(DISTINCT promotion_id)::int AS sent_promotion_last_7d
           FROM mart_promotion_deliveries
           WHERE customer_id IS NOT NULL AND status = 'sent' AND sent_at IS NOT NULL
             AND NOT is_test
             AND sent_at >= NOW() - INTERVAL '7 days'
           GROUP BY customer_id
         ),
         audience AS MATERIALIZED (
           SELECT c.id AS customer_id, c.marketing_consent,
             EXISTS (
               SELECT 1 FROM mart_customer_leads lead
               WHERE lead.customer_id = c.id AND lead.verified_at IS NOT NULL
             ) AS is_signed_in,
             EXISTS (SELECT 1 FROM mart_push_subscriptions ps WHERE ps.customer_id = c.id) AS has_subscription,
             COALESCE(ds.delivered_orders, 0) AS delivered_orders, ds.last_delivered_at,
             lzo.zone_id, COALESCE(sent.sent_promotion_last_7d, 0) AS sent_promotion_last_7d,
             EXISTS (
               SELECT 1 FROM mart_orders active_order
               WHERE active_order.customer_id = c.id
                 AND active_order.status IN ('pending', 'confirmed', 'preparing', 'ready_to_pickup', 'picked_up', 'out_for_delivery')
             ) AS active_order,
             EXISTS (
               SELECT 1 FROM mart_orders recent_delivery
               WHERE recent_delivery.customer_id = c.id AND recent_delivery.status = 'delivered'
                 AND recent_delivery.delivered_at IS NOT NULL
                 AND recent_delivery.delivered_at >= NOW() - INTERVAL '3 days'
             ) AS recent_delivery,
             EXISTS (
               SELECT 1 FROM mart_orders recent_cancellation_or_failure
               WHERE recent_cancellation_or_failure.customer_id = c.id
                 AND COALESCE(recent_cancellation_or_failure.updated_at, recent_cancellation_or_failure.created_at) >= NOW() - INTERVAL '7 days'
                 AND (
                   recent_cancellation_or_failure.status = 'failed_delivery'
                   OR (recent_cancellation_or_failure.status = 'cancelled' AND recent_cancellation_or_failure.cancellation_reason IN (
                     'ordered_by_mistake', 'changed_my_mind', 'wrong_address', 'duplicate_order', 'found_better_price', 'delivery_too_slow', 'other', 'customer_request'
                   ))
                   OR recent_cancellation_or_failure.status IN ('customer_cancelled', 'cancelled_by_customer', 'customer_requested_cancellation')
                 )
             ) AS recent_cancellation_or_failure,
             EXISTS (
               SELECT 1 FROM mart_orders late_delivery
               WHERE late_delivery.customer_id = c.id AND late_delivery.status = 'delivered'
                 AND late_delivery.delivered_at IS NOT NULL AND late_delivery.promised_delivery_at IS NOT NULL
                 AND late_delivery.delivered_at > late_delivery.promised_delivery_at
                 AND late_delivery.delivered_at >= NOW() - INTERVAL '14 days'
             ) AS late_delivery
           FROM mart_customers c
           LEFT JOIN delivery_stats ds ON ds.customer_id = c.id
           LEFT JOIN latest_zone_order lzo ON lzo.customer_id = c.id
           LEFT JOIN promotion_sends sent ON sent.customer_id = c.id
         ),
         staged AS MATERIALIZED (
           SELECT *,
             (cardinality($1::uuid[]) = 0 OR zone_id = ANY($1::uuid[])) AS zone_match,
             jsonb_build_object(
               'recent_purchaser', ('recent_purchaser' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '7 days' AND last_delivered_at < NOW() - INTERVAL '3 days'),
               'winback_7', ('winback_7' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '14 days' AND last_delivered_at < NOW() - INTERVAL '7 days'),
               'winback_15', ('winback_15' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '30 days' AND last_delivered_at < NOW() - INTERVAL '14 days'),
               'winback_30', ('winback_30' = ANY($2::text[]) AND last_delivered_at < NOW() - INTERVAL '30 days'),
               'first_order_followup', ('first_order_followup' = ANY($2::text[]) AND delivered_orders = 1 AND last_delivered_at <= NOW() - INTERVAL '7 days'),
               'repeat_buyer', ('repeat_buyer' = ANY($2::text[]) AND delivered_orders >= 3),
               'signed_in_no_order', ('signed_in_no_order' = ANY($2::text[]) AND is_signed_in AND delivered_orders = 0),
               'signed_in_one_order', ('signed_in_one_order' = ANY($2::text[]) AND is_signed_in AND delivered_orders = 1),
               'signed_in_repeat_lapsed_7', ('signed_in_repeat_lapsed_7' = ANY($2::text[]) AND is_signed_in AND delivered_orders > 2 AND last_delivered_at < NOW() - INTERVAL '7 days'),
               'guest_0_1_delivered', ('guest_0_1_delivered' = ANY($2::text[]) AND NOT is_signed_in AND delivered_orders < 2),
               'guest_2_plus_delivered', ('guest_2_plus_delivered' = ANY($2::text[]) AND NOT is_signed_in AND delivered_orders >= 2)
             ) AS cohort_hits
           FROM audience
         ),
         matched AS MATERIALIZED (
           SELECT *,
             (zone_match AND (
               cardinality($2::text[]) = 0 OR EXISTS (
                 SELECT 1 FROM jsonb_each_text(cohort_hits) WHERE value = 'true'
               )
             )) AS target_match
           FROM staged
         ),
         eligible_customers AS MATERIALIZED (
           SELECT * FROM matched
           WHERE marketing_consent
             AND has_subscription
             AND target_match
             AND sent_promotion_last_7d = 0
             AND NOT active_order
             AND NOT recent_delivery
             AND NOT recent_cancellation_or_failure
             AND NOT late_delivery
         )`,
  params: [zoneIds, cohorts],
});

const audienceSql = (zoneIds: string[], cohorts: AudienceCohort[]) => {
  const base = audienceBaseSql(zoneIds, cohorts);
  return {
    text: `${base.text},
         cohort_counts AS MATERIALIZED (
           SELECT selected.cohort,
             COUNT(*) FILTER (WHERE (matched.cohort_hits ->> selected.cohort)::boolean)::int AS count
           FROM unnest($2::text[]) AS selected(cohort)
           CROSS JOIN matched
           GROUP BY selected.cohort
         ),
         eligible_subscriptions AS MATERIALIZED (
           SELECT DISTINCT ON (ps.endpoint) ps.id, ps.customer_id AS "customerId", ps.endpoint, ps.p256dh, ps.auth, ps.created_at
           FROM mart_push_subscriptions ps
           JOIN eligible_customers ec ON ec.customer_id = ps.customer_id
           ORDER BY ps.endpoint, ps.created_at DESC
         )
         SELECT
           (SELECT COUNT(*)::int FROM matched) AS "matchedCustomers",
           (SELECT COUNT(*)::int FROM eligible_customers) AS recipients,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'customerId', "customerId", 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) FROM eligible_subscriptions), '[]'::jsonb) AS subscriptions,
           COALESCE((SELECT jsonb_object_agg(cohort, count) FROM cohort_counts), '{}'::jsonb) AS "cohortCounts",
           jsonb_build_object(
             'notConsented', COUNT(*) FILTER (WHERE NOT marketing_consent),
             'noSubscription', COUNT(*) FILTER (WHERE marketing_consent AND NOT has_subscription),
             'cohortMismatch', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND NOT target_match),
             'sentPromotionLast7d', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND target_match AND sent_promotion_last_7d > 0),
             'activeOrder', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND target_match AND sent_promotion_last_7d = 0 AND active_order),
             'recentDelivery', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND target_match AND sent_promotion_last_7d = 0 AND NOT active_order AND recent_delivery),
             'recentCancellationOrFailure', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND target_match AND sent_promotion_last_7d = 0 AND NOT active_order AND NOT recent_delivery AND recent_cancellation_or_failure),
             'lateDeliverySuppression', COUNT(*) FILTER (WHERE marketing_consent AND has_subscription AND target_match AND sent_promotion_last_7d = 0 AND NOT active_order AND NOT recent_delivery AND NOT recent_cancellation_or_failure AND late_delivery)
           ) AS exclusions
         FROM matched`,
    params: base.params,
  };
};

const audienceCustomersSql = (
  zoneIds: string[],
  cohorts: AudienceCohort[],
  cohort: AudienceCohort | null,
  limit: number,
  offset: number,
) => {
  const base = audienceBaseSql(zoneIds, cohorts);
  return {
    text: `${base.text},
         audience_customers AS MATERIALIZED (
           SELECT matched.customer_id AS id,
             COALESCE(NULLIF(TRIM(c.name), ''), latest_order.guest_name, '') AS name,
             c.phone,
             COALESCE(NULLIF(TRIM(c.address), ''), latest_order.guest_address, '') AS address,
             COALESCE(NULLIF(TRIM(c.address2), ''), '') AS address2,
             matched.delivered_orders,
             matched.last_delivered_at,
             matched.is_signed_in,
             matched.cohort_hits,
             (eligible.customer_id IS NOT NULL) AS eligible,
             CASE
               WHEN NOT matched.marketing_consent THEN 'Marketing consent missing'
               WHEN NOT matched.has_subscription THEN 'No push subscription'
               WHEN matched.sent_promotion_last_7d > 0 THEN 'Promotion sent in last 7 days'
               WHEN matched.active_order THEN 'Active order in progress'
               WHEN matched.recent_delivery THEN 'Delivered in last 3 days'
               WHEN matched.recent_cancellation_or_failure THEN 'Recent cancellation or failure'
               WHEN matched.late_delivery THEN 'Recent late delivery'
               ELSE NULL
             END AS exclusion_reason,
             ARRAY(SELECT key FROM jsonb_each_text(matched.cohort_hits) WHERE value = 'true') AS cohorts
           FROM matched
           JOIN mart_customers c ON c.id = matched.customer_id
           LEFT JOIN eligible_customers eligible ON eligible.customer_id = matched.customer_id
           LEFT JOIN LATERAL (
             SELECT o.guest_name, o.guest_address
             FROM mart_orders o
             WHERE o.customer_id = c.id
             ORDER BY o.created_at DESC, o.id DESC
             LIMIT 1
           ) latest_order ON TRUE
           WHERE (cardinality($1::uuid[]) = 0 OR matched.zone_match)
             AND (cardinality($2::text[]) = 0 OR EXISTS (SELECT 1 FROM jsonb_each_text(matched.cohort_hits) WHERE value = 'true' AND key = ANY($2::text[])))
             AND ($3::text IS NULL OR (matched.cohort_hits ->> $3)::boolean)
         )
         SELECT
           (SELECT COUNT(*)::int FROM audience_customers) AS total,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', id,
               'name', name,
               'phone', phone,
               'address', address,
               'address2', address2,
               'deliveredOrders', delivered_orders,
               'lastDeliveredAt', last_delivered_at,
               'isSignedIn', is_signed_in,
               'cohorts', cohorts,
               'eligible', eligible,
               'exclusionReason', exclusion_reason
             ) ORDER BY last_delivered_at DESC NULLS LAST, name ASC NULLS LAST, id)
             FROM (
               SELECT * FROM audience_customers
               ORDER BY last_delivered_at DESC NULLS LAST, name ASC NULLS LAST, id
               LIMIT $4 OFFSET $5
             ) page
           ), '[]'::jsonb) AS customers`,
    params: [...base.params, cohort, limit, offset],
  };
};

export class PromotionService {
  static async list(): Promise<unknown[]> {
    return (await query(`SELECT p.*, a.name AS "createdByName",
      p.click_count AS "clickCount",
      (SELECT COUNT(*)::int FROM mart_promotion_deliveries d WHERE d.promotion_id = p.id AND d.status = 'sent' AND NOT d.is_test) AS "deliveredCount"
      FROM mart_promotions p JOIN mart_admins a ON a.id = p.created_by ORDER BY p.created_at DESC`)).rows;
  }

  static async registerClick(id: string): Promise<string | null> {
    const result = await query<{ destination_url: string | null }>(`UPDATE mart_promotions
      SET click_count = click_count + 1
      WHERE id = $1 AND status = 'sent'
      RETURNING destination_url`, [id]);
    if (!result.rows[0]) return null;
    return customerDestination(result.rows[0].destination_url) || config.urls.customerApp;
  }

  static async create(data: Record<string, unknown>, adminId: string): Promise<unknown> {
    const value = normalizePromotionInput(data) as PromotionInput;
    await this.validateZones(value.zoneIds || []);
    return (await query(`INSERT INTO mart_promotions (type, title, body, image_url, destination_url, zone_ids, audience_rules, scheduled_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [value.type, value.title, value.body, value.imageUrl || null, value.destinationUrl, JSON.stringify(value.zoneIds || []), JSON.stringify(value.audienceRules), value.scheduledAt || null, adminId])).rows[0];
  }

  static async update(id: string, data: Record<string, unknown>): Promise<unknown | null> {
    const existing = (await query<any>('SELECT * FROM mart_promotions WHERE id = $1', [id])).rows[0];
    if (!existing) return null;
    if (existing.status !== 'draft') throw new Error('Only draft promotions can be edited');
    const value = normalizePromotionInput(data, true);
    if (!Object.keys(value).length) return existing;
    if (value.zoneIds !== undefined) await this.validateZones(value.zoneIds || []);
    const fields: Record<string, unknown> = {
      type: value.type, title: value.title, body: value.body, image_url: value.imageUrl,
      destination_url: value.destinationUrl, zone_ids: value.zoneIds === undefined ? undefined : JSON.stringify(value.zoneIds || []),
      audience_rules: value.audienceRules === undefined ? undefined : JSON.stringify(value.audienceRules), scheduled_at: value.scheduledAt,
    };
    const entries = Object.entries(fields).filter(([, field]) => field !== undefined);
    const sql = entries.map(([field], index) => `${field} = $${index + 2}`).join(', ');
    return (await query(`UPDATE mart_promotions SET ${sql} WHERE id = $1 RETURNING *`, [id, ...entries.map(([, field]) => field)])).rows[0];
  }

  static async delete(id: string): Promise<boolean> {
    const result = await query(`DELETE FROM mart_promotions WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
    if (!result.rows[0]) throw new Error('Only draft promotions can be deleted');
    return true;
  }

  static async preview(id: string): Promise<AudiencePreview> {
    const promotion = await this.getDraftOrAny(id);
    return this.previewRules({
      zoneIds: this.zoneIds(promotion),
      audienceRules: { cohorts: this.audienceRules(promotion) },
    });
  }

  static async previewRules(data: Record<string, unknown>): Promise<AudiencePreview> {
    const value = normalizePromotionInput(data, true);
    const zoneIds = value.zoneIds || [];
    const cohorts = value.audienceRules?.cohorts || [];
    await this.validateZones(zoneIds);
    const audience = await this.audience(zoneIds, cohorts);
    return {
      matchedCustomers: audience.matchedCustomers,
      recipients: audience.recipients,
      subscriptions: audience.subscriptions.length,
      exclusions: audience.exclusions,
      cohorts: cohorts.map(cohort => ({ cohort, count: audience.cohortCounts[cohort] || 0 })),
    };
  }

  static async customers(data: Record<string, unknown>): Promise<AudienceCustomerPage> {
    const value = normalizePromotionInput(data, true);
    const zoneIds = value.zoneIds || [];
    const cohorts = value.audienceRules?.cohorts || [];
    const rawCohort = data.cohort;
    if (rawCohort !== undefined && rawCohort !== null && (typeof rawCohort !== 'string' || !AUDIENCE_COHORTS.includes(rawCohort as AudienceCohort))) {
      throw new Error('Invalid audience cohort');
    }
    const cohort = (rawCohort as AudienceCohort | undefined) || null;
    const limit = Math.min(Math.max(Number(data.limit) || 25, 1), 100);
    const offset = Math.max(Number(data.offset) || 0, 0);
    await this.validateZones(zoneIds);
    const sql = audienceCustomersSql(zoneIds, cohorts, cohort, limit, offset);
    const result = (await query<{ total: number; customers: AudienceCustomer[] }>(sql.text, sql.params)).rows[0];
    return {
      total: Number(result?.total || 0),
      customers: (result?.customers || []).map(customer => ({
        ...customer,
        deliveredOrders: Number(customer.deliveredOrders || 0),
        eligible: customer.eligible === true,
        exclusionReason: customer.exclusionReason || null,
      })),
      limit,
      offset,
    };
  }

  static async test(id: string): Promise<PromotionTestResult> {
    const promotion = await this.getDraftOrAny(id);
    if (promotion.status !== 'draft') throw new Error('Only draft promotions can be test sent');
    const normalizedPhones = PROMOTION_TEST_PHONES.map(normalizePhoneDigits);
    const customers = (await query<{ id: string; name: string | null; phone: string }>(
      `SELECT id, name, phone FROM mart_customers
       WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = ANY($1::text[])
       ORDER BY created_at ASC`,
      [normalizedPhones],
    )).rows;
    const customerByPhone = new Map<string, { id: string; name: string | null; phone: string }>();
    for (const customer of customers) {
      const phone = normalizePhoneDigits(customer.phone);
      if (!customerByPhone.has(phone)) customerByPhone.set(phone, customer);
    }
    const targets: PromotionTestTarget[] = [];
    for (const phone of normalizedPhones) {
      const customer = customerByPhone.get(phone);
      if (!customer) {
        targets.push({ phone, name: null, customerId: null, subscriptions: 0, sent: 0, failed: 0, note: 'Customer not found' });
        continue;
      }
      const subscriptions = (await query<Subscription>(
        `SELECT id, customer_id AS "customerId", endpoint, p256dh, auth
         FROM mart_push_subscriptions
         WHERE customer_id = $1
         ORDER BY created_at DESC`,
        [customer.id],
      )).rows;
      if (!subscriptions.length) {
        targets.push({ phone, name: customer.name, customerId: customer.id, subscriptions: 0, sent: 0, failed: 0, note: 'No active push subscription' });
        continue;
      }
      const outcome = await this.deliver(subscriptions, promotion, { isTest: true });
      targets.push({
        phone,
        name: customer.name,
        customerId: customer.id,
        subscriptions: subscriptions.length,
        sent: outcome.sent,
        failed: outcome.failed,
      });
    }
    return {
      sent: targets.reduce((sum, target) => sum + target.sent, 0),
      failed: targets.reduce((sum, target) => sum + target.failed, 0),
      recipients: targets.filter(target => target.subscriptions > 0).length,
      targets,
    };
  }

  static async send(id: string): Promise<{ sent: number; failed: number; recipients: number }> {
    if (isPromotionQuietHours(new Date())) throw new Error('Promotions cannot be sent between 21:00 and 08:59 Asia/Kolkata');
    if (!config.urls.publicApi) throw new Error('MART_PUBLIC_API_URL is required to send promotions in production');
    const promotion = await transaction(async client => {
      const result = await client.query('SELECT * FROM mart_promotions WHERE id = $1 FOR UPDATE', [id]);
      const record = result.rows[0];
      if (!record) throw new Error('Promotion not found');
      if (record.status !== 'draft') throw new Error('Only draft promotions can be sent');
      await client.query(`UPDATE mart_promotions SET status = 'sending' WHERE id = $1`, [id]);
      return record;
    });
    try {
      const audience = await this.audience(this.zoneIds(promotion), this.audienceRules(promotion));
      const outcome = await this.deliver(audience.subscriptions, promotion, { trackClicks: true });
      await transaction(async client => {
        const result = await client.query(`UPDATE mart_promotions
          SET status = 'sent', sent_at = NOW(), recipient_count = $2, delivery_count = $3, fail_count = $4
          WHERE id = $1 AND status = 'sending'
          RETURNING id`, [id, audience.recipients, outcome.sent, outcome.failed]);
        if (!result.rows[0]) throw new Error('Promotion send state changed unexpectedly');
      });
      return { ...outcome, recipients: audience.recipients };
    } catch (error) {
      await query(`UPDATE mart_promotions SET status = 'draft' WHERE id = $1 AND status = 'sending'`, [id]).catch(() => undefined);
      throw error;
    }
  }

  static async dispatchDueScheduled(): Promise<void> {
    const due = await query<{ id: string }>(
      `SELECT id FROM mart_promotions
        WHERE status = 'draft' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT 25`
    );
    await Promise.all(due.rows.map(async promotion => {
      try {
        await this.send(promotion.id);
      } catch (error) {
        // A competing scheduler may have sent the same draft first. Other
        // failures are retried on the next interval while the draft remains.
        console.error(`[promotions] scheduled send failed for ${promotion.id}:`, error);
      }
    }));
  }

  private static async getDraftOrAny(id: string): Promise<any> {
    const promotion = (await query<any>('SELECT * FROM mart_promotions WHERE id = $1', [id])).rows[0];
    if (!promotion) throw new Error('Promotion not found');
    return promotion;
  }

  private static zoneIds(promotion: any): string[] {
    return Array.isArray(promotion.zone_ids) ? promotion.zone_ids : [];
  }

  private static audienceRules(promotion: any): AudienceCohort[] {
    return normalizeAudienceRules(promotion.audience_rules).cohorts;
  }

  private static async validateZones(zoneIds: string[]): Promise<void> {
    if (!zoneIds.length) return;
    const result = await query<{ id: string }>('SELECT id FROM mart_zones WHERE id = ANY($1::uuid[])', [zoneIds]);
    if (result.rows.length !== zoneIds.length) throw new Error('One or more zone IDs are invalid');
  }

  private static async audience(zoneIds: string[], cohorts: AudienceCohort[]): Promise<AudienceResult> {
    const sql = audienceSql(zoneIds, cohorts);
    const result = (await query<AudienceResult>(sql.text, sql.params)).rows[0];
    return {
      matchedCustomers: Number(result?.matchedCustomers || 0),
      recipients: Number(result?.recipients || 0),
      subscriptions: result?.subscriptions || [],
      exclusions: result?.exclusions || {
        notConsented: 0, noSubscription: 0, cohortMismatch: 0, sentPromotionLast7d: 0,
        activeOrder: 0, recentDelivery: 0, recentCancellationOrFailure: 0, lateDeliverySuppression: 0,
      },
      cohortCounts: result?.cohortCounts || {},
    };
  }

  private static async deliver(
    subscriptions: Subscription[],
    promotion: any,
    options: { trackClicks?: boolean; isTest?: boolean } = {},
  ): Promise<{ sent: number; failed: number }> {
    const unique = Array.from(new Map(subscriptions.map(subscription => [subscription.endpoint, subscription])).values());
    const destination = options.isTest
      ? customerDestination(promotion.destination_url) || config.urls.customerApp
      : options.trackClicks
        ? `${config.urls.publicApi}/promotions/${promotion.id}/click`
        : promotion.destination_url;
    const outcomes = await PushService.sendWithOutcomes(unique, {
      title: promotion.title, body: promotion.body, image: promotion.image_url || undefined,
      url: destination, tag: options.isTest ? `promotion-test-${promotion.id}` : `promotion-${promotion.id}`,
    }, { ttl: 86400, urgency: 'normal' });
    await Promise.all(outcomes.map(async ({ subscription, success, error }) => {
      await query(`INSERT INTO mart_promotion_deliveries (promotion_id, customer_id, subscription_id, status, sent_at, error, is_test)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [promotion.id, subscription.customerId, subscription.id, success ? 'sent' : 'failed', success ? new Date() : null, error?.slice(0, 1000) || null, options.isTest === true]).catch(() => undefined);
    }));
    return { sent: outcomes.filter(outcome => outcome.success).length, failed: outcomes.filter(outcome => !outcome.success).length };
  }
}