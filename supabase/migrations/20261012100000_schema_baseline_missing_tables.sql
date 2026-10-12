-- ============================================================
-- Şema eşitleme: kodda kullanılan ama repoda migration'ı olmayan tablolar/kolonlar.
--
-- Canlı veritabanında bu tablolar zaten var olabilir (dashboard'dan elle oluşturulmuş).
-- Bu yüzden tüm ifadeler idempotenttir: CREATE ... IF NOT EXISTS ve
-- ADD COLUMN IF NOT EXISTS. Böylece hem sıfırdan kurulum (`supabase db reset`)
-- hem de mevcut veritabanı aynı şemaya ulaşır.
-- ============================================================

-- ─── employees: çalışma tipi + özlük alanları ────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS hire_date       DATE,   -- yıllık izin hakkı (İş K. Md. 53)
  ADD COLUMN IF NOT EXISTS birth_date      DATE;   -- 18 altı / 50 üstü izin hakkı

DO $$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_employment_type_check
    CHECK (employment_type IN ('full_time', 'part_time'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── leave_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type    TEXT        NOT NULL,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  reason        TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending',
  reviewer_note TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_type_check
    CHECK (leave_type IN ('annual', 'sick', 'personal', 'unpaid', 'other', 'weekly_rest')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_dates_check
    CHECK (end_date >= start_date) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── notifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  related_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── open_shifts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_shifts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date   DATE        NOT NULL,
  start_time  TIME        NOT NULL,
  end_time    TIME        NOT NULL,
  role_needed TEXT,
  description TEXT,
  status      TEXT        NOT NULL DEFAULT 'open',
  filled_by   UUID        REFERENCES employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE open_shifts
  ADD COLUMN IF NOT EXISTS filled_assignment_id UUID REFERENCES shift_assignments(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE open_shifts ADD CONSTRAINT open_shifts_status_check
    CHECK (status IN ('open', 'filled', 'cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── employee_availability ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_availability (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_of_week  TEXT        NOT NULL,
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  is_available BOOLEAN     NOT NULL DEFAULT TRUE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE employee_availability ADD CONSTRAINT employee_availability_day_check
    CHECK (day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── shift_swap_requests ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id       UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requester_shift_id UUID        NOT NULL REFERENCES shift_assignments(id) ON DELETE CASCADE,
  target_id          UUID        REFERENCES employees(id) ON DELETE CASCADE,
  target_shift_id    UUID        REFERENCES shift_assignments(id) ON DELETE CASCADE,
  status             TEXT        NOT NULL DEFAULT 'pending',
  requester_note     TEXT,
  reviewer_note      TEXT,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE shift_swap_requests
  ADD COLUMN IF NOT EXISTS target_accepted_at TIMESTAMPTZ,  -- iki aşamalı onay: önce hedef çalışan
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── manual_time_correction_requests ─────────────────────────
CREATE TABLE IF NOT EXISTS manual_time_correction_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          UUID        NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  date                 DATE        NOT NULL,
  requested_start_time TIME        NOT NULL,
  requested_end_time   TIME        NOT NULL,
  reason               TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  reviewed_by          UUID        REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  reviewer_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE manual_time_correction_requests
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER;  -- NULL → yasal asgari mola uygulanır

DO $$ BEGIN
  ALTER TABLE manual_time_correction_requests ADD CONSTRAINT mtcr_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'direct')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE manual_time_correction_requests ADD CONSTRAINT mtcr_break_check
    CHECK (break_minutes IS NULL OR break_minutes BETWEEN 0 AND 240) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── attendance_records: konum denetim alanları ──────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS location_distance_m INTEGER,
  ADD COLUMN IF NOT EXISTS location_accuracy_m INTEGER;

-- ─── updated_at trigger'ları ─────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leave_requests', 'open_shifts', 'employee_availability',
    'shift_swap_requests', 'manual_time_correction_requests'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
        'trg_' || t || '_updated_at', t
      );
    END IF;
  END LOOP;
END $$;
