-- A combo recipe owns its deduction measure; it does not inherit the component's selling unit.
ALTER TABLE mart_bundle_components
  ADD COLUMN IF NOT EXISTS deduction_unit TEXT;