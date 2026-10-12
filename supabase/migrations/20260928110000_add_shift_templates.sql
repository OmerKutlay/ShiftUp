-- Migration: 20260928110000_add_shift_templates
-- FAZ 3: Mağazada tekrar eden standart vardiya şablonları

CREATE TABLE shift_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  start_time  TIME        NOT NULL,
  end_time    TIME        NOT NULL,
  description TEXT,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shift_template_name UNIQUE (name)
);

CREATE TRIGGER trg_shift_templates_updated_at
  BEFORE UPDATE ON shift_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_shift_templates
  ON shift_templates FOR SELECT USING (true);

CREATE POLICY anon_insert_shift_templates
  ON shift_templates FOR INSERT WITH CHECK (true);

CREATE POLICY anon_update_shift_templates
  ON shift_templates FOR UPDATE USING (true);

-- Seed: Örnek şablonlar
INSERT INTO shift_templates (id, name, start_time, end_time, description) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Açılış',  '09:00', '18:00', 'Sabah açılış vardiyası'),
  ('00000000-0000-0000-0001-000000000002', 'Ortacı',  '12:00', '21:00', 'Öğle vardiyası'),
  ('00000000-0000-0000-0001-000000000003', 'Kapanış', '14:00', '23:00', 'Akşam kapanış vardiyası')
ON CONFLICT (id) DO NOTHING;
