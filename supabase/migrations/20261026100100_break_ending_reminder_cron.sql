-- ============================================================
-- Mola bitiş hatırlatması: molada olan çalışanın toplam molası 1 saate 5 dakika kala
-- kendisine nazik bir bildirim gider (push: trg_notifications_push_fanout, 20261016100000).
--
-- Toplam mola = completed_break_minutes (önceki molalar) + şu anki molanın süresi
-- (bkz. src/lib/attendanceDurations.ts → totalBreakMinutes). Kayıt başına tek bildirim:
-- toplam yalnızca artar, eşiği bir kez geçer. Eşik geçildiğinde (toplam ≥ 60 dk) artık
-- "bitmek üzere" denmez — pencere [limit - uyarı, limit).
--
-- pg_cron dakikada bir çalıştırır. İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE OR REPLACE FUNCTION public.scan_break_ending(
  p_limit_mins INT DEFAULT 60,
  p_warn_mins  INT DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows INT;
BEGIN
  WITH on_break AS (
    SELECT
      ar.id,
      ar.employee_id,
      ar.completed_break_minutes
        + floor(extract(epoch FROM now() - ar.break_start_at) / 60)::int AS total_mins
    FROM public.attendance_records ar
    WHERE ar.status::text = 'on_break'
      AND ar.break_start_at IS NOT NULL
      AND ar.break_end_at IS NULL
      AND ar.clock_out_at IS NULL
      AND ar.break_start_at > now() - make_interval(mins => p_limit_mins)
  )
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT b.employee_id, 'attendance_break_ending', 'Molanız bitmek üzere',
         format('Molanızın bitmesine yaklaşık %s dakika kaldı. Hazır olduğunuzda dönüşünüzü okutmayı unutmayın, kolay gelsin!',
                p_limit_mins - b.total_mins),
         b.id, false
  FROM on_break b
  WHERE b.total_mins >= p_limit_mins - p_warn_mins
    AND b.total_mins < p_limit_mins
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.related_id = b.id AND n.type::text = 'attendance_break_ending'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.scan_break_ending(INT, INT) FROM PUBLIC, anon, authenticated;

-- ─── pg_cron: dakikada bir ───────────────────────────────────
-- Aynı adla cron.schedule mevcut işi günceller. pg_cron yoksa migration yine de başarılı olur.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'attendance-break-ending',
    '* * * * *',
    'SELECT public.scan_break_ending()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); mola bitiş hatırlatması gönderilmeyecek.', SQLERRM;
END $$;
