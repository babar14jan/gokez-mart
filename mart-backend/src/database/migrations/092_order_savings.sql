-- Persist the savings the customer got on an order so the order history and
-- receipt can show the same "you saved" figures as checkout.
--
-- item_savings        = Σ (list price − effective price) × qty across lines
-- free_delivery_saving = delivery fee waived (free-delivery offer or threshold)
--
-- The coupon/offer portion is already stored in campaign_discount. Rows placed
-- before this migration keep the 0 default, which simply renders no savings.
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS item_savings          NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE mart_orders ADD COLUMN IF NOT EXISTS free_delivery_saving  NUMERIC(10,2) NOT NULL DEFAULT 0;
