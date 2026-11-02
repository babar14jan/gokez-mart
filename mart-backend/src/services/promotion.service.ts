import { query, transaction } from '../database/db';
import { PushService } from './push.service';
import { config } from '../config';

const TYPES = ['new_product', 'combo', 'offer', 'back_in_stock', 'we_miss_you', 'custom'] as const;
type PromotionType = typeof TYPES[number];
type PromotionStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export const AUDIENCE_COHORTS = ['recent_purchaser', 'winback_7', 'winback_15', 'winback_30', 'first_order_followup', 'repeat_buyer'] as const;
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
  if (!stats.lastDeliveredAt) return false;
  const ageMs = now.getTime() - stats.lastDeliveredAt.getTime();
  return cohorts.some(cohort => {
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
  recipients: number;
  exclusions: AudienceExclusions;
}

const audienceSql = (zoneIds: string[], cohorts: AudienceCohort[]) => ({
  text: `WITH delivery_stats AS MATERIALIZED (
           SELECT customer_id, COUNT(*)::int AS delivered_orders, MAX(delivered_at) AS last_delivered_at
           FROM mart_orders
           WHERE customer_id IS NOT NULL AND status = 'delivered' AND delivered_at IS NOT NULL
           GROUP BY customer_id
         ),
         latest_zone_order AS MATERIALIZED (
           SELECT DISTINCT ON (customer_id) customer_id, zone_id
           FROM mart_orders
           WHERE customer_id IS NOT NULL AND status NOT IN ('cancelled', 'failed_delivery', 'terminated')
           ORDER BY customer_id, created_at DESC, id DESC
         ),
         promotion_sends AS MATERIALIZED (
           SELECT customer_id, COUNT(DISTINCT promotion_id)::int AS sent_promotion_last_7d
           FROM mart_promotion_deliveries
           WHERE customer_id IS NOT NULL AND status = 'sent' AND sent_at IS NOT NULL
             AND sent_at >= NOW() - INTERVAL '7 days'
           GROUP BY customer_id
         ),
         audience AS MATERIALIZED (
           SELECT c.id AS customer_id, c.marketing_consent,
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
             (cardinality($1::uuid[]) = 0 OR zone_id = ANY($1::uuid[]))
             AND (cardinality($2::text[]) = 0 OR
               ('recent_purchaser' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '7 days' AND last_delivered_at < NOW() - INTERVAL '3 days') OR
               ('winback_7' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '14 days' AND last_delivered_at < NOW() - INTERVAL '7 days') OR
               ('winback_15' = ANY($2::text[]) AND last_delivered_at >= NOW() - INTERVAL '30 days' AND last_delivered_at < NOW() - INTERVAL '14 days') OR
               ('winback_30' = ANY($2::text[]) AND last_delivered_at < NOW() - INTERVAL '30 days') OR
               ('first_order_followup' = ANY($2::text[]) AND delivered_orders = 1 AND last_delivered_at <= NOW() - INTERVAL '7 days') OR
               ('repeat_buyer' = ANY($2::text[]) AND delivered_orders >= 3)
             ) AS target_match
           FROM audience
         ),
         eligible_customers AS MATERIALIZED (
           SELECT * FROM staged
           WHERE marketing_consent
             AND has_subscription
             AND target_match
             AND sent_promotion_last_7d = 0
             AND NOT active_order
             AND NOT recent_delivery
             AND NOT recent_cancellation_or_failure
             AND NOT late_delivery
         ),
         eligible_subscriptions AS MATERIALIZED (
           SELECT DISTINCT ON (ps.endpoint) ps.id, ps.customer_id AS "customerId", ps.endpoint, ps.p256dh, ps.auth, ps.created_at
           FROM mart_push_subscriptions ps
           JOIN eligible_customers ec ON ec.customer_id = ps.customer_id
           ORDER BY ps.endpoint, ps.created_at DESC
         )
         SELECT
           (SELECT COUNT(*)::int FROM eligible_customers) AS recipients,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'customerId', "customerId", 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) FROM eligible_subscriptions), '[]'::jsonb) AS subscriptions,
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
         FROM staged`,
  params: [zoneIds, cohorts],
});

export class PromotionService {
  static async list(): Promise<unknown[]> {
    return (await query(`SELECT p.*, a.name AS "createdByName",
      p.click_count AS "clickCount",
      (SELECT COUNT(*)::int FROM mart_promotion_deliveries d WHERE d.promotion_id = p.id AND d.status = 'sent') AS "deliveredCount"
      FROM mart_promotions p JOIN mart_admins a ON a.id = p.created_by ORDER BY p.created_at DESC`)).rows;
  }

  static async registerClick(id: string): Promise<string | null> {
    const result = await query<{ destination_url: string }>(`UPDATE mart_promotions
      SET click_count = click_count + 1
      WHERE id = $1 AND status = 'sent'
      RETURNING destination_url`, [id]);
    return customerDestination(result.rows[0]?.destination_url);
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

  static async preview(id: string): Promise<{ recipients: number; subscriptions: number; exclusions: AudienceExclusions }> {
    const promotion = await this.getDraftOrAny(id);
    const audience = await this.audience(this.zoneIds(promotion), this.audienceRules(promotion));
    return { recipients: audience.recipients, subscriptions: audience.subscriptions.length, exclusions: audience.exclusions };
  }

  static async test(id: string, adminId: string): Promise<{ sent: number; failed: number }> {
    const promotion = await this.getDraftOrAny(id);
    if (promotion.status !== 'draft') throw new Error('Only draft promotions can be test sent');
    const subscriptions = (await query<Subscription>(`SELECT id, NULL::uuid AS "customerId", endpoint, p256dh, auth
      FROM mart_push_subscriptions WHERE admin_id = $1 ORDER BY created_at DESC`, [adminId])).rows;
    return this.deliver(subscriptions, promotion);
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
      const outcome = await this.deliver(audience.subscriptions, promotion, true);
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
      recipients: Number(result?.recipients || 0),
      subscriptions: result?.subscriptions || [],
      exclusions: result?.exclusions || {
        notConsented: 0, noSubscription: 0, cohortMismatch: 0, sentPromotionLast7d: 0,
        activeOrder: 0, recentDelivery: 0, recentCancellationOrFailure: 0, lateDeliverySuppression: 0,
      },
    };
  }

  private static async deliver(subscriptions: Subscription[], promotion: any, trackClicks = false): Promise<{ sent: number; failed: number }> {
    const unique = Array.from(new Map(subscriptions.map(subscription => [subscription.endpoint, subscription])).values());
    const outcomes = await PushService.sendWithOutcomes(unique, {
      title: promotion.title, body: promotion.body, image: promotion.image_url || undefined,
      url: trackClicks ? `${config.urls.publicApi}/promotions/${promotion.id}/click` : promotion.destination_url, tag: `promotion-${promotion.id}`,
    }, { ttl: 86400, urgency: 'normal' });
    await Promise.all(outcomes.map(async ({ subscription, success, error }) => {
      await query(`INSERT INTO mart_promotion_deliveries (promotion_id, customer_id, subscription_id, status, sent_at, error)
        VALUES ($1,$2,$3,$4,$5,$6)`, [promotion.id, subscription.customerId, subscription.id, success ? 'sent' : 'failed', success ? new Date() : null, error?.slice(0, 1000) || null]).catch(() => undefined);
    }));
    return { sent: outcomes.filter(outcome => outcome.success).length, failed: outcomes.filter(outcome => !outcome.success).length };
  }
}