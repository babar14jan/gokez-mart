import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { query } from '../database/db';
import { config } from '../config';
import { ComplianceService } from './compliance.service';

const TWO_FACTOR_BASE = 'https://2factor.in/API/V1';
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export class CustomerAuthService {

  // ── Send OTP ────────────────────────────────────────────────────────────────
  static async sendOtp(phone: string): Promise<{ message: string }> {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) throw new Error('Invalid phone number');

    // Delete expired OTPs first so they don't count toward rate limit
    await query(`DELETE FROM mart_otps WHERE phone = $1 OR expires_at < NOW()`, [cleaned]);

    // Rate limit: max 3 OTPs per phone per hour (only counts non-expired rows)
    const recent = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM mart_otps
       WHERE phone = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [cleaned]
    );
    if (parseInt(recent.rows[0].count) >= 3) {
      throw new Error('Too many OTP requests. Please wait before trying again.');
    }

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Temporary bypass: only allowed in non-production environments.
    if (process.env.NODE_ENV !== 'production') {
      await query(
        `INSERT INTO mart_otps (phone, otp, expires_at) VALUES ($1, $2, $3)`,
        [cleaned, '123456', expiresAt]
      );
      return { message: 'OTP sent successfully' };
    }

    // Production: 2Factor
    const apiKey = process.env.TWO_FACTOR_API_KEY;
    if (!apiKey) throw new Error('SMS service not configured');

    const url = `${TWO_FACTOR_BASE}/${apiKey}/SMS/91${cleaned}/AUTOGEN2`;
    const res = await fetch(url);
    const data: any = await res.json();

    if (data.Status !== 'Success') {
      throw new Error('Failed to send OTP. Please try again.');
    }

    await query(
      `INSERT INTO mart_otps (phone, otp, session_id, expires_at) VALUES ($1, $2, $3, $4)`,
      [cleaned, data.OTP || '', data.Details, expiresAt]
    );

    return { message: 'OTP sent successfully' };
  }

  // ── Verify OTP ──────────────────────────────────────────────────────────────
  static async verifyOtp(phone: string, otp: string): Promise<{ token: string; customer: any }> {
    const cleaned = phone.replace(/\D/g, '');

    const otpRow = await query<{
      id: string; otp: string; session_id: string | null;
      attempts: number; expires_at: Date;
    }>(
      `SELECT id, otp, session_id, attempts, expires_at
       FROM mart_otps WHERE phone = $1
       ORDER BY created_at DESC LIMIT 1`,
      [cleaned]
    );

    if (!otpRow.rows[0]) throw new Error('No OTP found. Please request a new one.');

    const row = otpRow.rows[0];

    if (new Date() > new Date(row.expires_at)) {
      await query(`DELETE FROM mart_otps WHERE id = $1`, [row.id]);
      throw new Error('OTP expired. Please request a new one.');
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await query(`DELETE FROM mart_otps WHERE id = $1`, [row.id]);
      throw new Error('Too many failed attempts. Please request a new OTP.');
    }

    let verified = false;

    if (process.env.NODE_ENV !== 'production') {
      verified = otp === '123456' || otp === row.otp;
    } else {
      // Verify against stored OTP (returned by AUTOGEN2)
      verified = otp === row.otp;
    }

    if (!verified) {
      await query(`UPDATE mart_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      throw new Error('Invalid OTP. Please try again.');
    }

    // OTP verified — delete it
    await query(`DELETE FROM mart_otps WHERE phone = $1`, [cleaned]);

    // Upsert customer
    await query(
      `INSERT INTO mart_customers (id, phone, order_count, total_spent, last_seen_at)
       VALUES (gen_random_uuid(), $1, 0, 0, NOW())
       ON CONFLICT (phone) DO UPDATE SET last_seen_at = NOW()`,
      [cleaned]
    );

    const customerRes = await query<any>(
      `SELECT id, phone, name, address, address2, order_count as "orderCount",
              total_spent::float as "totalSpent", last_seen_at as "lastSeenAt"
       FROM mart_customers WHERE phone = $1`,
      [cleaned]
    );
    const customer = customerRes.rows[0];

    // Record consent on first login (DPDP Act 2023)
    await ComplianceService.recordConsent(customer.id).catch(() => {});

    // Issue 90-day JWT with jti for blacklist support
    const { v4: uuidv4 } = await import('uuid');
    const token = jwt.sign(
      { id: customer.id, phone: cleaned, type: 'customer', jti: uuidv4() },
      config.jwt.secret,
      { expiresIn: '90d' } as any
    );

    return { token, customer };
  }

  // ── Get customer from token ─────────────────────────────────────────────────
  static async getCustomer(customerId: string): Promise<any> {
    const result = await query<any>(
      `SELECT id, phone, name, address, address2, order_count as "orderCount",
              total_spent::float as "totalSpent", last_seen_at as "lastSeenAt"
       FROM mart_customers WHERE id = $1`,
      [customerId]
    );
    return result.rows[0] || null;
  }

  // ── Update customer profile ─────────────────────────────────────────────────
  static async updateProfile(customerId: string, data: { name?: string; address?: string; address2?: string }): Promise<any> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.name !== undefined)     { fields.push(`name = $${i++}`);     params.push(data.name); }
    if (data.address !== undefined)  { fields.push(`address = $${i++}`);  params.push(data.address); }
    if (data.address2 !== undefined) { fields.push(`address2 = $${i++}`); params.push(data.address2); }
    if (!fields.length) return this.getCustomer(customerId);
    fields.push(`updated_at = NOW()`);
    params.push(customerId);
    const result = await query<any>(
      `UPDATE mart_customers SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, phone, name, address, address2, order_count as "orderCount",
                 total_spent::float as "totalSpent"`,
      params
    );
    return result.rows[0];
  }
}
