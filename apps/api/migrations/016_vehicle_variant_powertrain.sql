ALTER TABLE vehicles ADD COLUMN variant text;
ALTER TABLE vehicles ADD COLUMN powertrain text;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicle_variant_valid
    CHECK (variant IS NULL OR length(btrim(variant)) BETWEEN 1 AND 160),
  ADD CONSTRAINT vehicle_powertrain_valid
    CHECK (powertrain IS NULL OR length(btrim(powertrain)) BETWEEN 1 AND 160);

CREATE INDEX visits_site_vehicle_created
  ON visits (organisation_id, site_id, vehicle_id, created_at DESC);
