-- ============================================================
-- Vardiya hatırlatması veritabanında (pg_cron) üretilir; eski shift-reminder Edge Function'ın yerine geçer.
--
-- Eski fonksiyon (repoda yoktu, yalnızca canlıda kuruluydu) vardiya saatini (Türkiye yerel TIME)
-- UTC saatle karşılaştırıyordu: hatırlatma vardiya başladıktan ~1 sa 50 dk SONRA, ertesi günün
-- vardiyası için ise bir önceki gün gidiyordu. Ayrıca izinli vardiyaları ve pasif çalışanları
-- atlamıyor, gece yarısı penceresini kaçırıyordu.
--
-- public.scan_shift_reminders(): başlamasına 5–60 dk kalan vardiyanın sahibine tek hatırlatma
-- (push: trg_notifications_push_fanout, 20261016100000). Atlananlar: izinli vardiya, pasif
-- çalışan, girişi zaten okutulmuş vardiya. Vardiya başına tek bildirim (NOT EXISTS + tekil indeksler).
-- pg_cron 5 dakikada bir çalıştırır (aynı iş adı `shift-reminder-job` güncellenir). İdempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.scan_shift_reminders(
  p_lead_mins INT DEFAULT 60,
  p_min_mins  INT DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows INT;
BEGIN
  WITH upcoming AS (
    SELECT
      sa.id,
      sa.employee_id,
      sa.start_time,
      sa.end_time,
      (sa.work_date + sa.start_time) AT TIME ZONE 'Europe/Istanbul' AS starts_at
    FROM public.shift_assignments sa
    JOIN public.employees e ON e.id = sa.employee_id
    WHERE sa.work_date IN (
        (now() AT TIME ZONE 'Europe/Istanbul')::date,
        (now() AT TIME ZONE 'Europe/Istanbul')::date + 1
      )
      AND sa.is_on_leave IS NOT TRUE
      AND e.active IS NOT FALSE
  )
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT u.employee_id, 'shift_reminder', 'Vardiyanız yaklaşıyor',
         format('Vardiyanız %s dakika sonra başlıyor (%s–%s). Girişte QR''ı okutmayı unutmayın.',
                ceil(extract(epoch FROM u.starts_at - now()) / 60)::int,
                left(u.start_time::text, 5),
                left(u.end_time::text, 5)),
         u.id, false
  FROM upcoming u
  WHERE u.starts_at > now() + make_interval(mins => p_min_mins)
    AND u.starts_at <= now() + make_interval(mins => p_lead_mins)
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.shift_assignment_id = u.id AND ar.clock_in_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.related_id = u.id AND n.type::text = 'shift_reminder'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.scan_shift_reminders(INT, INT) FROM PUBLIC, anon, authenticated;

-- ─── pg_cron: 5 dakikada bir ─────────────────────────────────
-- Aynı adla cron.schedule mevcut işi (Edge Function'a pg_net isteği) bu komutla değiştirir.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'shift-reminder-job',
    '*/5 * * * *',
    'SELECT public.scan_shift_reminders()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); vardiya hatırlatması gönderilmeyecek.', SQLERRM;
END $$;
