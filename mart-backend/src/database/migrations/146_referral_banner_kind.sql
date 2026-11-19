-- Allow a referral banner home section kind.
DO $$
BEGIN
  ALTER TABLE mart_home_sections DROP CONSTRAINT IF EXISTS mart_home_sections_kind_check;
  ALTER TABLE mart_home_sections
    ADD CONSTRAINT mart_home_sections_kind_check
    CHECK (kind IN ('manual','category','combo','deals','bestsellers','new_arrivals','buy_again','banner','referral_banner','category_tiles','fresh'));
END $$;
