-- Migration: 20260928100001_add_employee_write_policies
-- FAZ 2: employees tablosu write RLS policies

CREATE POLICY anon_insert_employees
  ON employees FOR INSERT WITH CHECK (true);

CREATE POLICY anon_update_employees
  ON employees FOR UPDATE USING (true);
