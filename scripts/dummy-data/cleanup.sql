-- ============================================================
-- ShiftUp — dummy veri TEMİZLİĞİ
-- Yalnızca public._dummy_seed içinde kayıtlı id'leri ve bunlara
-- uygulamanın sonradan bağladığı satırları siler. employees'a dokunmaz.
-- ============================================================
BEGIN;

CREATE TEMP TABLE _ds ON COMMIT DROP AS SELECT tbl, id FROM public._dummy_seed;
CREATE TEMP TABLE _ds_shift ON COMMIT DROP AS SELECT id::uuid AS id FROM _ds WHERE tbl = 'shift_assignments';

-- Bildirimler: dummy olanlar + uygulamanın dummy kayıtlar için ürettikleri (related_id)
DELETE FROM notifications
WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'notifications')
   OR related_id::text IN (SELECT id FROM _ds);

-- Audit log silmeye kapalı (immutable trigger) → yalnızca bu işlem için kapatılır
ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;
DELETE FROM audit_logs
WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'audit_logs')
   OR entity_id IN (SELECT id FROM _ds);
ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;

-- Takaslar: dummy olanlar + dummy vardiyalar üzerinden sonradan açılanlar
DELETE FROM shift_swap_requests
WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'shift_swap_requests')
   OR requester_shift_id IN (SELECT id FROM _ds_shift)
   OR target_shift_id IN (SELECT id FROM _ds_shift);

DELETE FROM open_shifts WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'open_shifts');
DELETE FROM manual_time_correction_requests WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'manual_time_correction_requests');

-- Devam: dummy kayıtlar + dummy vardiyalara sonradan okutulanlar (FK RESTRICT)
DELETE FROM attendance_records
WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'attendance_records')
   OR shift_assignment_id IN (SELECT id FROM _ds_shift);

DELETE FROM leave_requests        WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'leave_requests');
DELETE FROM employee_availability WHERE id::text IN (SELECT id FROM _ds WHERE tbl = 'employee_availability');
DELETE FROM shift_assignments     WHERE id IN (SELECT id FROM _ds_shift);

DROP TABLE public._dummy_seed;

COMMIT;
