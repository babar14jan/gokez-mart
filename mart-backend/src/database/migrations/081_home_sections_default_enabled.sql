-- Migration 081: enable the Deals and Top Picks sections by default.
--
-- Migration 080 added these sections *disabled* so existing storefronts were
-- untouched by the change. They should be on out of the box instead:
--   * A `top_picks` section with no curated products resolves to zero items and
--     is hidden by the storefront, so enabling it early is harmless.
--   * A `deals` section only shows once at least one product has a discount.
-- Admins can still hide either one from Hub → Home Sections.
UPDATE mart_home_sections
SET is_enabled = true, updated_at = NOW()
WHERE section_key IN ('deals', 'top_picks');
