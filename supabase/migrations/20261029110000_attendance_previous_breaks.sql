-- ============================================================
-- Önceki molaların saatleri — çalışan QR ekranında molalarını ayrı ayrı görür.
--
-- break_start_at / break_end_at son molayı, completed_break_minutes önceki molaların toplamını
-- tutar (hesaplar değişmez). Yeni mola başlarken biten mola [{start_at, end_at}] olarak buraya
-- eklenir; yalnızca gösterim içindir. İdempotent.
-- ============================================================

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS previous_breaks JSONB NOT NULL DEFAULT '[]'::jsonb;
