-- Migration: 20260928120000_update_shift_assignments_add_template
-- FAZ 4: shift_assignments tablosuna shift_template_id FK + updated_at

ALTER TABLE shift_assignments
  ADD COLUMN shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  ADD COLUMN updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX idx_shift_assignments_template_id ON shift_assignments(shift_template_id);

CREATE TRIGGER trg_shift_assignments_updated_at
  BEFORE UPDATE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: write policies
CREATE POLICY anon_insert_shift_assignments
  ON shift_assignments FOR INSERT WITH CHECK (true);

CREATE POLICY anon_update_shift_assignments
  ON shift_assignments FOR UPDATE USING (true);

CREATE POLICY anon_delete_shift_assignments
  ON shift_assignments FOR DELETE USING (true);
