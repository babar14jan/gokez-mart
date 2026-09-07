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
}
