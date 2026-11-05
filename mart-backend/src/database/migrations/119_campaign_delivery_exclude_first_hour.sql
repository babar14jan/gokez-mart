-- Migration 119: Campaign delivery schedule options.
--
-- Adds the "exclude first hour after store opens" toggle alongside the
-- scheduled-delivery requirement, so a campaign can gate redemption on a
-- delivery window that skips the store's opening hour.

ALTER TABLE mart_campaigns
  ADD COLUMN IF NOT EXISTS exclude_first_hour_after_open BOOLEAN NOT NULL DEFAULT false;
