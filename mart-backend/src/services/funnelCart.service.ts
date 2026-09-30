import { query } from '../database/db';
import { MAX_SESSION_ID_LENGTH } from './funnelEvent.service';

/** The subset of a pg client/connection that markConverted needs. Typed
 *  structurally because the shared `transaction` helper hands out `any`. */
type QueryRunner = { query: (text: string, params?: unknown[]) => Promise<unknown> };

export interface ServerCartItem {
  productId: string;
  productName: string;
  unit: string;
  price: number;
  quantity: number;
  photoUrl: string | null;
}

/**
 * Durable mirror of the browser cart. localStorage remains the render source in
 * mart-user so no checkout behaviour changes; this exists so the cart funnel
 * is measurable and so a cart can be recovered after the customer verifies.
 */
export class FunnelCartService {
  static async upsert(params: {
    sessionId: string;
    customerId?: string | null;
    items: ServerCartItem[];
    reachedCheckout?: boolean;
  }): Promise<{ itemCount: number; subtotal: number }> {
    const sessionId = (params.sessionId || '').trim();
    if (!sessionId) return { itemCount: 0, subtotal: 0 };

    // Normalise the items FIRST, then derive every number from the normalised
    // list. Computing the counts from the raw payload would let the
    // item_count / subtotal columns disagree with the stored items whenever a
    // client sent an out-of-range quantity.
    const items = params.items.map(item => ({
      productId: String(item.productId || '').slice(0, 64),
      productName: String(item.productName || '').slice(0, 160),
      unit: String(item.unit || '').slice(0, 32),
      price: Math.max(0, Number(item.price) || 0),
      quantity: Math.max(0, Math.min(99, Number(item.quantity) || 0)),
      photoUrl: item.photoUrl ? String(item.photoUrl).slice(0, 300) : null,
    }));

    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = Number(items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2));
    const customerId = params.customerId || null;
    const reachedCheckout = params.reachedCheckout === true;

    if (itemCount === 0 && !reachedCheckout) {
      await query(`DELETE FROM mart_carts WHERE session_id = $1 AND converted_at IS NULL`, [sessionId]);
      return { itemCount, subtotal };
    }

    await query(
      `INSERT INTO mart_carts (customer_id, session_id, items, item_count, subtotal, reached_checkout, last_active_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
       ON CONFLICT (session_id) WHERE converted_at IS NULL DO UPDATE SET
         customer_id = COALESCE(EXCLUDED.customer_id, mart_carts.customer_id),
         items = EXCLUDED.items,
         item_count = EXCLUDED.item_count,
         subtotal = EXCLUDED.subtotal,
         reached_checkout = mart_carts.reached_checkout OR EXCLUDED.reached_checkout,
         last_active_at = NOW()`,
      [customerId, sessionId, JSON.stringify(items), itemCount, subtotal, reachedCheckout]
    );

    return { itemCount, subtotal };
  }



  /**
   * Marks the cart converted when an order is placed. Idempotent.
   *
   * Takes the order transaction's client so the conversion commits or rolls back
   * together with the order it belongs to. Run on the shared pool instead, a
   * later failure to write the order would leave a cart recorded as converted
   * with no order behind it -- and since the funnel reports
   * `abandoned = reachedCheckout - converted`, that single stray row both
   * invents a conversion and hides a real abandonment.
   *
   * `client` is optional so this stays usable outside a transaction (tests,
   * backfills), but the order path must pass it.
   */
  static async markConverted(
    sessionId: string,
    orderId: string,
    client?: QueryRunner
  ): Promise<void> {
    const sid = (sessionId || '').trim();
    if (!sid || !orderId) return;
    const run = client ? client.query.bind(client) : query;
    await run(
      `UPDATE mart_carts
       SET converted_at = COALESCE(converted_at, NOW()),
           order_id     = COALESCE(mart_carts.order_id, $2)
       WHERE session_id = $1
         AND converted_at IS NULL`,
      [sid.slice(0, MAX_SESSION_ID_LENGTH), orderId]
    );
  }
}
