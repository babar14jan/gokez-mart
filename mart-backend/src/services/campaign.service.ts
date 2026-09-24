import { query } from '../database/db';

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

    const normalizedCouponCode = (value: unknown) => value ? String(value).trim().toUpperCase() : null;
    const numberChanged = (value: unknown, stored: unknown) => value !== undefined && Number(value) !== Number(stored);
    const changedFinancialFields = [
      data.discountType !== undefined && data.discountType !== existing.discount_type && 'discount type',
      numberChanged(data.discountValue, existing.discount_value) && 'discount value',
      numberChanged(data.maxDiscount, existing.max_discount) && 'maximum discount',
      numberChanged(data.minOrderAmount, existing.min_order_amount) && 'minimum order amount',
      data.couponCode !== undefined && normalizedCouponCode(data.couponCode) !== normalizedCouponCode(existing.coupon_code) && 'coupon code',
      numberChanged(data.perCustomerLimit, existing.per_customer_limit) && 'per-customer limit',
      numberChanged(data.usageLimit, existing.usage_limit) && 'total usage limit',
      data.storeId !== undefined && data.storeId !== existing.store_id && 'store scope',
      data.eligibilityType !== undefined && data.eligibilityType !== existing.eligibility_type && 'eligibility',
      numberChanged(data.inactiveDays, existing.inactive_days) && 'inactivity period',
      data.newCustomersOnly !== undefined && data.newCustomersOnly !== existing.new_customers_only && 'new-customer eligibility',
    ].filter(Boolean) as string[];
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

    if (changedFinancialFields.length || targetCustomersChanged) {
      const uses = await query(`SELECT 1 FROM mart_campaign_uses WHERE campaign_id = $1 LIMIT 1`, [id]);
      if (uses.rows.length) {
        const fields = [...changedFinancialFields, ...(targetCustomersChanged ? ['target audience'] : [])];
        throw new Error(`Cannot change ${fields.join(', ')} after a campaign has been redeemed`);
      }
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

  // ── Public: eligible campaigns for a customer + cart ─────────────────────────

  static async getEligible(customerId: string | null, cartTotal: number, storeId: string): Promise<any[]> {
    const now = new Date().toISOString();

    // Get all active campaigns for this store
    const result = await query(
      `SELECT * FROM mart_campaigns
       WHERE status IN ('active', 'scheduled')
         AND (status = 'active' OR (valid_from IS NOT NULL AND valid_from <= $2))
         AND coupon_code IS NULL
         AND (store_id = $1 OR store_id IS NULL)
         AND (valid_from IS NULL OR valid_from <= $2)
         AND (valid_until IS NULL OR valid_until >= $2)
         AND (usage_limit IS NULL OR usage_count < usage_limit)
         AND min_order_amount <= $3
      ORDER BY priority DESC, discount_value DESC`,
      [storeId, now, cartTotal]
    );

    const campaigns = result.rows;
    if (!customerId || campaigns.length === 0) return campaigns;

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
      eligible.push(c);
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
    if (!result.rows[0]) throw new Error('Invalid or expired coupon code');
    const campaign = result.rows[0];

    // Check store scope
    if (campaign.store_id && campaign.store_id !== storeId) throw new Error('This coupon is not valid for this store');

    // Check validity dates
    const now = new Date();
    if (campaign.valid_from && new Date(campaign.valid_from) > now) throw new Error('This coupon is not active yet');
    if (campaign.valid_until && new Date(campaign.valid_until) < now) throw new Error('This coupon has expired');

    // Check usage limit
    if (campaign.usage_limit && campaign.usage_count >= campaign.usage_limit) throw new Error('This coupon has reached its usage limit');

    // Check min order
    if (cartTotal < parseFloat(campaign.min_order_amount)) {
      throw new Error(`Minimum order ₹${campaign.min_order_amount} required for this coupon`);
    }

    if (customerId) {
      // Check new customers only
      const eligibilityType = campaign.eligibility_type || (campaign.new_customers_only ? 'first_order' : 'all');
      if (eligibilityType === 'first_order') {
        const orderCount = await query(
          `SELECT COUNT(*) as cnt FROM mart_orders WHERE customer_id = $1 AND status NOT IN ('cancelled','terminated','failed_delivery')`,
          [customerId]
        );
        if (parseInt(orderCount.rows[0].cnt) > 0) throw new Error('This offer is for new customers only');
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
      if (parseInt(uses.rows[0].cnt) >= campaign.per_customer_limit) throw new Error('You have already used this coupon');
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
