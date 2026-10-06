-- Historical attribution is reconstructed only where the converted cart gives
-- an exact order-to-session link. Orders without that evidence stay NULL and
-- appear as unlinked in reconciliation rather than being guessed into a channel.
UPDATE mart_orders o
SET funnel_session_id = c.session_id,
    funnel_visitor_id = s.visitor_id,
    attribution_source = s.source,
    attribution_medium = s.medium,
    attribution_campaign = s.utm_campaign,
    attribution_qr_code_id = s.qr_code_id
FROM mart_carts c
JOIN mart_funnel_sessions s ON s.session_id = c.session_id
WHERE c.order_id = o.id
  AND o.funnel_session_id IS NULL;