-- Migration: 20260928130000_add_qr_tokens
-- FAZ 5: Dinamik QR token yönetimi

CREATE TYPE qr_action_type AS ENUM (
  'clock_in',
  'break_start',
  'break_end',
  'clock_out'
);

CREATE TABLE qr_tokens (
  id          UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT             NOT NULL UNIQUE,
  action_type qr_action_type   NOT NULL,
  employee_id UUID             NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ      NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qr_tokens_token       ON qr_tokens(token);
CREATE INDEX idx_qr_tokens_expires_at  ON qr_tokens(expires_at);
CREATE INDEX idx_qr_tokens_employee_id ON qr_tokens(employee_id);

ALTER TABLE qr_tokens ENABLE ROW LEVEL SECURITY;

-- Geçerli (kullanılmamış, süresi dolmamış) token'ları okuma
CREATE POLICY qr_tokens_select_valid
  ON qr_tokens FOR SELECT
  USING (used_at IS NULL AND expires_at > NOW());
