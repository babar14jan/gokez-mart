import { query } from '../database/db';

export type LeadStatus = 'all' | 'unverified' | 'verified' | 'guest';
export type LeadRange = 'today' | '7d' | '30d' | 'custom' | 'all';

const RANGE_DAYS: Record<Exclude<LeadRange, 'custom'>, number | null> = { today: null, '7d': 7, '30d': 30, all: null };

function istRangeWhere(column: string, range: LeadRange, from?: string, to?: string): { sql: string; params: unknown[] } {
  const startOfToday = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  if (range === 'custom') {
    if (!from || !to) return { sql: 'FALSE', params: [] };
    return {
      sql: `${column} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      params: [from, to],
    };
  }
  if (range === 'all') return { sql: 'TRUE', params: [] };
  if (range === 'today') return { sql: `${column} >= ${startOfToday}`, params: [] };
  return {
    sql: `${column} >= (${startOfToday} - (($1::int - 1) * INTERVAL '1 day'))`,
    params: [RANGE_DAYS[range]],
  };
}

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

  static async findAll(status: LeadStatus, range: LeadRange = '30d', from?: string, to?: string) {
    // A guest is a plain checkout pickup: never asked for an OTP (count 0) and
    // never verified. visually the admin page renders these as their own bucket
    // so guest conversion is not hidden inside "unverified".
    const condition = status === 'unverified'
      ? 'l.verified_at IS NULL AND l.otp_request_count > 0'
      : status === 'verified'
        ? 'l.verified_at IS NOT NULL'
        : status === 'guest'
          ? 'l.verified_at IS NULL AND l.otp_request_count = 0'
          : 'TRUE';
    const dateRange = istRangeWhere('l.first_otp_requested_at', range, from, to);
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
       WHERE ${condition} AND ${dateRange.sql}
       ORDER BY COALESCE(l.last_successful_login_at, l.last_otp_requested_at) DESC
       LIMIT 500`,
      dateRange.params
    );
    return result.rows;
  }

  static async getCounts(range: LeadRange = '30d', from?: string, to?: string) {
    const dateRange = istRangeWhere('first_otp_requested_at', range, from, to);
    const result = await query<{ total: number; unverified: number; verified: number; guest: number }>(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE verified_at IS NULL AND otp_request_count > 0)::int as unverified,
              COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::int as verified,
              COUNT(*) FILTER (WHERE verified_at IS NULL AND otp_request_count = 0)::int as guest
      FROM mart_customer_leads
      WHERE ${dateRange.sql}`,
          dateRange.params
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