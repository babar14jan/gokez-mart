import { query } from '../database/db';

/**
 * A single cheap fingerprint of everything the public storefront endpoints
 * serve. The user app polls this instead of re-downloading the whole catalogue
 * every few minutes: when the stamp is unchanged, the client skips the heavy
 * fetches entirely.
 *
 * Each component is `count || ':' || max(updated_at)` because that pair catches
 * all three mutation shapes this schema uses:
 *   - INSERT  → count changes (or the new row's timestamp wins the max)
 *   - UPDATE  → updated_at is bumped application-side (verified: every UPDATE
 *               touching these tables sets `updated_at = NOW()`)
 *   - DELETE  → these tables hard-delete, so only the count moves
 *
 * Cross-table dependencies of the payloads are folded in deliberately:
 *   - /categories' productCount reads products + store-products, so those
 *     stamps are global rather than store-scoped.
 *   - /home-sections' top_picks bestseller fallback reads orders, so the
 *     orders stamp is included (status changes bump orders.updated_at).
 *   - /settings/public's open/closed state flips on the wall clock with no DB
 *     write at all; the controller appends evaluateStoreOpen's state and next
 *     boundary instant to the hash for that.
 */
export class CatalogService {
  static async getStamp(storeId: string): Promise<string> {
    const result = await query<{ stamp: string | null }>(
      `SELECT md5(concat_ws('|',
        (SELECT count(*) || ':' || COALESCE(max(p.updated_at)::text, '-') FROM mart_products p),
        (SELECT count(*) || ':' || COALESCE(max(p.updated_at)::text, '-') FROM mart_store_products p),
        (SELECT count(*) || ':' || COALESCE(max(p.created_at)::text, '-') FROM mart_bundle_components p),
        (SELECT count(*) || ':' || COALESCE(max(c.updated_at)::text, '-') FROM mart_categories c),
        (SELECT count(*) || ':' || COALESCE(max(s.updated_at)::text, '-') FROM mart_settings s WHERE s.store_id = $1),
        (SELECT COALESCE(max(s.updated_at)::text, '-') FROM mart_stores s WHERE s.id = $1),
        (SELECT count(*) || ':' || COALESCE(max(h.updated_at)::text, '-') FROM mart_home_sections h WHERE h.store_id = $1),
        (SELECT count(*) || ':' || COALESCE(max(o.updated_at)::text, '-') FROM mart_orders o WHERE o.store_id = $1)
      )) AS stamp`,
      [storeId]
    );
    return result.rows[0]?.stamp ?? '';
  }
}
