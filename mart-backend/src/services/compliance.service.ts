import { query } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export class ComplianceService {

  // ── Consent ──────────────────────────────────────────────────────────────────
  static async recordConsent(customerId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await query(
      `INSERT INTO mart_consents (id, customer_id, consent_type, granted, ip_address, user_agent)
       VALUES (gen_random_uuid(), $1, 'personal_data', true, $2, $3)`,
      [customerId, ipAddress || null, userAgent || null]
    );
  }

  // ── Token blacklist ───────────────────────────────────────────────────────────
  static async blacklistToken(jti: string, expiresAt: Date): Promise<void> {
    await query(
      `INSERT INTO mart_token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING`,
      [jti, expiresAt]
    );
  }

  static async isTokenBlacklisted(jti: string): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM mart_token_blacklist WHERE jti = $1 AND expires_at > NOW()`,
      [jti]
    );
    return result.rows.length > 0;
  }

  static async cleanupExpiredTokens(): Promise<void> {
    await query(`DELETE FROM mart_token_blacklist WHERE expires_at < NOW()`);
  }

  // ── Account deletion ──────────────────────────────────────────────────────────
  static async requestDeletion(customerId: string, reason?: string): Promise<any> {
    const existing = await query(
      `SELECT id, status FROM mart_deletion_requests WHERE customer_id = $1 AND status = 'pending'`,
      [customerId]
    );
    if (existing.rows.length) return existing.rows[0];

    const result = await query(
      `INSERT INTO mart_deletion_requests (id, customer_id, reason)
       VALUES (gen_random_uuid(), $1, $2)
       RETURNING id, status, created_at as "createdAt"`,
      [customerId, reason || null]
    );
    return result.rows[0];
  }

  static async getDeletionRequest(customerId: string): Promise<any> {
    const result = await query(
      `SELECT id, status, reason, notes, created_at as "createdAt", updated_at as "updatedAt"
       FROM mart_deletion_requests WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    return result.rows[0] || null;
  }

  static async getAllDeletionRequests(): Promise<any[]> {
    const result = await query(
      `SELECT dr.id, dr.status, dr.reason, dr.notes,
              dr.created_at as "createdAt", dr.updated_at as "updatedAt",
              c.phone as "customerPhone", c.name as "customerName"
       FROM mart_deletion_requests dr
       LEFT JOIN mart_customers c ON c.id = dr.customer_id
       ORDER BY dr.created_at DESC`
    );
    return result.rows;
  }

  static async processDeletion(id: string, adminId: string, action: 'approved' | 'rejected', notes?: string): Promise<void> {
    await query(
      `UPDATE mart_deletion_requests SET status = $1, reviewed_by = $2, notes = $3, updated_at = NOW() WHERE id = $4`,
      [action, adminId, notes || null, id]
    );
    if (action === 'approved') {
      // Anonymise customer data
      const req = await query(`SELECT customer_id FROM mart_deletion_requests WHERE id = $1`, [id]);
      const customerId = req.rows[0]?.customer_id;
      if (customerId) {
        await query(
          `UPDATE mart_customers SET
             name = '[Deleted]', phone = concat('deleted_', id::text), address = null, address2 = null,
             updated_at = NOW()
           WHERE id = $1`,
          [customerId]
        );
      }
    }
  }

  // ── Grievances ────────────────────────────────────────────────────────────────
  static async submitGrievance(customerId: string, subject: string, description: string): Promise<any> {
    const result = await query(
      `INSERT INTO mart_grievances (id, customer_id, subject, description)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id, status, created_at as "createdAt"`,
      [customerId, subject, description]
    );
    return result.rows[0];
  }

  static async getMyGrievances(customerId: string): Promise<any[]> {
    const result = await query(
      `SELECT id, subject, description, status, response, created_at as "createdAt", updated_at as "updatedAt"
       FROM mart_grievances WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId]
    );
    return result.rows;
  }

  static async getAllGrievances(): Promise<any[]> {
    const result = await query(
      `SELECT g.id, g.subject, g.description, g.status, g.response,
              g.created_at as "createdAt", g.updated_at as "updatedAt",
              c.phone as "customerPhone", c.name as "customerName"
       FROM mart_grievances g
       LEFT JOIN mart_customers c ON c.id = g.customer_id
       ORDER BY g.created_at DESC`
    );
    return result.rows;
  }

  static async respondToGrievance(id: string, adminId: string, response: string, status: 'in_progress' | 'resolved' | 'closed'): Promise<void> {
    await query(
      `UPDATE mart_grievances SET response = $1, status = $2, resolved_by = $3, updated_at = NOW() WHERE id = $4`,
      [response, status, adminId, id]
    );
  }

  // ── Audit log ────────────────────────────────────────────────────────────────
  static async logAudit(data: {
    adminId?: string; username?: string; role?: string;
    action: string; entityType?: string; entityId?: string;
    detail?: string; ipAddress?: string; userAgent?: string;
    status?: 'success' | 'failed';
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO mart_audit_logs
           (admin_id, username, role, action, entity_type, entity_id, detail, ip_address, user_agent, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [data.adminId || null, data.username || null, data.role || null,
         data.action, data.entityType || null, data.entityId || null,
         data.detail || null, data.ipAddress || null, data.userAgent || null,
         data.status || 'success']
      );
    } catch {} // never block the main request
  }

  static async getAuditLogs(filters?: { adminId?: string; action?: string; limit?: number }): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters?.adminId) { conditions.push(`admin_id = $${i++}`); params.push(filters.adminId); }
    if (filters?.action)  { conditions.push(`action = $${i++}`);   params.push(filters.action); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit || 200;
    params.push(limit);
    const result = await query(
      `SELECT id, username, role, action, entity_type as "entityType", entity_id as "entityId",
              detail, ip_address as "ipAddress", status, created_at as "createdAt"
       FROM mart_audit_logs ${where}
       ORDER BY created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  // ── Data export (Right to Portability) ───────────────────────────────────────
  static async requestDataExport(customerId: string): Promise<any> {
    const existing = await query(
      `SELECT id, status, created_at FROM mart_data_exports
       WHERE customer_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    if (existing.rows.length) return existing.rows[0];

    const [profile, orders, grievances, consents] = await Promise.all([
      query(`SELECT id, phone, name, address, address2, order_count, total_spent, created_at FROM mart_customers WHERE id = $1`, [customerId]),
      query(`SELECT order_number, status, items, total_amount, payment_method, created_at FROM mart_orders WHERE customer_id = $1 ORDER BY created_at DESC`, [customerId]),
      query(`SELECT subject, description, status, response, created_at FROM mart_grievances WHERE customer_id = $1`, [customerId]),
      query(`SELECT consent_type, granted, created_at FROM mart_consents WHERE customer_id = $1`, [customerId]),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profile.rows[0] || null,
      orders: orders.rows,
      grievances: grievances.rows,
      consents: consents.rows,
    };

    const result = await query(
      `INSERT INTO mart_data_exports (customer_id, status, data, ready_at)
       VALUES ($1, 'ready', $2, NOW())
       RETURNING id, status, created_at as "createdAt", ready_at as "readyAt"`,
      [customerId, JSON.stringify(exportData)]
    );
    return result.rows[0];
  }

  static async getDataExport(customerId: string): Promise<any> {
    const result = await query(
      `SELECT id, status, data, created_at as "createdAt", ready_at as "readyAt"
       FROM mart_data_exports WHERE customer_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    if (!result.rows[0]) return null;
    if (result.rows[0].status === 'ready') {
      await query(`UPDATE mart_data_exports SET status = 'downloaded', downloaded_at = NOW() WHERE id = $1`, [result.rows[0].id]);
    }
    return result.rows[0];
  }

  // ── Marketing consent ─────────────────────────────────────────────────────────
  static async updateMarketingConsent(customerId: string, granted: boolean): Promise<void> {
    await query(
      `UPDATE mart_customers SET marketing_consent = $1, marketing_consent_at = NOW() WHERE id = $2`,
      [granted, customerId]
    );
    await query(
      `INSERT INTO mart_consents (customer_id, consent_type, granted) VALUES ($1, 'marketing', $2)`,
      [customerId, granted]
    );
  }

  static async getMarketingConsent(customerId: string): Promise<boolean> {
    const result = await query(`SELECT marketing_consent FROM mart_customers WHERE id = $1`, [customerId]);
    return result.rows[0]?.marketing_consent || false;
  }
}
