-- ============================================================
-- Enum değerlerini kodla eşitle.
--
-- Canlı veritabanında notifications.type bir enum (notification_type) ve uygulamanın
-- gönderdiği bildirim tiplerinin çoğunu içermiyordu (ör. geç/eksik okutma uyarıları,
-- mesai düzeltme, takas ve açık vardiya bildirimleri) — bu bildirimler kaydedilemiyordu.
--
-- Yeni enum değerleri aynı transaction'da kullanılamaz; bu yüzden ayrı bir migration'dır
-- ve onları kullanan indeksler sonraki migration'lardadır. Sıfırdan kurulumda kolon TEXT
-- olduğundan (enum yoksa) bu migration hiçbir şey yapmaz.
-- ============================================================
DO $$
DECLARE v TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    FOREACH v IN ARRAY ARRAY[
      'shift_reminder', 'leave_submitted', 'leave_approved', 'leave_rejected', 'attendance_override',
      'open_shift_available', 'open_shift_claimed',
      'time_correction_submitted', 'time_correction_approved', 'time_correction_rejected',
      'shift_swap_submitted', 'shift_swap_approved', 'shift_swap_rejected',
      'attendance_late_clock_in', 'attendance_late_clock_out',
      'attendance_missed_clock_in', 'attendance_missed_clock_out'
    ] LOOP
      EXECUTE format('ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS %L', v);
    END LOOP;
  END IF;
END $$;
