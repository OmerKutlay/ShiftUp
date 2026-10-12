-- Migration: 20260928140000_add_store_locations
-- FAZ 6: Mağaza konumu ve geofence konfigürasyonu

CREATE TABLE store_locations (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT             NOT NULL,
  latitude             DOUBLE PRECISION NOT NULL,
  longitude            DOUBLE PRECISION NOT NULL,
  allowed_radius_meters INTEGER         NOT NULL DEFAULT 100,
  max_accuracy_meters  INTEGER          NOT NULL DEFAULT 200,
  active               BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_store_locations_updated_at
  BEFORE UPDATE ON store_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE store_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_locations_select
  ON store_locations FOR SELECT USING (active = true);

-- Seed: örnek mağaza (İstanbul Beyoğlu civarı)
INSERT INTO store_locations (id, name, latitude, longitude, allowed_radius_meters, max_accuracy_meters) VALUES
  ('00000000-0000-0000-0002-000000000001', 'ShiftUp Demo Mağaza', 41.0082, 28.9784, 150, 300);
