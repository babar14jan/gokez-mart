import { query } from '../database/db';

export type LeadStatus = 'all' | 'unverified' | 'verified' | 'guest';

export class CustomerLeadService {
  static async recordOtpRequest(phone: string): Promise<void> {
    await query(
      `INSERT INTO mart_customer_leads (phone)
       VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET
         last_otp_requested_at = NOW(),
         otp_request_count = mart_customer_leads.otp_request_count + 1,
         updated_at = NOW()`,
      [phone]
    );
  }

  static async markVerified(phone: string, customerId: string): Promise<void> {
    await query(
      `INSERT INTO mart_customer_leads (phone, customer_id, verified_at, last_successful_login_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (phone) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         verified_at = COALESCE(mart_customer_leads.verified_at, NOW()),
         last_successful_login_at = NOW(),
         updated_at = NOW()`,
      [phone, customerId]
    );
  }

  static async findAll(status: LeadStatus) {
    // A guest is a plain checkout pickup: never asked for an OTP (count 0) and
    // never verified. visually the admin page renders these as their own bucket
    // so guest conversion is not hidden inside "unverified".
    const condition = status === 'unverified'
      ? 'l.verified_at IS NULL'
      : status === 'verified'
        ? 'l.verified_at IS NOT NULL'
        : status === 'guest'
          ? 'l.verified_at IS NULL AND l.otp_request_count = 0'
          : 'TRUE';
    const result = await query(
      `SELECT l.id, l.phone, c.name,
              l.otp_request_count as "otpRequestCount",
              l.first_otp_requested_at as "firstOtpRequestedAt",
              l.last_otp_requested_at as "lastOtpRequestedAt",
              l.verified_at as "verifiedAt",
              l.last_successful_login_at as "lastSuccessfulLoginAt",
              COALESCE(c.marketing_consent, false) as "marketingConsent"
       FROM mart_customer_leads l
       LEFT JOIN mart_customers c ON c.id = l.customer_id
       WHERE ${condition}
       ORDER BY COALESCE(l.last_successful_login_at, l.last_otp_requested_at) DESC
       LIMIT 500`
    );
    return result.rows;
  }

  static async getCounts() {
    const result = await query<{ total: number; unverified: number; verified: number; guest: number }>(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE verified_at IS NULL)::int as unverified,
              COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::int as verified,
              COUNT(*) FILTER (WHERE verified_at IS NULL AND otp_request_count = 0)::int as guest
       FROM mart_customer_leads`
    );
    return result.rows[0];
  }

  static async getMarketingExport() {
    const result = await query<{ name: string | null; phone: string; last_successful_login_at: Date }>(
      `SELECT c.name, l.phone, l.last_successful_login_at
       FROM mart_customer_leads l
       INNER JOIN mart_customers c ON c.id = l.customer_id
       WHERE l.verified_at IS NOT NULL AND c.marketing_consent = true
       ORDER BY l.last_successful_login_at DESC`
    );
    return result.rows;
  }
}