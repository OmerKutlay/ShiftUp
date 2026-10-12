-- ============================================================
-- Veri bütünlüğü: tekil kısıtlar, CHECK'ler, FK silme davranışı, indeksler.
--
-- Mevcut veride kısıtı ihlal eden satırlar olabilir (ör. eski bir hata yüzünden aynı
-- vardiyada iki devam kaydı). Bu migration HİÇBİR VERİYİ SİLMEZ:
--   - Tekil indeksler yalnızca çakışma yoksa oluşturulur; varsa WARNING basılır ve
--     ilgili satırlar elle incelenmelidir (sorgular aşağıda).
--   - CHECK kısıtları NOT VALID eklenir: yeni yazmaları denetler, eski satırlara dokunmaz.
-- ============================================================

-- ─── attendance_records: vardiya başına tek kayıt ────────────
-- Çıkıştan sonra ikinci giriş kaydı açılabiliyordu; artık tek kayıt.
DO $$
BEGIN
  IF EXISTS (
    SELECT shift_assignment_id FROM attendance_records
    GROUP BY shift_assignment_id HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'attendance_records: aynı vardiyada birden çok kayıt var — uq_attendance_one_per_shift OLUŞTURULMADI. '
      'İnceleyin: SELECT shift_assignment_id, COUNT(*) FROM attendance_records GROUP BY 1 HAVING COUNT(*) > 1;';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_one_per_shift ON attendance_records(shift_assignment_id);
    DROP INDEX IF EXISTS idx_one_active_per_shift;           -- yerini tam tekil indeks aldı
    DROP INDEX IF EXISTS idx_attendance_records_shift_assignment_id;
  END IF;
END $$;

-- ─── shift_assignments: çalışan başına günde tek vardiya ─────
DO $$
BEGIN
  IF EXISTS (
    SELECT employee_id, work_date FROM shift_assignments
    GROUP BY employee_id, work_date HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'shift_assignments: aynı gün birden çok vardiyası olan çalışan var — uq_shift_employee_day OLUŞTURULMADI. '
      'İnceleyin: SELECT employee_id, work_date, COUNT(*) FROM shift_assignments GROUP BY 1,2 HAVING COUNT(*) > 1;';
    CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee_date ON shift_assignments(employee_id, work_date);
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_employee_day ON shift_assignments(employee_id, work_date);
  END IF;
END $$;
DROP INDEX IF EXISTS idx_shift_assignments_employee_id;  -- (employee_id, work_date) indeksi kapsar

-- ─── CHECK kısıtları (yeni yazmalar için) ─────────────────────
DO $$ BEGIN
  ALTER TABLE shift_assignments ADD CONSTRAINT shift_assignments_times_check
    CHECK (start_time <> end_time) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE attendance_records ADD CONSTRAINT attendance_clock_order_check
    CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE attendance_records ADD CONSTRAINT attendance_break_order_check
    CHECK (break_end_at IS NULL OR break_start_at IS NULL OR break_end_at >= break_start_at) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE open_shifts ADD CONSTRAINT open_shifts_times_check
    CHECK (start_time <> end_time) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── FK silme davranışı: geçmiş veriler kaskadla silinmesin ──
-- Önceden çalışan silinince tüm vardiya + puantaj geçmişi, vardiya silinince devam
-- kaydı sessizce siliniyordu. Artık RESTRICT: geçmişi olan kayıt silinemez
-- (API 409 döner ve pasifleştirmeyi önerir).
CREATE OR REPLACE FUNCTION pg_temp.replace_fk(
  p_table TEXT, p_column TEXT, p_ref_table TEXT, p_on_delete TEXT
) RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = p_table::regclass
      AND att.attname = p_column
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, c);
  END LOOP;
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
    p_table, p_table || '_' || p_column || '_fkey', p_column, p_ref_table, p_on_delete
  );
END $fn$;

SELECT pg_temp.replace_fk('shift_assignments', 'employee_id', 'employees', 'RESTRICT');
SELECT pg_temp.replace_fk('attendance_records', 'employee_id', 'employees', 'RESTRICT');
SELECT pg_temp.replace_fk('attendance_records', 'shift_assignment_id', 'shift_assignments', 'RESTRICT');
SELECT pg_temp.replace_fk('leave_requests', 'employee_id', 'employees', 'RESTRICT');
SELECT pg_temp.replace_fk('manual_time_correction_requests', 'employee_id', 'employees', 'RESTRICT');

-- ─── İzin çakışması: aynı çalışanın bekleyen/onaylı izinleri örtüşemez ─
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$
BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_no_overlap
    EXCLUDE USING gist (
      employee_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('pending', 'approved'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN exclusion_violation THEN
    RAISE WARNING 'leave_requests: örtüşen bekleyen/onaylı izinler var — leave_requests_no_overlap OLUŞTURULMADI.';
END $$;

-- ─── Mesai düzeltme: çalışan+gün başına tek bekleyen talep ──
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_mtcr_pending_per_day
    ON manual_time_correction_requests(employee_id, date) WHERE status = 'pending';
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'manual_time_correction_requests: aynı gün için birden çok bekleyen talep var — uq_mtcr_pending_per_day OLUŞTURULMADI.';
END $$;

-- ─── E-posta: büyük/küçük harf duyarsız tekil ────────────────
UPDATE employees SET email = lower(trim(email)) WHERE email IS NOT NULL AND email <> lower(trim(email));
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_email_lower ON employees (lower(email));
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'employees: büyük/küçük harf farkıyla aynı e-posta tekrarlanıyor — uq_employees_email_lower OLUŞTURULMADI.';
END $$;
DO $$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_email_lower_check
    CHECK (email IS NULL OR email = lower(email)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP INDEX IF EXISTS idx_employees_email;  -- UNIQUE(email) + lower(email) indeksi kapsar

-- ─── İndeksler (sık kullanılan filtreler) ────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_employee_clock_in ON attendance_records(employee_id, clock_in_at);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp_status_dates ON leave_requests(employee_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status_created ON leave_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_emp_read_created ON notifications(employee_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type_related ON notifications(type, related_id);
CREATE INDEX IF NOT EXISTS idx_open_shifts_status_date ON open_shifts(status, work_date);
CREATE INDEX IF NOT EXISTS idx_availability_employee ON employee_availability(employee_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_requester_shift ON shift_swap_requests(requester_shift_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_target_shift ON shift_swap_requests(target_shift_id);
CREATE INDEX IF NOT EXISTS idx_mtcr_employee_date ON manual_time_correction_requests(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_mtcr_status ON manual_time_correction_requests(status);
DROP INDEX IF EXISTS idx_qr_tokens_token;  -- token UNIQUE kısıtının indeksiyle aynı

-- ─── Bildirim tekrarını önleyen tekil indeks ─────────────────
-- Hatırlatma ve devam uyarıları aynı vardiya için bir kez gönderilir (kod 23505'i yutar).
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
    ON notifications(employee_id, type, related_id)
    WHERE type IN (
      'shift_reminder',
      'attendance_late_clock_in', 'attendance_late_clock_out',
      'attendance_missed_clock_in', 'attendance_missed_clock_out'
    );
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'notifications: tekrarlanan uyarı bildirimleri var — uq_notifications_dedupe OLUŞTURULMADI.';
END $$;
