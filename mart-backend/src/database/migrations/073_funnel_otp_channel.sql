-- OTP requests are currently delivered by phone call. Keep the channel on the
-- event itself so SMS can be reported after DLT approval without changing the
-- OTP funnel's attempt/session definitions.
ALTER TABLE mart_funnel_events
  ADD COLUMN IF NOT EXISTS otp_channel TEXT
  CHECK (otp_channel IN ('phone_call', 'sms'));

CREATE INDEX IF NOT EXISTS idx_funnel_events_otp_channel_created
  ON mart_funnel_events(otp_channel, created_at DESC)
  WHERE otp_channel IS NOT NULL;