-- Migration: 20260928000001_create_core_tables
-- Creates the core data model for ShiftUp: employees, shift_assignments, attendance_records

-- ============================================================
-- ENUM: attendance status (type-safe, extensible)
-- ============================================================
CREATE TYPE attendance_status AS ENUM (
  'shift_waiting',   -- Vardiya Bekleniyor
  'working',         -- Çalışıyor
  'on_break',        -- Molada
  'working_after_break', -- Çalışıyor (moladan döndü)
  'clocked_out'      -- Çıkış Yaptı
);

-- ============================================================
-- TABLE: employees
-- ============================================================
CREATE TABLE employees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: shift_assignments
-- ============================================================
CREATE TABLE shift_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date   DATE        NOT NULL,
  start_time  TIME        NOT NULL,  -- e.g. '09:00'
  end_time    TIME        NOT NULL,  -- e.g. '18:00'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shift_assignments_employee_id ON shift_assignments(employee_id);
CREATE INDEX idx_shift_assignments_work_date   ON shift_assignments(work_date);

-- ============================================================
-- TABLE: attendance_records
-- All timestamps stored in UTC; UI converts to Europe/Istanbul
-- ============================================================
CREATE TABLE attendance_records (
  id                   UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          UUID              NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_assignment_id  UUID              NOT NULL REFERENCES shift_assignments(id) ON DELETE CASCADE,
  status               attendance_status NOT NULL DEFAULT 'shift_waiting',
  clock_in_at          TIMESTAMPTZ,
  break_start_at       TIMESTAMPTZ,
  break_end_at         TIMESTAMPTZ,
  clock_out_at         TIMESTAMPTZ,
  -- Future extensibility fields (NULL until feature is implemented)
  verification_method  TEXT,            -- 'manual' | 'qr' | 'dynamic_qr' | 'geolocation' | 'geofence'
  exception_note       TEXT,            -- Attendance Exception açıklaması
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attendance_records_employee_id         ON attendance_records(employee_id);
CREATE INDEX idx_attendance_records_shift_assignment_id ON attendance_records(shift_assignment_id);

-- Ensure only ONE active attendance record per shift assignment
-- "active" means not clocked_out
CREATE UNIQUE INDEX idx_one_active_per_shift
  ON attendance_records(shift_assignment_id)
  WHERE status != 'clocked_out';

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_records_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
