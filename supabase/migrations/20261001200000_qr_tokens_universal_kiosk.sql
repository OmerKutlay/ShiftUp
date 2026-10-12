-- Universal kiosk QR desteği:
-- employee_id ve action_type NULL olabilir (kiosk token için)
-- Mevcut kayıtlar etkilenmez.
ALTER TABLE qr_tokens
  ALTER COLUMN employee_id DROP NOT NULL,
  ALTER COLUMN action_type DROP NOT NULL;
