-- Super-admin promotional push records and per-subscription delivery audit.
CREATE TABLE IF NOT EXISTS mart_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('new_product', 'combo', 'offer', 'back_in_stock', 'we_miss_you', 'custom')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  destination_url TEXT NOT NULL CHECK (destination_url LIKE '/%'),
  zone_ids JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES mart_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mart_promotions_created_at ON mart_promotions(created_at DESC);

CREATE TABLE IF NOT EXISTS mart_promotion_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES mart_promotions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES mart_customers(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES mart_push_subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_promotion_deliveries_promotion ON mart_promotion_deliveries(promotion_id);