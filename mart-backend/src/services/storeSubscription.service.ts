import { query, transaction } from '../database/db';

export type StoreSubscriptionStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'cancelled';

export interface StoreSubscriptionSummary {
  id: string | null;
  storeId: string;
  storeName: string;
  storeIsActive: boolean;
  storeIsLive: boolean;
  monthlyFee: number;
  planName: string | null;
  amount: number | null;
  status: StoreSubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  paymentReference: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface SaveStoreSubscription {
  planName: string;
  amount: number;
  status: StoreSubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  paymentReference?: string;
  notes?: string;
}

const SUBSCRIPTION_SELECT = `
  SELECT sub.id, s.id as "storeId", s.name as "storeName",
         s.is_active as "storeIsActive", s.is_live as "storeIsLive",
         s.monthly_fee::float as "monthlyFee", sub.plan_name as "planName",
         sub.amount::float as amount,
         CASE
           WHEN sub.status = 'active' AND (sub.starts_at > NOW() OR sub.ends_at <= NOW()) THEN 'expired'
           ELSE COALESCE(sub.status, 'pending')
         END as status,
         sub.starts_at as "startsAt", sub.ends_at as "endsAt",
         sub.payment_reference as "paymentReference", sub.notes,
         sub.updated_at as "updatedAt"
  FROM mart_stores s
  LEFT JOIN LATERAL (
    SELECT * FROM mart_store_subscriptions
    WHERE store_id = s.id
    ORDER BY (status = 'active') DESC, ends_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  ) sub ON true
`;

export class StoreSubscriptionService {
  static async findAll(): Promise<StoreSubscriptionSummary[]> {
    const result = await query<StoreSubscriptionSummary>(`${SUBSCRIPTION_SELECT} ORDER BY s.name ASC`);
    return result.rows;
  }

  static async findByStoreId(storeId: string): Promise<StoreSubscriptionSummary | null> {
    const result = await query<StoreSubscriptionSummary>(`${SUBSCRIPTION_SELECT} WHERE s.id = $1`, [storeId]);
    return result.rows[0] || null;
  }

  static async isActive(storeId: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM mart_store_subscriptions
       WHERE store_id = $1 AND status = 'active'
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())
       LIMIT 1`,
      [storeId]
    );
    return result.rows.length > 0;
  }

  static async adminHasActiveSubscription(adminId: string): Promise<boolean> {
    const result = await query(
      `WITH accessible_stores AS (
         SELECT store_id FROM mart_admins WHERE id = $1 AND store_id IS NOT NULL
         UNION
         SELECT store_id FROM mart_admin_store_assignments WHERE admin_id = $1 AND is_active = true
       )
       SELECT 1 FROM mart_store_subscriptions ss
       JOIN accessible_stores ast ON ast.store_id = ss.store_id
       WHERE ss.status = 'active'
         AND (ss.starts_at IS NULL OR ss.starts_at <= NOW())
         AND (ss.ends_at IS NULL OR ss.ends_at > NOW())
       LIMIT 1`,
      [adminId]
    );
    return result.rows.length > 0;
  }

  static async createPending(storeId: string, amount: number, createdBy: string): Promise<void> {
    await query(
      `INSERT INTO mart_store_subscriptions (store_id, amount, status, created_by, notes)
       VALUES ($1, $2, 'pending', $3, 'Activate this subscription before the store owner signs in')`,
      [storeId, amount, createdBy]
    );
  }

  static async save(storeId: string, data: SaveStoreSubscription, createdBy: string): Promise<StoreSubscriptionSummary> {
    const startsAt = data.startsAt ? new Date(data.startsAt) : null;
    const endsAt = data.endsAt ? new Date(data.endsAt) : null;
    if (Number.isNaN(startsAt?.getTime()) || Number.isNaN(endsAt?.getTime())) throw new Error('Invalid subscription date');
    if (startsAt && endsAt && endsAt <= startsAt) throw new Error('Subscription end date must be after its start date');

    await transaction(async client => {
      if (data.status === 'active') {
        await client.query(
          `UPDATE mart_store_subscriptions
           SET status = CASE WHEN ends_at IS NOT NULL AND ends_at <= NOW() THEN 'expired' ELSE 'cancelled' END,
               updated_at = NOW()
           WHERE store_id = $1 AND status = 'active'`,
          [storeId]
        );
        await client.query(
          `INSERT INTO mart_store_subscriptions
             (store_id, plan_name, amount, status, starts_at, ends_at, payment_reference, notes, created_by)
           VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8)`,
          [storeId, data.planName.trim(), data.amount, startsAt, endsAt,
           data.paymentReference?.trim() || null, data.notes?.trim() || null, createdBy]
        );
      } else {
        await client.query(
          `UPDATE mart_store_subscriptions SET status = $2, plan_name = $3, amount = $4,
             starts_at = $5, ends_at = $6, payment_reference = $7, notes = $8, updated_at = NOW()
           WHERE store_id = $1 AND status = 'active'`,
          [storeId, data.status, data.planName.trim(), data.amount, startsAt, endsAt,
           data.paymentReference?.trim() || null, data.notes?.trim() || null]
        );
      }
    });

    const subscription = await this.findByStoreId(storeId);
    if (!subscription) throw new Error('Store not found');
    return subscription;
  }
}