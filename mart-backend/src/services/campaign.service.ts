import { query } from '../database/db';
import { badRequest, forbidden, notFound, conflict } from '../utils/apiError';

// How long a raised minimum order keeps the previous threshold valid. Long
// enough to cover a cart already in progress, short enough that the offer
// cannot be re-run at the old threshold.
const MIN_ORDER_GRACE_HOURS = 6;

const normalizedCouponCode = (value: unknown) => value ? String(value).trim().toUpperCase() : null;

const normalizedCouponCodeOrThrow = (value: unknown) => {
  const code = normalizedCouponCode(value);
  if (!code) throw new Error('A new coupon code is required to supersede this campaign');
  return code;
};

export class CampaignService {

  // ── Admin CRUD ────────────────────────────────────────────────────────────────

  static async findAll(storeId?: string, superAdmin = false): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (!superAdmin && storeId) {
      conditions.push(`(c.store_id = $${i++} OR c.store_id IS NULL)`);
      params.push(storeId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const targetCustomerIds = superAdmin
      ? `COALESCE((SELECT json_agg(ct.customer_id) FROM mart_campaign_targets ct WHERE ct.campaign_id = c.id), '[]'::json)`
      : `'[]'::json`;
    const result = await query(
      `SELECT c.*,
              a.name as "createdByName",
              s.name as "storeName",
              ${targetCustomerIds} as "targetCustomerIds",
              (SELECT COUNT(*) FROM mart_campaign_uses cu WHERE cu.campaign_id = c.id AND cu.reversed_at IS NULL)::int as "useCount",
              (SELECT COALESCE(SUM(cu.discount_applied),0) FROM mart_campaign_uses cu WHERE cu.campaign_id = c.id AND cu.reversed_at IS NULL)::float as "totalDiscount"
       FROM mart_campaigns c
       LEFT JOIN mart_admins a ON a.id = c.created_by
       LEFT JOIN mart_stores s ON s.id = c.store_id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    return result.rows;
  }

  static async create(data: any, adminId: string): Promise<any> {
    if (data.eligibilityType === 'inactive_customers' && (!Number.isInteger(Number(data.inactiveDays)) || Number(data.inactiveDays) < 1)) {
      throw new Error('Inactive customer campaigns require a positive inactivity period');
    }
    if (data.eligibilityType === 'targeted_customers' && (!Array.isArray(data.targetCustomerIds) || data.targetCustomerIds.length === 0)) {
      throw new Error('Select at least one target customer');
    }
    const result = await query(
      `INSERT INTO mart_campaigns (
        title, subtitle, description, badge_text,
        discount_type, discount_value, max_discount, min_order_amount,
        coupon_code, new_customers_only, per_customer_limit, usage_limit,
        store_id, show_in_carousel, carousel_image_url, carousel_gradient, carousel_sort_order,
        status, valid_from, valid_until, eligibility_type, inactive_days, priority, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      [
        data.title, data.subtitle || null, data.description || null, data.badgeText || null,
        data.discountType || 'flat', data.discountValue || 0, data.maxDiscount || null, data.minOrderAmount || 0,
        data.couponCode?.trim().toUpperCase() || null, data.eligibilityType === 'first_order',
        data.perCustomerLimit || 1, data.usageLimit || null,
        data.storeId || null, data.showInCarousel || false,
        data.carouselImageUrl || null, data.carouselGradient || 'from-emerald-500 via-teal-500 to-cyan-500',
        data.carouselSortOrder || 0,
        data.status || 'draft',
        data.validFrom || null, data.validUntil || null,
        data.eligibilityType || 'all', data.eligibilityType === 'inactive_customers' ? Number(data.inactiveDays) : null,
        Number(data.priority) || 0, adminId,
      ]
    );
    const campaign = result.rows[0];
    if (campaign.eligibility_type === 'targeted_customers' && Array.isArray(data.targetCustomerIds)) {
      for (const customerId of [...new Set(data.targetCustomerIds)]) {
        await query(
          `INSERT INTO mart_campaign_targets (campaign_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [campaign.id, customerId]
        );
      }
    }
    // Auto-sync to carousel slides if show_in_carousel is true
    if (data.showInCarousel) {
      await query(
        `INSERT INTO mart_carousel_slides (title, subtitle, image_url, gradient, campaign_id, sort_order, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)
         ON CONFLICT (campaign_id) DO UPDATE SET
           title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
           image_url = EXCLUDED.image_url, gradient = EXCLUDED.gradient, is_active = true`,
        [data.title, data.subtitle || null, data.carouselImageUrl || null,
         data.carouselGradient || 'from-emerald-500 via-teal-500 to-cyan-500',
         campaign.id, data.carouselSortOrder || 0, adminId]
      ).catch(() => {});
    }
    return campaign;
  }

  static async update(id: string, data: any): Promise<any> {
    const existingResult = await query(`SELECT * FROM mart_campaigns WHERE id = $1`, [id]);
    const existing = existingResult.rows[0];
    if (!existing) return null;

    // A coupon code is the one field that is already published to customers
    // (live carousel, banners, shared links), so it is never mutated in place.
    // Supersede it instead: mint a new version and expire this one.
    if (data.couponCode !== undefined && normalizedCouponCode(data.couponCode) !== normalizedCouponCode(existing.coupon_code)) {
      throw new Error(
        'The coupon code cannot be changed once the campaign is live because customers already hold it. ' +
        'Supersede the campaign to issue a new code.'
      );
    }

    // Commercial terms are editable while the campaign runs. Each redemption
    // snapshots the terms it was granted (mart_campaign_uses.terms_snapshot),
    // so history stays exact; these changes are recorded in
    // mart_campaign_changes so a mid-flight edit is still auditable.
    const termColumns: Record<string, string> = {
      discountType: 'discount_type', discountValue: 'discount_value',
      maxDiscount: 'max_discount', minOrderAmount: 'min_order_amount',
      perCustomerLimit: 'per_customer_limit', usageLimit: 'usage_limit',
      storeId: 'store_id', eligibilityType: 'eligibility_type',
      inactiveDays: 'inactive_days', newCustomersOnly: 'new_customers_only',
    };
    const changedTerms: { field: string; from: unknown; to: unknown }[] = [];
    const NUMERIC_TERM_COLUMNS = ['discount_value', 'max_discount', 'min_order_amount', 'per_customer_limit', 'usage_limit', 'inactive_days'];
    for (const [key, column] of Object.entries(termColumns)) {
      if (data[key] === undefined) continue;
      const before = (existing as any)[column];
      const after = data[key];
      const isNumberColumn = NUMERIC_TERM_COLUMNS.includes(column);
      const same = isNumberColumn ? Number(before) === Number(after) : before === after;
      if (same) continue;
      // NUMERIC columns come back from pg as strings ("500.00") while the
      // request carries JS numbers (800). Normalise both sides so the audit
      // trail reads "500 → 800" rather than "500.00 → 800".
      changedTerms.push({
        field: column,
        from: isNumberColumn ? (before === null || before === undefined ? null : Number(before)) : before,
        to: isNumberColumn ? (after === null || after === undefined || after === '' ? null : Number(after)) : after,
      });
    }

    let targetCustomersChanged = false;
    if (Array.isArray(data.targetCustomerIds)) {
      const targetResult = await query<{ customer_id: string }>(
        `SELECT customer_id FROM mart_campaign_targets WHERE campaign_id = $1 ORDER BY customer_id`, [id]
      );
      const existingTargets = targetResult.rows.map(target => target.customer_id);
      const submittedTargets = [...new Set(data.targetCustomerIds)].sort();
      targetCustomersChanged = existingTargets.length !== submittedTargets.length ||
        existingTargets.some((customerId, index) => customerId !== submittedTargets[index]);
    }
    if (data.eligibilityType === 'inactive_customers' && (!Number.isInteger(Number(data.inactiveDays)) || Number(data.inactiveDays) < 1)) {
      throw new Error('Inactive customer campaigns require a positive inactivity period');
    }
    if (data.eligibilityType === 'targeted_customers' && (!Array.isArray(data.targetCustomerIds) || data.targetCustomerIds.length === 0)) {
      throw new Error('Select at least one target customer');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const map: Record<string, string> = {
      title: 'title', subtitle: 'subtitle', description: 'description',
      badgeText: 'badge_text', discountType: 'discount_type', discountValue: 'discount_value',
      maxDiscount: 'max_discount', minOrderAmount: 'min_order_amount',
      couponCode: 'coupon_code', newCustomersOnly: 'new_customers_only',
      perCustomerLimit: 'per_customer_limit', usageLimit: 'usage_limit',
      storeId: 'store_id', showInCarousel: 'show_in_carousel',
      carouselImageUrl: 'carousel_image_url', carouselGradient: 'carousel_gradient',
      carouselSortOrder: 'carousel_sort_order', status: 'status',
      validFrom: 'valid_from', validUntil: 'valid_until',
      eligibilityType: 'eligibility_type', inactiveDays: 'inactive_days', priority: 'priority',
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        const val = key === 'couponCode' ? (data[key]?.toUpperCase() || null) : data[key];
        fields.push(`${col} = $${i++}`);
        params.push(val);
      }
    }
    if (data.eligibilityType !== undefined && data.eligibilityType !== 'inactive_customers' && data.inactiveDays === undefined) {
      fields.push(`inactive_days = $${i++}`);
      params.push(null);
    }
    // Raising the minimum order opens a grace window on the previous threshold
    // so a customer already part-way to the discount is not stranded. The
    // window is deliberately short: it covers carts in progress, not a re-run
    // of the old offer. Lowering it needs no grace.
    const minOrderRaise = changedTerms.find(t => t.field === 'min_order_amount' && Number(t.to) > Number(t.from));
    if (minOrderRaise) {
      fields.push(`min_order_previous = $${i++}`);
      params.push(Number(minOrderRaise.from) || 0);
      fields.push(`min_order_grace_until = $${i++}`);
      params.push(new Date(Date.now() + MIN_ORDER_GRACE_HOURS * 60 * 60 * 1000));
    }
    if (!fields.length) throw new Error('Nothing to update');
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await query(
      `UPDATE mart_campaigns SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    const campaign = result.rows[0];
    if (campaign && Array.isArray(data.targetCustomerIds)) {
      await query(`DELETE FROM mart_campaign_targets WHERE campaign_id = $1`, [id]);
      if (campaign.eligibility_type === 'targeted_customers') {
        for (const customerId of [...new Set(data.targetCustomerIds)]) {
          await query(
            `INSERT INTO mart_campaign_targets (campaign_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, customerId]
          );
        }
      }
    }
    // Record the edit. Written for every term change, so the history of a live
    // campaign is reconstructible even though the row itself stays mutable.
    if (changedTerms.length || targetCustomersChanged) {
      const entries = [...changedTerms.map(t => ({ field: t.field, from: t.from, to: t.to }))];
      if (targetCustomersChanged) {
        entries.push({ field: 'target_audience', from: '(previous targets)', to: `${data.targetCustomerIds!.length} customer(s)` });
      }
      for (const entry of entries) {
        await query(
          `INSERT INTO mart_campaign_changes (campaign_id, field, old_value, new_value, reason, changed_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, entry.field,
           entry.from === null || entry.from === undefined ? null : String(entry.from),
           entry.to === null || entry.to === undefined ? null : String(entry.to),
           typeof data.changeReason === 'string' && data.changeReason.trim() ? data.changeReason.trim() : null,
           data.adminId || null]
        ).catch((auditErr: any) => {
          // The campaign row is already committed at this point. Throwing here
          // would report a failure for a change that did apply, so the audit
          // write is made non-fatal and logged loudly instead. A missing audit
          // row is recoverable; a false "save failed" is not.
          console.error(`[campaign] audit write failed for campaign ${id} field ${entry.field}`, auditErr);
        });
      }
    }
    // Sync carousel slide if show_in_carousel changed
    if (campaign) {
      if (campaign.show_in_carousel) {
        await query(
          `INSERT INTO mart_carousel_slides (title, subtitle, image_url, gradient, campaign_id, sort_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,true)
           ON CONFLICT (campaign_id) DO UPDATE SET
             title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
             image_url = EXCLUDED.image_url, gradient = EXCLUDED.gradient,
             is_active = ($7 = 'active')`,
          [campaign.title, campaign.subtitle || null, campaign.carousel_image_url || null,
           campaign.carousel_gradient, campaign.id, campaign.carousel_sort_order || 0, campaign.status]
        ).catch(() => {});
      } else {
        // Hide from carousel if show_in_carousel turned off
        await query(`UPDATE mart_carousel_slides SET is_active = false WHERE campaign_id = $1`, [campaign.id]).catch(() => {});
      }
    }
    return campaign;
  }

  static async delete(id: string): Promise<void> {
    const uses = await query(`SELECT COUNT(*) as cnt FROM mart_campaign_uses WHERE campaign_id = $1`, [id]);
    if (parseInt(uses.rows[0].cnt) > 0) throw new Error('Cannot delete — campaign has been used');
    await query(`DELETE FROM mart_campaigns WHERE id = $1`, [id]);
  }

  // ── Redemptions ──────────────────────────────────────────────────────────────
  // Reads the append-only ledger: who used the campaign, on which order, when,
  // and under exactly which terms. This is the audit view the old immutability
  // check was trying to protect.
  static async getRedemptions(campaignId: string): Promise<{ stats: any; redemptions: any[]; changes: any[] }> {
    const summary = await query(
      `SELECT
         COUNT(*) FILTER (WHERE cu.reversed_at IS NULL)::int                       AS total_uses,
         COUNT(*) FILTER (WHERE cu.reversed_at IS NOT NULL)::int                   AS reversed_uses,
         COUNT(DISTINCT cu.customer_id) FILTER (WHERE cu.reversed_at IS NULL)::int AS unique_customers,
         COALESCE(SUM(cu.discount_applied) FILTER (WHERE cu.reversed_at IS NULL), 0)::float AS total_discount,
         MAX(cu.used_at)                                                          AS last_used_at
       FROM mart_campaign_uses cu
       WHERE cu.campaign_id = $1`,
      [campaignId]
    );

    const rows = await query(
      `SELECT cu.id, cu.order_id, cu.customer_id, cu.discount_applied, cu.coupon_code_used,
              cu.terms_snapshot, cu.used_at, cu.reversed_at, cu.reversal_reason,
              o.total AS order_total, o.status AS order_status, o.guest_phone AS order_phone,
              c.name AS customer_name, c.phone AS customer_phone
       FROM mart_campaign_uses cu
       LEFT JOIN mart_orders o ON o.id = cu.order_id
       LEFT JOIN mart_customers c ON c.id = cu.customer_id
       WHERE cu.campaign_id = $1
       ORDER BY cu.used_at DESC
       LIMIT 200`,
      [campaignId]
    );

    const changes = await query(
      `SELECT ch.field, ch.old_value, ch.new_value, ch.reason, ch.created_at, a.name AS changed_by_name
       FROM mart_campaign_changes ch
       LEFT JOIN mart_admins a ON a.id = ch.changed_by
       WHERE ch.campaign_id = $1
       ORDER BY ch.created_at DESC
       LIMIT 100`,
      [campaignId]
    );

    return { stats: summary.rows[0], redemptions: rows.rows, changes: changes.rows };
  }

  // ── Supersede ────────────────────────────────────────────────────────────────
  // A published coupon code is never edited. This mints a new version carrying
  // the new terms, retires the old one, and links them so the chain of custody
  // stays visible. Mirrors the Stripe promotion-code pattern: inactivate the
  // old code, create a new one, keep the relationship.
  static async supersede(id: string, data: any, adminId: string): Promise<any> {
    const existingResult = await query(`SELECT * FROM mart_campaigns WHERE id = $1`, [id]);
    const existing = existingResult.rows[0];
    if (!existing) throw new Error('Campaign not found');
    if (existing.superseded_by) throw new Error('This campaign has already been superseded');
    const newCode = normalizedCouponCodeOrThrow(data.couponCode);
    if (newCode === normalizedCouponCode(existing.coupon_code)) {
      throw new Error('The new coupon code must differ from the current one');
    }
    const clash = await query(`SELECT id FROM mart_campaigns WHERE coupon_code = $1`, [newCode]);
    if (clash.rows.length) throw new Error('That coupon code is already in use');

    // Every commercial term is carried over from the outgoing campaign unless
    // the caller overrides it. `create` would otherwise fall back to its own
    // defaults (discount 0, minimum 0, all stores, draft) and silently destroy
    // the offer being superseded.
    const pick = <T>(override: T | undefined, carried: T): T => override === undefined ? carried : override;
    const eligibilityType = pick(data.eligibilityType, existing.eligibility_type || 'all');
    const targetCustomerIds = Array.isArray(data.targetCustomerIds)
      ? data.targetCustomerIds
      : (await query(`SELECT customer_id FROM mart_campaign_targets WHERE campaign_id = $1`, [id])).rows.map(r => r.customer_id);

    const replacement = await this.create({
      // Copy forward
      title: pick(data.title, existing.title),
      subtitle: pick(data.subtitle, existing.subtitle),
      description: pick(data.description, existing.description),
      badgeText: pick(data.badgeText, existing.badge_text),
      discountType: pick(data.discountType, existing.discount_type),
      discountValue: pick(data.discountValue, existing.discount_value),
      maxDiscount: pick(data.maxDiscount, existing.max_discount),
      minOrderAmount: pick(data.minOrderAmount, existing.min_order_amount),
      perCustomerLimit: pick(data.perCustomerLimit, existing.per_customer_limit),
      usageLimit: pick(data.usageLimit, existing.usage_limit),
      storeId: pick(data.storeId, existing.store_id),
      eligibilityType,
      inactiveDays: eligibilityType === 'inactive_customers'
        ? pick(data.inactiveDays, existing.inactive_days)
        : null,
      // `new_customers_only` is derived from eligibility_type by `create`,
      // so it is carried by eligibilityType above rather than passed twice.
      targetCustomerIds: eligibilityType === 'targeted_customers' ? targetCustomerIds : undefined,
      showInCarousel: pick(data.showInCarousel, existing.show_in_carousel),
      carouselImageUrl: pick(data.carouselImageUrl, existing.carousel_image_url),
      carouselGradient: pick(data.carouselGradient, existing.carousel_gradient),
      carouselSortOrder: pick(data.carouselSortOrder, existing.carousel_sort_order),
      status: pick(data.status, existing.status),
      validFrom: pick(data.validFrom, existing.valid_from),
      validUntil: pick(data.validUntil, existing.valid_until),
      priority: pick(data.priority, existing.priority),
      // Always the new one
      couponCode: newCode,
    }, adminId);

    await query(
      `UPDATE mart_campaigns
       SET status = 'expired', superseded_by = $2, superseded_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, replacement.id]
    );
    await query(
      `INSERT INTO mart_campaign_changes (campaign_id, field, old_value, new_value, reason, changed_by)
       VALUES ($1,'superseded_by',$2,$3,$4,$5)`,
      [id, existing.coupon_code || '(auto-applied)', newCode,
       typeof data.changeReason === 'string' && data.changeReason.trim() ? data.changeReason.trim() : null, adminId]
    );
    // Retire the old carousel slide so the superseded offer stops showing.
    await query(`UPDATE mart_carousel_slides SET is_active = false WHERE campaign_id = $1`, [id]).catch(() => {});
    return replacement;
  }

  // ── Public: welcome offers a guest may be shown before signing in ──────────

  /**
   * mart_campaigns.store_id is a uuid, but callers legitimately have no store
   * context yet (the post-login welcome step queries with an empty storeId).
   * Comparing a uuid column to '' makes Postgres raise "invalid input syntax",
   * so an absent store is normalised to NULL and the predicate falls back to
   * global campaigns only.
   */
  private static normalizeStoreId(storeId?: string | null): string | null {
    const s = (storeId || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
  }

  /**
   * The welcome offer is the one campaign a shopper is meant to see *before*
   * they have an account, so it cannot come from getEligible(): that query
   * excludes coupon_code rows, which is exactly how a code-style welcome offer
   * ("FIRST50") is stored.
   *
   * This is a teaser, never an authority. It returns a whitelisted projection
   * (no targeting lists, limits, admin notes or internal flags) and nothing
   * here is trusted at checkout — redemption goes through validateCode() and
   * then the server re-checks everything in create().
   */
  static async getPublicWelcomeOffers(cartTotal: number, storeId: string): Promise<any[]> {
    const now = new Date().toISOString();
    const result = await query(
      `SELECT id, title, subtitle, description, badge_text, coupon_code,
              discount_type, discount_value, max_discount, min_order_amount,
              eligibility_type, carousel_gradient, valid_until
         FROM mart_campaigns
        WHERE status = 'active'
          AND (store_id IS NULL OR store_id = $1::uuid)
          AND (valid_from IS NULL OR valid_from <= $2)
          AND (valid_until IS NULL OR valid_until >= $2)
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND min_order_amount <= $3
          AND COALESCE(eligibility_type, CASE WHEN new_customers_only THEN 'first_order' ELSE 'all' END)
              IN ('first_order', 'all')
        ORDER BY priority DESC, discount_value DESC
        LIMIT 5`,
      [this.normalizeStoreId(storeId), now, cartTotal]
    );
    return result.rows;
  }

  // ── Public: eligible campaigns for a customer + cart ─────────────────────────

  static async getEligible(customerId: string | null, cartTotal: number, storeId: string): Promise<any[]> {
    const now = new Date().toISOString();

    // Get all active campaigns for this store
    const result = await query(
      // Whitelisted projection: this route is reachable without auth, so it must
      // not hand out targeting lists, per-customer limits or admin-only fields.
      `SELECT id, title, subtitle, description, badge_text, coupon_code,
              discount_type, discount_value, max_discount, min_order_amount,
              eligibility_type, carousel_gradient, valid_until,
              -- Needed for per-customer enforcement below; stripped before return.
              per_customer_limit, inactive_days
         FROM mart_campaigns
        WHERE status IN ('active', 'scheduled')
         AND (status = 'active' OR (valid_from IS NOT NULL AND valid_from <= $2))
         AND coupon_code IS NULL
         AND (store_id IS NULL OR store_id = $1::uuid)
         AND (valid_from IS NULL OR valid_from <= $2)
         AND (valid_until IS NULL OR valid_until >= $2)
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND (min_order_amount <= $3
               OR (min_order_previous IS NOT NULL AND min_order_grace_until > $2 AND min_order_previous <= $3))
       ORDER BY priority DESC, discount_value DESC`,
      [this.normalizeStoreId(storeId), now, cartTotal]
    );

    // Enforcement fields are selected for the checks below but must never reach
    // an anonymous caller.
    const stripInternal = (c: any) => {
      const { per_customer_limit, inactive_days, ...pub } = c;
      return pub;
    };

    const campaigns = result.rows;
    if (campaigns.length === 0) return campaigns;
    // Guests can see new_customer_only campaigns (read-only) to entice login,
    // but other eligibility types require verified customer identity.
    if (!customerId) {
      return campaigns.filter(c => {
        const eligibilityType = c.eligibility_type || (c.new_customers_only ? 'first_order' : 'all');
        return eligibilityType === 'first_order' || eligibilityType === 'all';
      }).map(stripInternal);
    }

    // Filter by customer eligibility
    const eligible: any[] = [];
    for (const c of campaigns) {
      const eligibilityType = c.eligibility_type || (c.new_customers_only ? 'first_order' : 'all');
      if (eligibilityType === 'first_order') {
        const orderCount = await query(
          `SELECT COUNT(*) as cnt FROM mart_orders WHERE customer_id = $1 AND status NOT IN ('cancelled','terminated','failed_delivery')`,
          [customerId]
        );
        if (parseInt(orderCount.rows[0].cnt) > 0) continue; // not a new customer
      }
      // Check per_customer_limit
      if (eligibilityType === 'inactive_customers') {
        const lastDelivery = await query(
          `SELECT MAX(updated_at) AS last_order_at FROM mart_orders WHERE customer_id = $1 AND status = 'delivered'`,
          [customerId]
        );
        const lastOrderAt = lastDelivery.rows[0]?.last_order_at;
        const cutoff = Date.now() - Number(c.inactive_days) * 24 * 60 * 60 * 1000;
        if (!lastOrderAt || new Date(lastOrderAt).getTime() > cutoff) continue;
      }
      if (eligibilityType === 'targeted_customers') {
        const target = await query(`SELECT 1 FROM mart_campaign_targets WHERE campaign_id = $1 AND customer_id = $2`, [c.id, customerId]);
        if (!target.rows[0]) continue;
      }
      const uses = await query(
        `SELECT COUNT(*) as cnt FROM mart_campaign_uses WHERE campaign_id = $1 AND customer_id = $2 AND reversed_at IS NULL`,
        [c.id, customerId]
      );
      if (parseInt(uses.rows[0].cnt) >= c.per_customer_limit) continue;
      eligible.push(stripInternal(c));
    }
    return eligible;
  }

  static async validateCode(code: string, customerId: string | null, cartTotal: number, storeId: string): Promise<any> {
    const result = await query(
      `SELECT * FROM mart_campaigns
       WHERE coupon_code = $1
         AND status IN ('active', 'scheduled')
         AND (status = 'active' OR (valid_from IS NOT NULL AND valid_from <= NOW()))`,
      [code.toUpperCase()]
    );
    if (!result.rows[0]) throw badRequest('That coupon code is not valid');
    const campaign = result.rows[0];

    // Check store scope
    if (campaign.store_id && campaign.store_id !== storeId) throw new Error('This coupon is not valid for this store');

    // Check validity dates
    const now = new Date();
    if (campaign.valid_from && new Date(campaign.valid_from) > now) throw badRequest('This coupon is not active yet');
    if (campaign.valid_until && new Date(campaign.valid_until) < now) throw badRequest('This coupon has expired');

    // Check usage limit
    if (campaign.usage_limit && campaign.usage_count >= campaign.usage_limit) throw new Error('This coupon has reached its usage limit');

    // Check min order — the previous threshold stays valid during the grace
    // window so a raised minimum does not strand an in-progress cart.
    const previousMinMet = !!campaign.min_order_previous &&
      !!campaign.min_order_grace_until &&
      new Date(campaign.min_order_grace_until) > now &&
      cartTotal >= Number(campaign.min_order_previous);
    if (cartTotal < parseFloat(campaign.min_order_amount) && !previousMinMet) {
      throw badRequest(`Add ₹${Number(campaign.min_order_amount) - cartTotal} more to use this coupon (minimum order ₹${Number(campaign.min_order_amount)})`);
    }

    if (customerId) {
      // Check new customers only
      const eligibilityType = campaign.eligibility_type || (campaign.new_customers_only ? 'first_order' : 'all');
      if (eligibilityType === 'first_order') {
        const orderCount = await query(
          `SELECT COUNT(*) as cnt FROM mart_orders WHERE customer_id = $1 AND status NOT IN ('cancelled','terminated','failed_delivery')`,
          [customerId]
        );
        if (parseInt(orderCount.rows[0].cnt) > 0) throw forbidden('This offer is for new customers only');
      }
      // Check per customer limit
      if (eligibilityType === 'inactive_customers') {
        const lastDelivery = await query(`SELECT MAX(updated_at) AS last_order_at FROM mart_orders WHERE customer_id = $1 AND status = 'delivered'`, [customerId]);
        const cutoff = Date.now() - Number(campaign.inactive_days) * 24 * 60 * 60 * 1000;
        if (!lastDelivery.rows[0]?.last_order_at || new Date(lastDelivery.rows[0].last_order_at).getTime() > cutoff) {
          throw new Error(`This offer is for customers inactive for ${campaign.inactive_days} days`);
        }
      }
      if (eligibilityType === 'targeted_customers') {
        const target = await query(`SELECT 1 FROM mart_campaign_targets WHERE campaign_id = $1 AND customer_id = $2`, [campaign.id, customerId]);
        if (!target.rows[0]) throw new Error('This offer is not available for this customer');
      }
      const uses = await query(
        `SELECT COUNT(*) as cnt FROM mart_campaign_uses WHERE campaign_id = $1 AND customer_id = $2 AND reversed_at IS NULL`,
        [campaign.id, customerId]
      );
      if (parseInt(uses.rows[0].cnt) >= campaign.per_customer_limit) throw conflict('You have already used this coupon');
    }

    return campaign;
  }

  static calculateDiscount(campaign: any, cartTotal: number): number {
    if (campaign.discount_type === 'flat') return Math.min(parseFloat(campaign.discount_value), cartTotal);
    if (campaign.discount_type === 'percent') {
      const disc = (cartTotal * parseFloat(campaign.discount_value)) / 100;
      return campaign.max_discount ? Math.min(disc, parseFloat(campaign.max_discount)) : disc;
    }
    if (campaign.discount_type === 'free_delivery') return 0; // handled separately
    return 0;
  }

  static async recordUse(campaignId: string, customerId: string | null, orderId: string, discountApplied: number, couponCode?: string): Promise<void> {
    await query(
      `INSERT INTO mart_campaign_uses (campaign_id, customer_id, order_id, discount_applied, coupon_code_used)
       VALUES ($1,$2,$3,$4,$5)`,
      [campaignId, customerId || null, orderId, discountApplied, couponCode || null]
    );
    await query(`UPDATE mart_campaigns SET usage_count = usage_count + 1 WHERE id = $1`, [campaignId]);
  }

  // ── Carousel slides ───────────────────────────────────────────────────────────

  static async getCarouselSlides(activeOnly = true): Promise<any[]> {
    const where = activeOnly ? 'WHERE is_active = true' : '';
    const result = await query(
      `SELECT cs.*, c.title as "campaignTitle", c.badge_text as "campaignBadge",
              c.discount_type as "discountType", c.discount_value as "discountValue",
              c.coupon_code as "couponCode", c.valid_until as "validUntil"
       FROM mart_carousel_slides cs
       LEFT JOIN mart_campaigns c ON c.id = cs.campaign_id
       ${where}
       ORDER BY cs.sort_order ASC`,
      []
    );
    return result.rows;
  }

  static async createSlide(data: any, adminId: string): Promise<any> {
    const result = await query(
      `INSERT INTO mart_carousel_slides (title, subtitle, image_url, gradient, campaign_id, sort_order, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [data.title || null, data.subtitle || null, data.imageUrl || null,
       data.gradient || 'from-emerald-500 via-teal-500 to-cyan-500',
       data.campaignId || null, data.sortOrder || 0, data.isActive !== false, adminId]
    );
    return result.rows[0];
  }

  static async updateSlide(id: string, data: any): Promise<any> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.title !== undefined)      { fields.push(`title = $${i++}`);       params.push(data.title); }
    if (data.subtitle !== undefined)   { fields.push(`subtitle = $${i++}`);    params.push(data.subtitle); }
    if (data.imageUrl !== undefined)   { fields.push(`image_url = $${i++}`);   params.push(data.imageUrl); }
    if (data.gradient !== undefined)   { fields.push(`gradient = $${i++}`);    params.push(data.gradient); }
    if (data.campaignId !== undefined) { fields.push(`campaign_id = $${i++}`); params.push(data.campaignId); }
    if (data.sortOrder !== undefined)  { fields.push(`sort_order = $${i++}`);  params.push(data.sortOrder); }
    if (data.isActive !== undefined)   { fields.push(`is_active = $${i++}`);   params.push(data.isActive); }
    if (!fields.length) throw new Error('Nothing to update');
    params.push(id);
    const result = await query(
      `UPDATE mart_carousel_slides SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, params
    );
    return result.rows[0];
  }

  static async deleteSlide(id: string): Promise<void> {
    await query(`DELETE FROM mart_carousel_slides WHERE id = $1`, [id]);
  }

  static async reorderSlides(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await query(`UPDATE mart_carousel_slides SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]]);
    }
  }
}
