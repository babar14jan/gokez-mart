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
    const result = await query(
      `SELECT c.*,
              a.name as "createdByName",
              s.name as "storeName",
              (SELECT COUNT(*) FROM mart_campaign_uses cu WHERE cu.campaign_id = c.id)::int as "useCount",
              (SELECT COALESCE(SUM(cu.discount_applied),0) FROM mart_campaign_uses cu WHERE cu.campaign_id = c.id)::float as "totalDiscount"
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
    const result = await query(
      `INSERT INTO mart_campaigns (
        title, subtitle, description, badge_text,
        discount_type, discount_value, max_discount, min_order_amount,
        coupon_code, new_customers_only, per_customer_limit, usage_limit,
        store_id, show_in_carousel, carousel_image_url, carousel_gradient, carousel_sort_order,
        status, valid_from, valid_until, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,
      [
        data.title, data.subtitle || null, data.description || null, data.badgeText || null,
        data.discountType || 'flat', data.discountValue || 0, data.maxDiscount || null, data.minOrderAmount || 0,
        data.couponCode?.toUpperCase() || null, data.newCustomersOnly || false,
        data.perCustomerLimit || 1, data.usageLimit || null,
        data.storeId || null, data.showInCarousel || false,
        data.carouselImageUrl || null, data.carouselGradient || 'from-emerald-500 via-teal-500 to-cyan-500',
        data.carouselSortOrder || 0,
        data.status || 'draft',
        data.validFrom || null, data.validUntil || null, adminId,
      ]
    );
    return result.rows[0];
  }

  static async update(id: string, data: any): Promise<any> {
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
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        const val = key === 'couponCode' ? (data[key]?.toUpperCase() || null) : data[key];
        fields.push(`${col} = $${i++}`);
        params.push(val);
      }
    }
    if (!fields.length) throw new Error('Nothing to update');
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await query(
      `UPDATE mart_campaigns SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    return result.rows[0];
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
       WHERE status = 'active'
         AND (store_id = $1 OR store_id IS NULL)
         AND (valid_from IS NULL OR valid_from <= $2)
         AND (valid_until IS NULL OR valid_until >= $2)
         AND (usage_limit IS NULL OR usage_count < usage_limit)
         AND min_order_amount <= $3
       ORDER BY discount_value DESC`,
      [storeId, now, cartTotal]
    );

    const campaigns = result.rows;
    if (!customerId || campaigns.length === 0) return campaigns;

    // Filter by customer eligibility
    const eligible: any[] = [];
    for (const c of campaigns) {
      // Check new_customers_only
      if (c.new_customers_only) {
        const orderCount = await query(
          `SELECT COUNT(*) as cnt FROM mart_orders WHERE customer_id = $1 AND status NOT IN ('cancelled','terminated','failed_delivery')`,
          [customerId]
        );
        if (parseInt(orderCount.rows[0].cnt) > 0) continue; // not a new customer
      }
      // Check per_customer_limit
      const uses = await query(
        `SELECT COUNT(*) as cnt FROM mart_campaign_uses WHERE campaign_id = $1 AND customer_id = $2`,
        [c.id, customerId]
      );
      if (parseInt(uses.rows[0].cnt) >= c.per_customer_limit) continue;
      eligible.push(c);
    }
    return eligible;
  }

  static async validateCode(code: string, customerId: string | null, cartTotal: number, storeId: string): Promise<any> {
    const result = await query(
      `SELECT * FROM mart_campaigns WHERE coupon_code = $1 AND status = 'active'`,
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
      if (campaign.new_customers_only) {
        const orderCount = await query(
          `SELECT COUNT(*) as cnt FROM mart_orders WHERE customer_id = $1 AND status NOT IN ('cancelled','terminated','failed_delivery')`,
          [customerId]
        );
        if (parseInt(orderCount.rows[0].cnt) > 0) throw new Error('This offer is for new customers only');
      }
      // Check per customer limit
      const uses = await query(
        `SELECT COUNT(*) as cnt FROM mart_campaign_uses WHERE campaign_id = $1 AND customer_id = $2`,
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
