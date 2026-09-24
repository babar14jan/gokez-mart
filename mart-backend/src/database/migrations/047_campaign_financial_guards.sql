-- Database-level financial guardrails for Super Admin-managed campaigns.

ALTER TABLE mart_campaigns
  ADD CONSTRAINT mart_campaigns_discount_value_check
  CHECK (discount_value >= 0),
  ADD CONSTRAINT mart_campaigns_percent_check
  CHECK (discount_type <> 'percent' OR discount_value <= 100),
  ADD CONSTRAINT mart_campaigns_max_discount_check
  CHECK (max_discount IS NULL OR max_discount >= 0),
  ADD CONSTRAINT mart_campaigns_minimum_order_check
  CHECK (min_order_amount >= 0),
  ADD CONSTRAINT mart_campaigns_per_customer_limit_check
  CHECK (per_customer_limit > 0),
  ADD CONSTRAINT mart_campaigns_usage_limit_check
  CHECK (usage_limit IS NULL OR usage_limit > 0),
  ADD CONSTRAINT mart_campaigns_validity_range_check
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from);