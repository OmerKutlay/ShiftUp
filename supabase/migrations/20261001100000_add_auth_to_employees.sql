-- ============================================================
-- FAZ AUTH: employees tablosuna Supabase Auth bağlantısı
-- ============================================================

-- 1. email kolonu: employee login için kullanılacak
ALTER TABLE employees
  ADD COLUMN email TEXT UNIQUE;

-- 2. auth_user_id: Supabase auth.users.id ile 1:1 bağlantı
ALTER TABLE employees
  ADD COLUMN auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_employees_auth_user_id ON employees(auth_user_id);
CREATE INDEX idx_employees_email        ON employees(email);

-- ============================================================
-- RLS POLICIES: Mevcut permissive anon politikalarını koru,
-- auth temelli politikalar ekle
-- ============================================================

-- Authenticated user kendi employee kaydını okuyabilir
CREATE POLICY auth_select_own_employee
  ON employees FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Authenticated user kendi employee kaydını güncelleyebilir (kısıtlı alanlar)
-- Gerçek kısıtlama uygulama katmanında yapılacak; RLS sadece ownership doğrular
CREATE POLICY auth_update_own_employee
  ON employees FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid());

-- ============================================================
-- SECURITY DEFINER FUNCTION: auth.uid() → employee kaydı
-- API route'larının RLS bypass etmeden employee lookup yapabilmesi için
-- ============================================================
CREATE OR REPLACE FUNCTION get_employee_by_auth_uid(p_uid UUID)
RETURNS TABLE (
  id          UUID,
  full_name   TEXT,
  email       TEXT,
  role        TEXT,
  role_id     UUID,
  active      BOOLEAN,
  auth_user_id UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    e.id,
    e.full_name,
    e.email,
    e.role,
    e.role_id,
    e.active,
    e.auth_user_id
  FROM employees e
  WHERE e.auth_user_id = p_uid
  LIMIT 1;
$$;
