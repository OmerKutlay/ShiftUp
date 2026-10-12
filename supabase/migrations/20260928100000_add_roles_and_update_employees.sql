-- Migration: 20260928100000_add_roles_and_update_employees
-- FAZ 2: Roller tablosu + employees güncellemesi

-- ============================================================
-- TABLE: roles
-- Sistem rollerini merkezi yönetmek için. İleride RBAC genişletilebilir.
-- ============================================================
CREATE TABLE roles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Temel roller
INSERT INTO roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Yönetici',         'Tam sistem erişimi'),
  ('00000000-0000-0000-0000-000000000002', 'Mağaza Müdürü',    'Mağaza yönetimi ve planlama'),
  ('00000000-0000-0000-0000-000000000003', 'Müdür Yardımcısı', 'Müdür yardımcısı yetkileri'),
  ('00000000-0000-0000-0000-000000000004', 'Çalışan',          'Standart çalışan')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- employees tablosuna ek kolonlar
-- ============================================================
ALTER TABLE employees
  ADD COLUMN role_id    UUID        REFERENCES roles(id) ON DELETE SET NULL,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Mevcut çalışanların role_id'lerini ata
UPDATE employees SET role_id = '00000000-0000-0000-0000-000000000004'
WHERE role_id IS NULL;

CREATE INDEX idx_employees_role_id ON employees(role_id);

-- updated_at trigger
CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_roles
  ON roles FOR SELECT USING (true);
