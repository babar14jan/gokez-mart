import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../database/db';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiError';
import {
  REFERRAL_RESERVATION_TTL_MINUTES,
  addDays,
  capReached,
  generateReferralCode,
  isExpired,
  normalizeReferralCode,
  qualifyingOrderValue,
  reservationExpiry,
  roundMoney,
} from '../utils/referralLogic';

type DbClient = { query: <T = any>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> };
type AttributionSource = 'registration' | 'account' | 'checkout' | 'link';
type CampaignAction = 'activate' | 'pause';
type ReportType = 'conversion' | 'orders' | 'customers' | 'liability';
type ExportType = 'records' | 'ledger';

const REFERRAL_JOB_LOCK_KEY = 8_104_402;
const CODE_GENERATION_ATTEMPTS = 12;
const NON_CANCELLED = `status NOT IN ('cancelled', 'terminated', 'failed_delivery')`;
const ACTIVE_WINDOW = `status = 'active' AND (starts_at IS NULL OR starts_at <= NOW())
                      AND (ends_at IS NULL OR ends_at >= NOW())`;

const DEFAULT_CAMPAIGN = {
  id: null as string | null,
  name: 'Referral & Earn',
  status: 'active',
  version: 1,
  referrerReward: 100,
  refereeReward: 100,
  creditAmount: 20,
  creditsPerReward: 5,
  qualifyingOrderMin: 149,
  redemptionMin: 99,
  expiryDays: 90 as number | null,
  maxReferralsPerReferrer: 10,
  stackingEnabled: false,
  unlockTrigger: 'delivered',
  cashWithdrawal: false,
  transferEnabled: false,
  startsAt: null as string | null,
  endsAt: null as string | null,
  budget: null as number | null,
  codeLength: 6,
  fraudReviewEnabled: false,
  valueBasis: 'item_subtotal',
  categoryIds: [] as string[],
};

const money = (value: unknown): number => roundMoney(Number(value ?? 0));

const campaignFields: Record<string, string> = {
  name: 'name',
  referrerReward: 'referrer_reward',
  refereeReward: 'referee_reward',
  creditAmount: 'credit_amount',
  creditsPerReward: 'credits_per_reward',
  qualifyingOrderMin: 'qualifying_order_min',
  redemptionMin: 'redemption_min',
  expiryDays: 'expiry_days',
  maxReferralsPerReferrer: 'max_referrals_per_referrer',
  stackingEnabled: 'stacking_enabled',
  unlockTrigger: 'unlock_trigger',
  cashWithdrawal: 'cash_withdrawal',
  transferEnabled: 'transfer_enabled',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  budget: 'budget',
  codeLength: 'code_length',
  fraudReviewEnabled: 'fraud_review_enabled',
  valueBasis: 'value_basis',
  categoryIds: 'category_ids',
  reason: 'reason',
};

function finiteNumber(value: unknown, label: string, { integer = false, nullable = false } = {}): number | null {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    throw badRequest(`${label} must be a ${integer ? 'whole ' : ''}number`);
  }
  return number;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function pagination(queryParams: Record<string, unknown>): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(String(queryParams.limit ?? 50), 10) || 50, 1), 500);
  const offset = Math.max(parseInt(String(queryParams.offset ?? 0), 10) || 0, 0);
  return { limit, offset };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export class ReferralService {
  // ── Infrastructure helpers ──────────────────────────────────────────────────

  private static async withClient<T>(client: DbClient | undefined, fn: (db: DbClient) => Promise<T>): Promise<T> {
    if (client) return fn(client);
    return transaction(db => fn(db));
  }

  private static async activeCampaign(client: DbClient, campaignId?: string | null, lock = false): Promise<any | null> {
    if (campaignId) {
      const result = await client.query(
        `SELECT * FROM mart_referral_campaigns WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
        [campaignId]
      );
      const campaign = result.rows[0];
      if (!campaign || campaign.status !== 'active' ||
        (campaign.starts_at && new Date(campaign.starts_at) > new Date()) ||
        (campaign.ends_at && new Date(campaign.ends_at) < new Date())) return null;
      return campaign;
    }
    const result = await client.query(
      `SELECT * FROM mart_referral_campaigns WHERE ${ACTIVE_WINDOW} ORDER BY created_at DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`
    );
    return result.rows[0] || null;
  }

  private static async requireActiveCampaign(client: DbClient, campaignId?: string | null): Promise<any> {
    const campaign = await this.activeCampaign(client, campaignId);
    if (!campaign) throw badRequest('The referral campaign is not active right now');
    return campaign;
  }

  private static publicCampaign(campaign: any | null): typeof DEFAULT_CAMPAIGN {
    if (!campaign) return { ...DEFAULT_CAMPAIGN, categoryIds: [] };
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      version: Number(campaign.version) || 1,
      referrerReward: money(campaign.referrer_reward),
      refereeReward: money(campaign.referee_reward),
      creditAmount: money(campaign.credit_amount),
      creditsPerReward: parseInt(campaign.credits_per_reward, 10) || 5,
      qualifyingOrderMin: money(campaign.qualifying_order_min),
      redemptionMin: money(campaign.redemption_min),
      expiryDays: campaign.expiry_days === null || campaign.expiry_days === undefined
        ? null
        : parseInt(campaign.expiry_days, 10),
      maxReferralsPerReferrer: parseInt(campaign.max_referrals_per_referrer, 10) || 10,
      stackingEnabled: Boolean(campaign.stacking_enabled),
      unlockTrigger: campaign.unlock_trigger,
      cashWithdrawal: Boolean(campaign.cash_withdrawal),
      transferEnabled: Boolean(campaign.transfer_enabled),
      startsAt: campaign.starts_at ? new Date(campaign.starts_at).toISOString() : null,
      endsAt: campaign.ends_at ? new Date(campaign.ends_at).toISOString() : null,
      budget: campaign.budget === null || campaign.budget === undefined ? null : money(campaign.budget),
      codeLength: parseInt(campaign.code_length, 10) || 6,
      fraudReviewEnabled: Boolean(campaign.fraud_review_enabled),
      valueBasis: campaign.value_basis,
      categoryIds: Array.isArray(campaign.category_ids) ? campaign.category_ids : [],
    };
  }

  private static async audit(client: DbClient, data: {
    entityType: string;
    entityId?: string | null;
    action: string;
    actorAdminId?: string | null;
    actorCustomerId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  }): Promise<void> {
    await client.query(
      `INSERT INTO mart_referral_audit_logs
         (id, entity_type, entity_id, action, actor_admin_id, actor_customer_id, before, after, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [uuidv4(), data.entityType, data.entityId || null, data.action, data.actorAdminId || null,
        data.actorCustomerId || null,
        data.before === undefined ? null : JSON.stringify(data.before),
        data.after === undefined ? null : JSON.stringify(data.after),
        data.reason || null]
    );
  }

  private static async balanceAfter(client: DbClient, customerId?: string | null, delta = 0): Promise<number> {
    if (!customerId) return roundMoney(Math.max(0, delta));
    const result = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS balance
         FROM mart_referral_credits
        WHERE customer_id = $1 AND status IN ('available', 'reserved')`,
      [customerId]
    );
    return roundMoney(Math.max(0, money(result.rows[0]?.balance) + delta));
  }

  private static async ledger(client: DbClient, data: {
    type: 'issue' | 'reserve' | 'restore' | 'redeem' | 'expire' | 'reverse' | 'admin_adjust';
    amount: number;
    customerId?: string | null;
    creditId?: string | null;
    rewardId?: string | null;
    referralId?: string | null;
    orderId?: string | null;
    reason?: string | null;
    actorAdminId?: string | null;
    idempotencyKey?: string | null;
    balanceAfter?: number;
  }): Promise<void> {
    const idempotencyKey = data.idempotencyKey || `${data.type}:${uuidv4()}`;
    const balance = data.balanceAfter ?? await this.balanceAfter(client, data.customerId);
    await client.query(
      `INSERT INTO mart_referral_transactions
         (id, reference, credit_id, reward_id, referral_id, customer_id, order_id, type,
          amount, balance_after, reason, actor_admin_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [uuidv4(), `TXN-${data.type.toUpperCase()}-${uuidv4()}`, data.creditId || null, data.rewardId || null,
        data.referralId || null, data.customerId || null, data.orderId || null, data.type,
        money(data.amount), balance, data.reason || null, data.actorAdminId || null, idempotencyKey]
    );
  }

  private static async reverseRewards(
    client: DbClient,
    referralId: string,
    reason: string,
    actorAdminId?: string | null,
  ): Promise<number> {
    const credits = await client.query(
      `SELECT id, customer_id, amount FROM mart_referral_credits
        WHERE referral_id = $1 AND status <> 'reversed' FOR UPDATE`,
      [referralId]
    );
    for (const credit of credits.rows) {
      await client.query(
        `UPDATE mart_referral_credits SET status = 'reversed', reserved_at = NULL,
            reservation_expires_at = NULL, order_id = NULL, updated_at = NOW()
          WHERE id = $1`,
        [credit.id]
      );
      await this.ledger(client, {
        type: 'reverse', amount: -money(credit.amount), customerId: credit.customer_id,
        creditId: credit.id, referralId, reason,
        actorAdminId,
        idempotencyKey: `REVERSE-CREDIT-${credit.id}-${referralId}`,
      });
    }
    const rewards = await client.query(
      `UPDATE mart_referral_rewards SET status = 'reversed' WHERE referral_id = $1 AND status = 'issued' RETURNING *`,
      [referralId]
    );
    for (const reward of rewards.rows) {
      await this.ledger(client, {
        type: 'reverse', amount: -money(reward.amount), customerId: reward.customer_id,
        rewardId: reward.id, referralId, reason, actorAdminId,
        idempotencyKey: `REVERSE-REWARD-${reward.id}`,
      });
    }
    await client.query(
      `UPDATE mart_referrals
          SET status = 'pending', qualifying_order_id = NULL, qualifying_order_value = NULL,
              qualified_at = NULL, rewarded_at = NULL,
              notes = $2, updated_at = NOW()
        WHERE id = $1`,
      [referralId, reason]
    );
    await this.audit(client, {
      entityType: 'referral', entityId: referralId, action: 'rewards_reversed',
      actorAdminId, reason,
      after: { status: 'pending', reason },
    });
    return credits.rows.length;
  }

  // ── Codes and validation ────────────────────────────────────────────────────

  static async ensureCode(customerId: string): Promise<string> {
    return transaction(async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`referral-code:${customerId}`]);
      const existing = await client.query(
        `SELECT code FROM mart_referral_codes WHERE customer_id = $1`, [customerId]
      );
      if (existing.rows[0]) return existing.rows[0].code as string;

      for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
        const code = generateReferralCode();
        try {
          await client.query(
            `INSERT INTO mart_referral_codes (id, customer_id, code) VALUES ($1, $2, $3)`,
            [uuidv4(), customerId, code]
          );
          await this.audit(client, {
            entityType: 'referral_code', entityId: customerId, action: 'code_issued',
            actorCustomerId: customerId, after: { code },
          });
          return code;
        } catch (error: any) {
          if (error?.code !== '23505') throw error;
        }
      }
      throw new Error('Could not allocate a unique referral code');
    });
  }

  static async generateCode(): Promise<string> {
    return generateReferralCode();
  }

  static async validateCode(code: string): Promise<{
    valid: boolean; code: string | null; message: string;
  }> {
    const normalized = normalizeReferralCode(code);
    if (!normalized) {
      return { valid: false, code: null, message: 'Enter a valid 6-character referral code' };
    }
    const result = await query(
      `SELECT 1 FROM mart_referral_codes rc
         JOIN mart_customers c ON c.id = rc.customer_id
        WHERE rc.code = $1 AND rc.is_active = true`,
      [normalized]
    );
    if (!result.rows[0]) return { valid: false, code: normalized, message: 'This referral code is not valid' };
    return {
      valid: true,
      code: normalized,
      message: 'Referral code accepted. Rewards unlock after your first delivered order.',
    };
  }

  /** Identifies the code type server-side. Referral codes never carry a discount. */
  static async validateCouponOrReferral(code: string, customerId?: string | null): Promise<{
    type: 'referral' | 'coupon' | 'unknown';
    valid: boolean;
    code: string;
    discount: number;
    message: string;
    referralCode?: string;
    campaignId?: string;
  }> {
    const raw = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!raw) return { type: 'unknown', valid: false, code: '', discount: 0, message: 'Code required' };

    const normalized = normalizeReferralCode(raw);
    if (normalized) {
      const referral = await query(
        `SELECT customer_id FROM mart_referral_codes WHERE code = $1 AND is_active = true`,
        [normalized]
      );
      if (referral.rows[0]) {
        if (customerId && referral.rows[0].customer_id === customerId) {
          return {
            type: 'referral', valid: false, code: normalized, discount: 0, referralCode: normalized,
            message: 'You cannot use your own referral code',
          };
        }
        return {
          type: 'referral', valid: true, code: normalized, discount: 0, referralCode: normalized,
          message: 'Referral reward unlocks after your first qualifying delivered order.',
        };
      }
    }

    const coupon = await query(
      `SELECT id, name, status, starts_at, ends_at FROM mart_campaigns WHERE coupon_code = $1`,
      [raw]
    );
    const campaign = coupon.rows[0];
    if (!campaign) return { type: 'unknown', valid: false, code: raw, discount: 0, message: 'Code not recognised' };
    const now = new Date();
    const valid = ['active', 'scheduled'].includes(campaign.status) &&
      (!campaign.starts_at || new Date(campaign.starts_at) <= now) &&
      (!campaign.ends_at || new Date(campaign.ends_at) >= now);
    return {
      type: 'coupon', valid, code: raw, discount: 0, campaignId: campaign.id,
      message: valid ? 'Coupon accepted' : 'This coupon is no longer active',
    };
  }

  // ── Customer views and attribution ──────────────────────────────────────────

  static async getMe(customerId: string): Promise<any> {
    const code = await this.ensureCode(customerId);
    const [campaignResult, customerResult, creditsResult, rewardsResult, referralsResult, priorAttributionResult, leadResult, orderResult] = await Promise.all([
      query(`SELECT * FROM mart_referral_campaigns WHERE ${ACTIVE_WINDOW} ORDER BY created_at DESC LIMIT 1`),
      query(`SELECT id FROM mart_customers WHERE id = $1`, [customerId]),
      query<any>(
        `SELECT id, amount::float AS amount, status,
                unlocked_at AS "unlockedAt", expires_at AS "expiresAt",
                order_id AS "orderId", created_at AS "createdAt"
           FROM mart_referral_credits WHERE customer_id = $1 ORDER BY created_at DESC`,
        [customerId]
      ),
      query<any>(
        `SELECT role, amount::float AS amount, status FROM mart_referral_rewards WHERE customer_id = $1`,
        [customerId]
      ),
      query<any>(
        `SELECT id, status, attributed_at AS "attributedAt", rewarded_at AS "rewardedAt",
                referrer_customer_id AS "referrerCustomerId"
           FROM mart_referrals
          WHERE referrer_customer_id = $1 OR referred_customer_id = $1
          ORDER BY attributed_at DESC`,
        [customerId]
      ),
      query(`SELECT 1 FROM mart_referrals WHERE referred_customer_id = $1`, [customerId]),
      query(`SELECT 1 FROM mart_customer_leads WHERE customer_id = $1 AND verified_at IS NOT NULL`, [customerId]),
      query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM mart_orders WHERE (customer_id = $1 OR guest_phone = (SELECT phone FROM mart_customers WHERE id = $1)) AND ${NON_CANCELLED}`,
        [customerId]
      ),
    ]);
    if (!customerResult.rows[0]) throw notFound('Customer not found');

    const credits = creditsResult.rows.map(row => ({
      id: row.id,
      amount: money(row.amount),
      status: row.status,
      unlockedAt: row.unlockedAt ? new Date(row.unlockedAt).toISOString() : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      orderId: row.orderId || null,
    }));
    const byStatus = (status: string) => credits
      .filter(credit => credit.status === status)
      .reduce((total, credit) => total + credit.amount, 0);
    const rewards = rewardsResult.rows.filter(row => row.status === 'issued');
    const myReferrals = referralsResult.rows.filter(
      row => row.status === 'rewarded' && row.referrerCustomerId === customerId
    );

    return {
      code,
      campaign: this.publicCampaign(campaignResult.rows[0]),
      stats: {
        totalEarned: roundMoney(rewards.reduce((total, row) => total + money(row.amount), 0)),
        available: roundMoney(byStatus('available')),
        used: roundMoney(byStatus('redeemed')),
        pending: roundMoney(byStatus('reserved')),
        expired: roundMoney(byStatus('expired')),
        reversed: roundMoney(byStatus('reversed')),
        successfulReferrals: myReferrals.length,
        pendingReferrals: referralsResult.rows.filter(
          row => row.referrerCustomerId === customerId && ['pending', 'qualified'].includes(row.status)
        ).length,
      },
      eligibleForCode: Boolean(leadResult.rows[0]) && orderResult.rows[0]?.count === 0 && !priorAttributionResult.rows[0],
      credits,
      referrals: referralsResult.rows.map(row => ({
        id: row.id,
        status: row.status,
        attributedAt: row.attributedAt ? new Date(row.attributedAt).toISOString() : null,
        rewardedAt: row.rewardedAt ? new Date(row.rewardedAt).toISOString() : null,
      })),
    };
  }

  static async claimCode(customerId: string, code: string, source: AttributionSource): Promise<any> {
    const normalized = normalizeReferralCode(code);
    if (!normalized) throw badRequest('Enter a valid 6-character referral code');
    if (!['registration', 'account', 'checkout', 'link'].includes(source)) {
      throw badRequest('Invalid referral attribution source');
    }

    return transaction(async (client: DbClient) => {
      const campaign = await this.requireActiveCampaign(client);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`referral-claim:${customerId}`]);

      const codeResult = await client.query(
        `SELECT rc.id AS "codeId", rc.customer_id AS "referrerCustomerId"
           FROM mart_referral_codes rc
          WHERE rc.code = $1 AND rc.is_active = true FOR UPDATE OF rc`,
        [normalized]
      );
      const codeRow = codeResult.rows[0];
      if (!codeRow) throw badRequest('This referral code is not valid');
      if (codeRow.referrerCustomerId === customerId) throw badRequest('You cannot use your own referral code');

      const customerResult = await client.query(
        `SELECT id, phone FROM mart_customers WHERE id = $1 FOR UPDATE`, [customerId]
      );
      const customer = customerResult.rows[0];
      if (!customer) throw notFound('Customer not found');

      const verified = await client.query(
        `SELECT 1 FROM mart_customer_leads WHERE customer_id = $1 AND verified_at IS NOT NULL`, [customerId]
      );
      if (!verified.rows[0]) throw badRequest('Verify your phone number before applying a referral code');

      const priorOrders = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM mart_orders
          WHERE (customer_id = $1 OR guest_phone = $2) AND ${NON_CANCELLED}`,
        [customerId, customer.phone]
      );
      if (priorOrders.rows[0].count > 0) {
        throw badRequest('Referral codes can only be applied before your first order');
      }

      const duplicate = await client.query(`SELECT id FROM mart_referrals WHERE referred_customer_id = $1`, [customerId]);
      if (duplicate.rows[0]) {
        throw conflict('A referral code has already been applied to this account and cannot be changed');
      }

      const inserted = await client.query(
        `INSERT INTO mart_referrals
           (id, code_id, referrer_customer_id, referred_customer_id, campaign_id, status,
            attribution_source, attributed_at, notes)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,NOW(),$7)
         RETURNING id, status, attributed_at AS "attributedAt"`,
        [uuidv4(), codeRow.codeId, codeRow.referrerCustomerId, customerId, campaign.id, source,
          'Pending attribution: rewards unlock on the first qualifying delivered order.']
      );
      await this.audit(client, {
        entityType: 'referral', entityId: inserted.rows[0].id, action: 'attribution_created',
        actorCustomerId: customerId,
        after: { code: normalized, source, campaignId: campaign.id, status: 'pending' },
        reason: `Code claimed via ${source}`,
      });
      return {
        ...inserted.rows[0],
        code: normalized,
        message: 'Referral applied. Rewards unlock after your first qualifying delivered order.',
      };
    });
  }

  // ── Credit lifecycle ────────────────────────────────────────────────────────

  static async reserveCredit(customerId: string, creditId: string, idempotencyKey: string): Promise<any> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') throw badRequest('idempotencyKey is required');
    return transaction(async client => {
      await this.requireActiveCampaign(client);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`referral-credit:${creditId}`]);
      const result = await client.query(
        `SELECT * FROM mart_referral_credits WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
        [creditId, customerId]
      );
      const credit = result.rows[0];
      if (!credit) throw notFound('Referral credit not found');

      const idem = `RESERVE:${customerId}:${idempotencyKey.slice(0, 128)}`;
      const previous = await client.query(
        `SELECT 1 FROM mart_referral_transactions WHERE idempotency_key = $1`, [idem]
      );
      if (previous.rows[0]) {
        return {
          id: credit.id, amount: money(credit.amount), status: credit.status,
          reservationExpiresAt: credit.reservation_expires_at,
          duplicate: true,
        };
      }
      if (credit.status !== 'available') throw badRequest('This referral credit is not available');
      if (isExpired(credit.expires_at)) throw badRequest('This referral credit has expired');

      const expiresAt = reservationExpiry(new Date(), REFERRAL_RESERVATION_TTL_MINUTES);
      const updated = await client.query(
        `UPDATE mart_referral_credits
            SET status = 'reserved', reserved_at = NOW(), reservation_expires_at = $2, updated_at = NOW()
          WHERE id = $1 AND status = 'available'
          RETURNING id, amount::float AS amount, status, reservation_expires_at AS "reservationExpiresAt"`,
        [creditId, expiresAt]
      );
      await this.ledger(client, {
        type: 'reserve', amount: money(credit.amount), customerId, creditId,
        referralId: credit.referral_id, reason: 'Credit reserved at checkout', idempotencyKey: idem,
      });
      await this.audit(client, {
        entityType: 'referral_credit', entityId: creditId, action: 'credit_reserved',
        actorCustomerId: customerId, before: { status: 'available' },
        after: { status: 'reserved', reservationExpiresAt: expiresAt },
      });
      return { ...updated.rows[0], amount: money(updated.rows[0].amount), duplicate: false };
    });
  }

  static async releaseCredit(customerId: string, creditId: string): Promise<any> {
    return transaction(async client => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`referral-credit:${creditId}`]);
      const result = await client.query(
        `SELECT * FROM mart_referral_credits WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
        [creditId, customerId]
      );
      const credit = result.rows[0];
      if (!credit) throw notFound('Referral credit not found');
      if (credit.status !== 'reserved') return { id: creditId, status: credit.status, released: false };
      if (isExpired(credit.expires_at)) {
        await client.query(
          `UPDATE mart_referral_credits SET status = 'expired', reserved_at = NULL,
              reservation_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
          [creditId]
        );
        await this.ledger(client, {
          type: 'expire', amount: money(credit.amount), customerId, creditId,
          referralId: credit.referral_id, reason: 'Credit expired while reserved',
          idempotencyKey: `EXPIRE:${creditId}:${credit.expires_at}`,
        });
        return { id: creditId, status: 'expired', released: false };
      }
      await client.query(
        `UPDATE mart_referral_credits
            SET status = 'available', reserved_at = NULL, reservation_expires_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [creditId]
      );
      await this.ledger(client, {
        type: 'restore', amount: money(credit.amount), customerId, creditId,
        referralId: credit.referral_id, reason: 'Reservation released by customer',
        idempotencyKey: `RELEASE:${creditId}:${credit.reserved_at || uuidv4()}`,
      });
      await this.audit(client, {
        entityType: 'referral_credit', entityId: creditId, action: 'credit_released',
        actorCustomerId: customerId, before: { status: 'reserved' }, after: { status: 'available' },
      });
      return { id: creditId, status: 'available', released: true };
    });
  }

  /** Called inside the order transaction, before the order row is inserted. */
  static async validateCreditForOrder(
    client: DbClient,
    customerId: string,
    creditId: string,
    subtotal: number,
  ): Promise<any> {
    const result = await client.query(
      `SELECT c.*, cam.redemption_min, cam.status AS campaign_status,
              cam.starts_at, cam.ends_at
         FROM mart_referral_credits c
         LEFT JOIN mart_referral_campaigns cam ON cam.id = c.campaign_id
        WHERE c.id = $1 AND c.customer_id = $2 FOR UPDATE OF c`,
      [creditId, customerId]
    );
    const credit = result.rows[0];
    if (!credit) throw forbidden('This referral reward does not belong to you');
    if (credit.status !== 'reserved') throw badRequest('Apply this referral reward before placing the order');
    if (isExpired(credit.reservation_expires_at) || isExpired(credit.expires_at)) {
      throw badRequest('This referral reward reservation has expired. Apply it again.');
    }
    if (credit.campaign_id && (credit.campaign_status !== 'active' ||
      (credit.starts_at && new Date(credit.starts_at) > new Date()) ||
      (credit.ends_at && new Date(credit.ends_at) < new Date()))) {
      throw badRequest('The referral campaign for this reward is no longer active');
    }
    const minimum = money(credit.redemption_min ?? DEFAULT_CAMPAIGN.redemptionMin);
    if (money(subtotal) < minimum) {
      throw badRequest(`Add items worth ₹${minimum} to use your referral reward`);
    }
    return credit;
  }

  /** Called inside the order transaction, after the order row exists. */
  static async consumeCreditForOrder(
    client: DbClient,
    customerId: string,
    creditId: string,
    orderId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT * FROM mart_referral_credits WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [creditId, customerId]
    );
    const credit = result.rows[0];
    if (!credit) throw forbidden('This referral reward does not belong to you');
    if (credit.status === 'redeemed' && credit.order_id === orderId) return money(credit.amount);
    if (credit.status !== 'reserved' || (credit.order_id && credit.order_id !== orderId)) {
      throw badRequest('This referral reward is no longer reserved for this order');
    }
    await client.query(
      `UPDATE mart_referral_credits
          SET status = 'redeemed', order_id = $2, redeemed_at = NOW(),
              reserved_at = NULL, reservation_expires_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'reserved'`,
      [creditId, orderId]
    );
    await this.ledger(client, {
      type: 'redeem', amount: money(credit.amount), customerId, creditId,
      referralId: credit.referral_id, orderId, reason: `Referral reward used on order ${orderId}`,
      idempotencyKey: `REDEEM:${orderId}:${creditId}`,
    });
    await this.audit(client, {
      entityType: 'referral_credit', entityId: creditId, action: 'credit_redeemed',
      actorCustomerId: customerId, before: { status: 'reserved' },
      after: { status: 'redeemed', orderId },
    });
    return money(credit.amount);
  }

  /** Cancellation / failed-delivery compensation. Accepts an existing transaction client. */
  static async releaseCreditForOrder(orderId: string, client?: DbClient): Promise<{ restored: boolean; reversed: boolean }> {
    return this.withClient(client, async db => {
      const orderResult = await db.query(
        `SELECT id, referral_credit_id AS "referralCreditId", status FROM mart_orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );
      const order = orderResult.rows[0];
      if (!order) return { restored: false, reversed: false };

      let restored = false;
      if (order.referralCreditId) {
        const creditResult = await db.query(
          `SELECT * FROM mart_referral_credits WHERE id = $1 FOR UPDATE`, [order.referralCreditId]
        );
        const credit = creditResult.rows[0];
        if (credit && ['reserved', 'redeemed'].includes(credit.status) && !isExpired(credit.expires_at)) {
          await db.query(
            `UPDATE mart_referral_credits
                SET status = 'available', order_id = NULL, redeemed_at = NULL,
                    reserved_at = NULL, reservation_expires_at = NULL, updated_at = NOW()
              WHERE id = $1`,
            [credit.id]
          );
          await this.ledger(db, {
            type: 'restore', amount: money(credit.amount), customerId: credit.customer_id,
            creditId: credit.id, referralId: credit.referral_id, orderId,
            reason: `Order ${orderId} was ${order.status}; referral credit restored`,
            idempotencyKey: `RESTORE-ORDER:${orderId}:${credit.id}`,
          });
          await this.audit(db, {
            entityType: 'referral_credit', entityId: credit.id, action: 'credit_restored',
            after: { status: 'available', orderId: null }, reason: `Order ${order.status}`,
          });
          restored = true;
        }
      }

      const referralResult = await db.query(
        `SELECT id FROM mart_referrals WHERE qualifying_order_id = $1 FOR UPDATE`, [orderId]
      );
      let reversed = false;
      for (const referral of referralResult.rows) {
        const issued = await db.query(
          `SELECT 1 FROM mart_referral_rewards WHERE referral_id = $1 AND status = 'issued'`, [referral.id]
        );
        if (issued.rows[0]) {
          await this.reverseRewards(db, referral.id, `Qualifying order ${orderId} was ${order.status}`);
          reversed = true;
        }
      }
      return { restored, reversed };
    });
  }

  // ── Reward release on delivery ──────────────────────────────────────────────

  static async onOrderDelivered(client: DbClient, orderId: string): Promise<any> {
    const orderResult = await client.query(
      `SELECT id, customer_id AS "customerId", subtotal::float AS subtotal,
              delivery_charge::float AS "deliveryCharge",
              campaign_discount::float AS "campaignDiscount",
              referral_discount::float AS "referralDiscount", status
         FROM mart_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw notFound('Order not found');
    if (!order.customerId) return { issued: false, reason: 'guest_order' };

    const referralResult = await client.query(
      `SELECT * FROM mart_referrals
        WHERE referred_customer_id = $1 AND status IN ('pending', 'qualified')
          AND qualifying_order_id IS NULL
        ORDER BY attributed_at ASC LIMIT 1 FOR UPDATE`,
      [order.customerId]
    );
    const referral = referralResult.rows[0];
    if (!referral) return { issued: false, reason: 'no_pending_referral' };

    const campaignResult = await client.query(
      `SELECT * FROM mart_referral_campaigns WHERE id = $1 FOR UPDATE`, [referral.campaign_id]
    );
    const campaign = campaignResult.rows[0];
    if (!campaign || campaign.unlock_trigger !== 'delivered' || campaign.status !== 'active' ||
      (campaign.starts_at && new Date(campaign.starts_at) > new Date()) ||
      (campaign.ends_at && new Date(campaign.ends_at) < new Date())) {
      await client.query(
        `UPDATE mart_referrals SET notes = $2, updated_at = NOW() WHERE id = $1`,
        [referral.id, 'Rewards skipped: campaign not active at delivery']
      );
      await this.audit(client, {
        entityType: 'referral', entityId: referral.id, action: 'reward_skipped', actorCustomerId: order.customerId,
        reason: 'Campaign not active at delivery',
      });
      return { issued: false, reason: 'campaign_inactive' };
    }

    const priorReward = await client.query(
      `SELECT 1 FROM mart_referrals
        WHERE referred_customer_id = $1 AND id <> $2 AND status = 'rewarded'`,
      [order.customerId, referral.id]
    );
    if (priorReward.rows[0]) return { issued: false, reason: 'already_qualified' };

    const paidItemSubtotal = Math.max(
      0,
      money(order.subtotal) - money(order.campaignDiscount) - money(order.referralDiscount)
    );
    const value = qualifyingOrderValue(paidItemSubtotal, money(order.deliveryCharge), campaign.value_basis);
    const minimum = money(campaign.qualifying_order_min);
    if (value < minimum) {
      await client.query(
        `UPDATE mart_referrals SET notes = $2, updated_at = NOW() WHERE id = $1`,
        [referral.id, `Order value ₹${value} is below the ₹${minimum} qualifying minimum`]
      );
      await this.audit(client, {
        entityType: 'referral', entityId: referral.id, action: 'qualification_below_minimum',
        actorCustomerId: order.customerId, after: { value, minimum },
      });
      return { issued: false, reason: 'below_minimum', value };
    }

    const categoryIds: string[] = Array.isArray(campaign.category_ids) ? campaign.category_ids : [];
    if (categoryIds.length) {
      const categoryMatch = await client.query(
        `SELECT 1
           FROM mart_order_items oi
           JOIN mart_products p ON p.id = oi.product_id
          WHERE oi.order_id = $1 AND p.category_id = ANY($2::uuid[])
          LIMIT 1`,
        [orderId, categoryIds]
      );
      if (!categoryMatch.rows[0]) {
        await client.query(
          `UPDATE mart_referrals SET notes = $2, updated_at = NOW() WHERE id = $1`,
          [referral.id, 'Order had no item in a campaign-eligible category']
        );
        return { issued: false, reason: 'category_not_eligible' };
      }
    }

    const capResult = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM mart_referral_rewards rw
         JOIN mart_referrals r ON r.id = rw.referral_id
        WHERE r.referrer_customer_id = $1 AND rw.role = 'referrer' AND rw.status = 'issued'`,
      [referral.referrer_customer_id]
    );
    if (capReached(capResult.rows[0].count, parseInt(campaign.max_referrals_per_referrer, 10))) {
      await client.query(
        `UPDATE mart_referrals
            SET status = 'capped', notes = $2, updated_at = NOW()
          WHERE id = $1`,
        [referral.id, `Referrer cap of ${campaign.max_referrals_per_referrer} reached; no rewards issued for either party`]
      );
      await this.audit(client, {
        entityType: 'referral', entityId: referral.id, action: 'referral_capped',
        actorCustomerId: order.customerId, reason: 'Referrer cap reached',
        after: { status: 'capped' },
      });
      return { issued: false, reason: 'capped' };
    }

    const unlockedAt = new Date();
    const expiresAt = addDays(unlockedAt, campaign.expiry_days === null ? null : Number(campaign.expiry_days));
    const rewards: Array<{ id: string; customer_id: string; role: string; amount: unknown }> = [];
    for (const role of ['referrer', 'referee'] as const) {
      const customerId = role === 'referrer' ? referral.referrer_customer_id : referral.referred_customer_id;
      const amount = role === 'referrer' ? campaign.referrer_reward : campaign.referee_reward;
      const inserted = await client.query(
        `INSERT INTO mart_referral_rewards
           (id, referral_id, customer_id, role, campaign_id, campaign_version, amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'issued')
         RETURNING id, customer_id, role, amount`,
        [uuidv4(), referral.id, customerId, role, campaign.id, campaign.version, money(amount)]
      );
      rewards.push(inserted.rows[0]);
    }

    const creditsPerReward = Math.max(0, parseInt(campaign.credits_per_reward, 10) || 0);
    const creditAmount = money(campaign.credit_amount);
    for (const reward of rewards) {
      for (let index = 0; index < creditsPerReward; index += 1) {
        const inserted = await client.query(
          `INSERT INTO mart_referral_credits
             (id, reward_id, referral_id, customer_id, campaign_id, campaign_version,
              amount, status, unlocked_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'available',$8,$9)
           RETURNING id`,
          [uuidv4(), reward.id, referral.id, reward.customer_id, campaign.id, campaign.version,
            creditAmount, unlockedAt, expiresAt]
        );
        await this.ledger(client, {
          type: 'issue', amount: creditAmount, customerId: reward.customer_id,
          creditId: inserted.rows[0].id, rewardId: reward.id, referralId: referral.id,
          reason: `Referral ${reward.role} reward unlocked by delivered order ${orderId}`,
          idempotencyKey: `ISSUE:${referral.id}:${reward.id}:${index}`,
        });
      }
    }

    await client.query(
      `UPDATE mart_referrals
          SET status = 'rewarded', qualifying_order_id = $2, qualifying_order_value = $3,
              qualified_at = $4, rewarded_at = $4, notes = NULL, updated_at = NOW()
        WHERE id = $1`,
      [referral.id, orderId, value, unlockedAt]
    );
    await this.audit(client, {
      entityType: 'referral', entityId: referral.id, action: 'rewards_issued',
      actorCustomerId: order.customerId,
      before: { status: referral.status },
      after: {
        status: 'rewarded', qualifyingOrderId: orderId, qualifyingOrderValue: value,
        rewards: rewards.length, credits: rewards.length * creditsPerReward,
      },
      reason: 'First qualifying delivered order',
    });
    return {
      issued: true,
      referralId: referral.id,
      value,
      expiryDays: campaign.expiry_days === null ? null : Number(campaign.expiry_days),
      rewards: rewards.length,
      credits: rewards.length * creditsPerReward,
    };
  }

  // ── Maintenance job ─────────────────────────────────────────────────────────

  static async expireDue(): Promise<{ expired: number; released: number; referrals: number }> {
    return transaction(async client => {
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [REFERRAL_JOB_LOCK_KEY]);
      if (!lock.rows[0]?.locked) return { expired: 0, released: 0, referrals: 0 };

      const stale = await client.query(
        `SELECT * FROM mart_referral_credits
          WHERE status = 'reserved' AND reservation_expires_at < NOW()
            AND (expires_at IS NULL OR expires_at > NOW())
          FOR UPDATE SKIP LOCKED`
      );
      for (const credit of stale.rows) {
        await client.query(
          `UPDATE mart_referral_credits
              SET status = 'available', reserved_at = NULL, reservation_expires_at = NULL, updated_at = NOW()
            WHERE id = $1`,
          [credit.id]
        );
        await this.ledger(client, {
          type: 'restore', amount: money(credit.amount), customerId: credit.customer_id,
          creditId: credit.id, referralId: credit.referral_id,
          reason: 'Stale checkout reservation released',
          idempotencyKey: `RESERVATION-EXPIRE:${credit.id}:${credit.reservation_expires_at}`,
        });
        await this.audit(client, {
          entityType: 'referral_credit', entityId: credit.id, action: 'reservation_expired',
          reason: 'Stale checkout reservation released', after: { status: 'available' },
        });
      }

      const expired = await client.query(
        `SELECT * FROM mart_referral_credits
          WHERE status IN ('available', 'reserved') AND expires_at IS NOT NULL AND expires_at <= NOW()
          FOR UPDATE SKIP LOCKED`
      );
      for (const credit of expired.rows) {
        await client.query(
          `UPDATE mart_referral_credits SET status = 'expired', reserved_at = NULL,
              reservation_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
          [credit.id]
        );
        await this.ledger(client, {
          type: 'expire', amount: money(credit.amount), customerId: credit.customer_id,
          creditId: credit.id, referralId: credit.referral_id, reason: 'Referral credit expired',
          idempotencyKey: `CREDIT-EXPIRE:${credit.id}:${credit.expires_at}`,
        });
        await this.audit(client, {
          entityType: 'referral_credit', entityId: credit.id, action: 'credit_expired',
          after: { status: 'expired' },
        });
      }

      const referrals = await client.query(
        `SELECT r.id
           FROM mart_referrals r
           JOIN mart_referral_campaigns c ON c.id = r.campaign_id
          WHERE r.status IN ('pending', 'qualified')
            AND c.expiry_days IS NOT NULL
            AND r.attributed_at + (c.expiry_days || ' days')::interval <= NOW()
          FOR UPDATE OF r SKIP LOCKED`
      );
      for (const referral of referrals.rows) {
        await client.query(
          `UPDATE mart_referrals SET status = 'expired',
              notes = COALESCE(notes, 'Referral attribution expired'), updated_at = NOW()
            WHERE id = $1`,
          [referral.id]
        );
        await this.audit(client, {
          entityType: 'referral', entityId: referral.id, action: 'referral_expired',
          after: { status: 'expired' }, reason: 'Campaign attribution window elapsed',
        });
      }
      return { expired: expired.rows.length, released: stale.rows.length, referrals: referrals.rows.length };
    });
  }

  // ── Admin: campaigns ────────────────────────────────────────────────────────

  static async getCampaigns(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) { conditions.push(`status = $${i++}`); params.push(String(filters.status)); }
    if (filters.query) {
      conditions.push(`name ILIKE $${i++}`);
      params.push(`%${String(filters.query)}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM mart_referral_campaigns ${where}`, params);
    params.push(limit, offset);
    const items = await query(
      `SELECT c.*, a.name AS "createdByName" FROM mart_referral_campaigns c
         LEFT JOIN mart_admins a ON a.id = c.created_by
         ${where} ORDER BY c.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  static async createCampaign(data: any, adminId: string): Promise<any> {
    const values: Record<string, unknown> = {};
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (!name) throw badRequest('Campaign name is required');
    values.name = name;
    values.status = ['draft', 'active', 'paused', 'ended'].includes(data.status) ? data.status : 'draft';

    for (const [key, column] of Object.entries(campaignFields)) {
      if (key === 'name' || data[key] === undefined) continue;
      if (key === 'categoryIds') {
        if (!Array.isArray(data[key])) throw badRequest('categoryIds must be an array');
        values[column] = data[key].map((id: unknown) => String(id));
        continue;
      }
      if (['stackingEnabled', 'cashWithdrawal', 'transferEnabled', 'fraudReviewEnabled'].includes(key)) {
        values[column] = toBoolean(data[key]);
        continue;
      }
      if (['expiryDays', 'startsAt', 'endsAt', 'budget', 'reason'].includes(key) && (data[key] === null || data[key] === '')) {
        values[column] = null;
        continue;
      }
      const integer = ['creditsPerReward', 'maxReferralsPerReferrer', 'expiryDays', 'codeLength'].includes(key);
      values[column] = finiteNumber(data[key], key, { integer });
    }
    if (values.value_basis && !['item_subtotal', 'grand_total'].includes(String(values.value_basis))) {
      throw badRequest('Invalid value basis');
    }
    if (values.code_length !== undefined && (Number(values.code_length) < 4 || Number(values.code_length) > 12)) {
      throw badRequest('codeLength must be between 4 and 12');
    }

    const columns = [...Object.keys(values), 'created_by'];
    const placeholders = columns.map((_column, index) => `$${index + 1}`);
    const params = [...Object.values(values), adminId];
    return transaction(async client => {
      const inserted = await client.query(
        `INSERT INTO mart_referral_campaigns (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        params
      );
      await this.audit(client, {
        entityType: 'referral_campaign', entityId: inserted.rows[0].id,
        action: 'campaign_created', actorAdminId: adminId, after: inserted.rows[0],
      });
      return inserted.rows[0];
    });
  }

  static async updateCampaign(id: string, data: any, adminId: string): Promise<any> {
    return transaction(async client => {
      const before = await client.query(`SELECT * FROM mart_referral_campaigns WHERE id = $1 FOR UPDATE`, [id]);
      if (!before.rows[0]) throw notFound('Referral campaign not found');
      const assignments: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, column] of Object.entries(campaignFields)) {
        if (data[key] === undefined) continue;
        let value: unknown = data[key];
        if (key === 'categoryIds') {
          if (!Array.isArray(value)) throw badRequest('categoryIds must be an array');
          value = value.map((entry: unknown) => String(entry));
        } else if (['stackingEnabled', 'cashWithdrawal', 'transferEnabled', 'fraudReviewEnabled'].includes(key)) {
          value = toBoolean(value);
        } else if (value !== null && value !== '') {
          value = finiteNumber(value, key, { integer: ['creditsPerReward', 'maxReferralsPerReferrer', 'expiryDays', 'codeLength'].includes(key) });
        } else if (['expiryDays', 'startsAt', 'endsAt', 'budget', 'reason'].includes(key)) {
          value = null;
        }
        assignments.push(`${column} = $${i++}`);
        params.push(value);
      }
      if (!assignments.length) throw badRequest('No campaign changes supplied');
      assignments.push(`version = version + 1`, `updated_at = NOW()`);
      params.push(id);
      const updated = await client.query(
        `UPDATE mart_referral_campaigns SET ${assignments.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      await this.audit(client, {
        entityType: 'referral_campaign', entityId: id, action: 'campaign_updated',
        actorAdminId: adminId, before: before.rows[0], after: updated.rows[0],
        reason: typeof data.reason === 'string' ? data.reason : null,
      });
      return updated.rows[0];
    });
  }

  static async setCampaignStatus(id: string, action: CampaignAction, adminId: string): Promise<any> {
    if (!['activate', 'pause'].includes(action)) throw badRequest('Action must be activate or pause');
    return transaction(async client => {
      const before = await client.query(`SELECT * FROM mart_referral_campaigns WHERE id = $1 FOR UPDATE`, [id]);
      if (!before.rows[0]) throw notFound('Referral campaign not found');
      const status = action === 'activate' ? 'active' : 'paused';
      const updated = await client.query(
        `UPDATE mart_referral_campaigns SET status = $2, version = version + 1, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, status]
      );
      await this.audit(client, {
        entityType: 'referral_campaign', entityId: id, action: `campaign_${action}`,
        actorAdminId: adminId, before: { status: before.rows[0].status },
        after: { status, version: updated.rows[0].version },
      });
      return updated.rows[0];
    });
  }

  static async getCampaignHistory(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const params: unknown[] = [];
    let where = `entity_type = 'referral_campaign'`;
    if (filters.campaignId) { where += ` AND entity_id = $${params.length + 1}`; params.push(String(filters.campaignId)); }
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM mart_referral_audit_logs WHERE ${where}`, params
    );
    params.push(limit, offset);
    const items = await query(
      `SELECT id, entity_id AS "entityId", action, before, after, reason, created_at AS "createdAt"
         FROM mart_referral_audit_logs WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  // ── Admin: records, rewards, ledger, fraud, reporting ───────────────────────

  static async getRecords(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) { conditions.push(`r.status = $${i++}`); params.push(String(filters.status)); }
    if (filters.customerId) { conditions.push(`r.referred_customer_id = $${i++}`); params.push(String(filters.customerId)); }
    if (filters.referrerId) { conditions.push(`r.referrer_customer_id = $${i++}`); params.push(String(filters.referrerId)); }
    if (filters.query) {
      conditions.push(`(rc.code ILIKE $${i++} OR c.phone ILIKE $${i++} OR referrer.phone ILIKE $${i++})`);
      const term = `%${String(filters.query)}%`;
      params.push(term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM mart_referrals r
         LEFT JOIN mart_referral_codes rc ON rc.id = r.code_id
         LEFT JOIN mart_customers c ON c.id = r.referred_customer_id
         LEFT JOIN mart_customers referrer ON referrer.id = r.referrer_customer_id ${where}`,
      params
    );
    params.push(limit, offset);
    const items = await query(
      `SELECT r.id, r.status, r.attribution_source AS "attributionSource",
              r.attributed_at AS "attributedAt", r.qualified_at AS "qualifiedAt",
              r.rewarded_at AS "rewardedAt", r.qualifying_order_value::float AS "qualifyingOrderValue",
              r.qualifying_order_id AS "qualifyingOrderId", r.notes,
              rc.code, c.phone AS "referredPhone", referrer.phone AS "referrerPhone",
              cam.name AS "campaignName", cam.version AS "campaignVersion"
         FROM mart_referrals r
         LEFT JOIN mart_referral_codes rc ON rc.id = r.code_id
         LEFT JOIN mart_customers c ON c.id = r.referred_customer_id
         LEFT JOIN mart_customers referrer ON referrer.id = r.referrer_customer_id
         LEFT JOIN mart_referral_campaigns cam ON cam.id = r.campaign_id
         ${where} ORDER BY r.attributed_at DESC LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  static async getRecord(id: string): Promise<any> {
    const result = await query(
      `SELECT r.*, rc.code, cam.name AS "campaignName", cam.version AS "campaignVersion"
         FROM mart_referrals r
         LEFT JOIN mart_referral_codes rc ON rc.id = r.code_id
         LEFT JOIN mart_referral_campaigns cam ON cam.id = r.campaign_id
        WHERE r.id = $1`,
      [id]
    );
    if (!result.rows[0]) throw notFound('Referral record not found');
    const [rewards, credits, ledger] = await Promise.all([
      query(`SELECT id, role, amount::float AS amount, status FROM mart_referral_rewards WHERE referral_id = $1`, [id]),
      query(`SELECT id, amount::float AS amount, status, order_id AS "orderId" FROM mart_referral_credits WHERE referral_id = $1`, [id]),
      query(`SELECT id, reference, type, amount::float AS amount, reason, created_at AS "createdAt" FROM mart_referral_transactions WHERE referral_id = $1 ORDER BY created_at DESC`, [id]),
    ]);
    return {
      ...result.rows[0],
      rewards: rewards.rows,
      credits: credits.rows,
      ledger: ledger.rows,
    };
  }

  static async getCustomerRewards(customerId: string): Promise<any> {
    const [rewards, credits, ledger] = await Promise.all([
      query(`SELECT id, referral_id AS "referralId", role, amount::float AS amount, status, created_at AS "createdAt" FROM mart_referral_rewards WHERE customer_id = $1 ORDER BY created_at DESC`, [customerId]),
      query(`SELECT id, referral_id AS "referralId", amount::float AS amount, status, unlocked_at AS "unlockedAt", expires_at AS "expiresAt", order_id AS "orderId" FROM mart_referral_credits WHERE customer_id = $1 ORDER BY created_at DESC`, [customerId]),
      query(`SELECT id, reference, type, amount::float AS amount, balance_after::float AS "balanceAfter", reason, created_at AS "createdAt" FROM mart_referral_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [customerId]),
    ]);
    return { items: [...rewards.rows, ...credits.rows], rewards: rewards.rows, credits: credits.rows, ledger: ledger.rows };
  }

  static async getLedger(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.customerId) { conditions.push(`customer_id = $${i++}`); params.push(String(filters.customerId)); }
    if (filters.type) { conditions.push(`type = $${i++}`); params.push(String(filters.type)); }
    if (filters.orderId) { conditions.push(`order_id = $${i++}`); params.push(String(filters.orderId)); }
    if (filters.query) {
      conditions.push(`(reference ILIKE $${i++} OR reason ILIKE $${i++})`);
      const term = `%${String(filters.query)}%`;
      params.push(term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM mart_referral_transactions ${where}`, params);
    params.push(limit, offset);
    const items = await query(
      `SELECT id, reference, type, amount::float AS amount, balance_after::float AS "balanceAfter",
              customer_id AS "customerId", credit_id AS "creditId", reward_id AS "rewardId",
              referral_id AS "referralId", order_id AS "orderId", reason,
              actor_admin_id AS "actorAdminId", created_at AS "createdAt"
         FROM mart_referral_transactions ${where}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  static async getFraudQueue(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const params: unknown[] = [];
    const where = `c.fraud_review_enabled = true`;
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM mart_referrals r
         JOIN mart_referral_campaigns c ON c.id = r.campaign_id WHERE ${where}`, params
    );
    params.push(limit, offset);
    const items = await query(
      `SELECT r.id, r.status, r.notes, r.attributed_at AS "attributedAt",
              r.rewarded_at AS "rewardedAt", rc.code,
              referred.phone AS "referredPhone", referrer.phone AS "referrerPhone"
         FROM mart_referrals r
         JOIN mart_referral_campaigns c ON c.id = r.campaign_id
         LEFT JOIN mart_referral_codes rc ON rc.id = r.code_id
         LEFT JOIN mart_customers referred ON referred.id = r.referred_customer_id
         LEFT JOIN mart_customers referrer ON referrer.id = r.referrer_customer_id
        WHERE ${where} ORDER BY r.attributed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  static async reviewFraud(id: string, status: string, notes: string | null, adminId: string): Promise<any> {
    if (!['pending', 'qualified', 'rejected', 'capped', 'expired'].includes(status)) {
      throw badRequest('Invalid fraud review status');
    }
    return transaction(async client => {
      const before = await client.query(`SELECT * FROM mart_referrals WHERE id = $1 FOR UPDATE`, [id]);
      if (!before.rows[0]) throw notFound('Referral record not found');
      if (status === 'rejected' && before.rows[0].status === 'rewarded') {
        await this.reverseRewards(client, id, notes || 'Rejected by fraud review', adminId);
      }
      const updated = await client.query(
        `UPDATE mart_referrals
            SET status = $2, notes = $3, rejected_at = CASE WHEN $2 = 'rejected' THEN NOW() ELSE rejected_at END,
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, status, notes || null]
      );
      await this.audit(client, {
        entityType: 'referral', entityId: id, action: 'fraud_reviewed', actorAdminId: adminId,
        before: { status: before.rows[0].status }, after: { status, notes }, reason: notes || null,
      });
      return updated.rows[0];
    });
  }

  static async getSummary(): Promise<any> {
    const result = await query(
      `SELECT COUNT(*)::int AS referrals,
              COUNT(*) FILTER (WHERE status = 'rewarded')::int AS rewarded,
              COUNT(*) FILTER (WHERE status = 'pending' OR status = 'qualified')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'capped')::int AS capped,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
              COALESCE(SUM(qualifying_order_value) FILTER (WHERE status = 'rewarded'), 0)::float AS qualifying_value
         FROM mart_referrals`
    );
    const moneyResult = await query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'issued'), 0)::float AS rewards_issued,
              COALESCE(SUM(amount) FILTER (WHERE status = 'available' OR status = 'reserved'), 0)::float AS liability,
              COALESCE(SUM(amount) FILTER (WHERE status = 'redeemed'), 0)::float AS redeemed,
              COUNT(*)::int AS credits
         FROM mart_referral_credits`
    );
    return {
      referrals: result.rows[0].referrals,
      rewarded: result.rows[0].rewarded,
      pending: result.rows[0].pending,
      capped: result.rows[0].capped,
      rejected: result.rows[0].rejected,
      expired: result.rows[0].expired,
      qualifyingValue: money(result.rows[0].qualifying_value),
      rewardsIssued: money(moneyResult.rows[0].rewards_issued),
      liability: money(moneyResult.rows[0].liability),
      redeemed: money(moneyResult.rows[0].redeemed),
      credits: moneyResult.rows[0].credits,
    };
  }

  static async getReport(type: ReportType): Promise<{ items: any[]; total: number }> {
    let sql: string;
    switch (type) {
      case 'conversion':
        sql = `SELECT status, COUNT(*)::int AS count,
                      COUNT(*) FILTER (WHERE qualifying_order_id IS NOT NULL)::int AS delivered
                 FROM mart_referrals GROUP BY status ORDER BY status`;
        break;
      case 'orders':
        sql = `SELECT DATE_TRUNC('day', r.qualified_at) AS day,
                      COUNT(*)::int AS orders,
                      COALESCE(SUM(r.qualifying_order_value), 0)::float AS value
                 FROM mart_referrals r WHERE r.qualified_at IS NOT NULL
                GROUP BY day ORDER BY day DESC LIMIT 500`;
        break;
      case 'customers':
        sql = `SELECT referrer_customer_id AS "customerId", COUNT(*)::int AS referrals,
                      COUNT(*) FILTER (WHERE status = 'rewarded')::int AS rewarded
                 FROM mart_referrals GROUP BY referrer_customer_id
                ORDER BY referrals DESC LIMIT 500`;
        break;
      case 'liability':
        sql = `SELECT customer_id AS "customerId", status, COUNT(*)::int AS credits,
                      COALESCE(SUM(amount), 0)::float AS amount
                 FROM mart_referral_credits
                GROUP BY customer_id, status ORDER BY amount DESC LIMIT 500`;
        break;
      default:
        throw badRequest('Unknown referral report type');
    }
    const result = await query(sql);
    return { items: result.rows, total: result.rows.length };
  }

  static async adjust(customerId: string, amount: number, reason: string, adminId: string): Promise<any> {
    const adjustment = finiteNumber(amount, 'amount');
    if (!adjustment || !Number.isFinite(adjustment)) throw badRequest('Adjustment amount must be non-zero');
    if (!reason || !String(reason).trim()) throw badRequest('A reason is required');
    return transaction(async client => {
      const customer = await client.query(`SELECT id FROM mart_customers WHERE id = $1`, [customerId]);
      if (!customer.rows[0]) throw notFound('Customer not found');
      const balance = await this.balanceAfter(client, customerId, money(adjustment));
      await this.ledger(client, {
        type: 'admin_adjust', amount: money(adjustment), customerId, actorAdminId: adminId,
        reason: String(reason).trim().slice(0, 500), balanceAfter: balance,
        idempotencyKey: `ADJUST:${uuidv4()}`,
      });
      await this.audit(client, {
        entityType: 'referral_adjustment', entityId: customerId, action: 'manual_adjustment',
        actorAdminId: adminId, after: { amount: money(adjustment), balanceAfter: balance },
        reason: String(reason).trim().slice(0, 500),
      });
      return { customerId, amount: money(adjustment), balanceAfter: balance };
    });
  }

  static async getAudit(filters: Record<string, unknown> = {}): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.entityType) { conditions.push(`entity_type = $${i++}`); params.push(String(filters.entityType)); }
    if (filters.entityId) { conditions.push(`entity_id = $${i++}`); params.push(String(filters.entityId)); }
    if (filters.action) { conditions.push(`action = $${i++}`); params.push(String(filters.action)); }
    if (filters.customerId) { conditions.push(`actor_customer_id = $${i++}`); params.push(String(filters.customerId)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { limit, offset } = pagination(filters);
    const total = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM mart_referral_audit_logs ${where}`, params
    );
    params.push(limit, offset);
    const items = await query(
      `SELECT id, entity_type AS "entityType", entity_id AS "entityId", action,
              actor_admin_id AS "actorAdminId", actor_customer_id AS "actorCustomerId",
              before, after, reason, created_at AS "createdAt"
         FROM mart_referral_audit_logs ${where}
        ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      params
    );
    return { items: items.rows, total: total.rows[0]?.count || 0 };
  }

  static async exportCsv(type: ExportType): Promise<string> {
    if (!['records', 'ledger'].includes(type)) throw badRequest('Invalid export type');
    if (type === 'records') {
      const result = await query(
        `SELECT r.id, rc.code, r.status, r.attribution_source, r.attributed_at, r.qualified_at,
                r.rewarded_at, r.qualifying_order_value, referred.phone AS referred_phone,
                referrer.phone AS referrer_phone
           FROM mart_referrals r
           LEFT JOIN mart_referral_codes rc ON rc.id = r.code_id
           LEFT JOIN mart_customers referred ON referred.id = r.referred_customer_id
           LEFT JOIN mart_customers referrer ON referrer.id = r.referrer_customer_id
          ORDER BY r.attributed_at DESC`
      );
      const header = ['id', 'code', 'status', 'attributionSource', 'attributedAt', 'qualifiedAt',
        'rewardedAt', 'qualifyingOrderValue', 'referredPhone', 'referrerPhone'];
      return [header.join(','), ...result.rows.map(row => header.map(key => csvCell(row[key])).join(','))].join('\n');
    }
    const result = await query(
      `SELECT id, reference, type, amount, balance_after, customer_id, credit_id, reward_id,
              referral_id, order_id, reason, created_at
         FROM mart_referral_transactions ORDER BY created_at DESC`
    );
    const header = ['id', 'reference', 'type', 'amount', 'balanceAfter', 'customerId', 'creditId',
      'rewardId', 'referralId', 'orderId', 'reason', 'createdAt'];
    return [header.join(','), ...result.rows.map(row => header.map(key => csvCell(row[key === 'balanceAfter' ? 'balance_after' : key])).join(','))].join('\n');
  }
}
