UPDATE mart_orders o
   SET item_savings = COALESCE((
     SELECT SUM(GREATEST(0, sp.price - oi.price) * oi.quantity)
       FROM mart_order_items oi
       JOIN mart_store_products sp
         ON sp.store_id = oi.store_id AND sp.product_id = oi.product_id
      WHERE oi.order_id = o.id
   ), 0)
 WHERE o.item_savings = 'NaN'::numeric;