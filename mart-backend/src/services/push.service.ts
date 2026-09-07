import webpush from 'web-push';
import { query } from '../database/db';
import { config } from '../config';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

export class PushService {

  // Save subscription for a customer
  static async saveCustomerSubscription(customerId: string, sub: {
    endpoint: string; keys: { p256dh: string; auth: string };
  }): Promise<void> {
    await query(
      `INSERT INTO mart_push_subscriptions (customer_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET customer_id = $1, p256dh = $3, auth = $4`,
      [customerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }

  // Save subscription for an admin
  static async saveAdminSubscription(adminId: string, sub: {
    endpoint: string; keys: { p256dh: string; auth: string };
  }): Promise<void> {
    await query(
      `INSERT INTO mart_push_subscriptions (admin_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET admin_id = $1, p256dh = $3, auth = $4`,
      [adminId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
  }

  // Send to a specific customer
  static async notifyCustomer(customerId: string, payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM mart_push_subscriptions WHERE customer_id = $1`,
      [customerId]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  // Send to all admins of a store
  static async notifyStoreAdmins(storeId: string, payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM mart_push_subscriptions ps
       JOIN mart_admins a ON a.id = ps.admin_id
       WHERE a.store_id = $1 OR a.role = 'super_admin'`,
      [storeId]
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  // Send to all super_admins
  static async notifySuperAdmins(payload: PushPayload): Promise<void> {
    const result = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT ps.endpoint, ps.p256dh, ps.auth
       FROM mart_push_subscriptions ps
       JOIN mart_admins a ON a.id = ps.admin_id
       WHERE a.role = 'super_admin'`
    );
    await this.sendToSubscriptions(result.rows, payload);
  }

  private static async sendToSubscriptions(
    subs: { endpoint: string; p256dh: string; auth: string }[],
    payload: PushPayload
  ): Promise<void> {
    if (!config.vapid.publicKey) return; // VAPID not configured
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        ).catch(async (err: any) => {
          // 410 Gone = subscription expired, remove it
          if (err.statusCode === 410) {
            await query(`DELETE FROM mart_push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
          }
        })
      )
    );
    // Silent — push failures never break the main flow
    results.forEach(r => { if (r.status === 'rejected') console.warn('[Push] Failed:', r.reason?.message); });
  }
}
