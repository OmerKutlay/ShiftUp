-- Çoklu mola desteği
-- break_start_at / break_end_at yalnızca SON molayı tutar. Yeni bir mola
-- başlatıldığında önceki molanın süresi bu kolona eklenir; böylece toplam mola
-- = completed_break_minutes + (break_end_at - break_start_at).
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS completed_break_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (completed_break_minutes >= 0);
