-- ============================================================
-- Mola bitiş hatırlatması — her mola ayrı değerlendirilir (20261026100100'ün yerine geçer).
--
-- Mağazadaki mola düzeni (planlanan mola, src/lib/workingTimeService.ts → plannedBreakForGrossMins):
--   60 dk  → tek 1 saatlik mola
--   90 dk  → 1 saat yemek + 30 dk mola (sıra değişebilir)
--   120 dk → birer saatlik iki mola
--
-- Hatırlatma, sürmekte olan TEK molanın 55. dakikasında gider (toplam molaya bakılmaz):
--   - Önce 30'luk mola yapılsa bile yemek molasının 25. dakikasında yanlış uyarı gitmez.
--   - 2 saatlik vardiyada iki saatlik molanın her birine ayrı hatırlatma gider.
-- 30'luk molaya hatırlatma gitmez: molanın hakkı (planlanan − önceki molalar) 45 dk'nın
-- altındaysa bu kısa moladır (ör. 90 dk planda 60'lık yemekten sonra kalan 30).
-- Kısa vardiyalarda (≤ 4 saat, 15 dk mola) da hak 45'in altında kaldığından gönderilmez.
--
-- Mola başına tek bildirim: aynı kayıt için bu mola başladıktan sonra oluşmuş bildirim varsa atlanır.
-- pg_cron işi (attendance-break-ending, dakikada bir) aynı kalır. İdempotent.
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
      ar.break_start_at,
      ar.completed_break_minutes,
      floor(extract(epoch FROM now() - ar.break_start_at) / 60)::int AS break_mins,
      -- Vardiya brüt süresi (dk); gece yarısını geçen vardiya ertesi güne taşınır
      (extract(epoch FROM (sa.end_time - sa.start_time)) / 60)::int
        + CASE WHEN sa.end_time <= sa.start_time THEN 1440 ELSE 0 END AS gross_mins
    FROM public.attendance_records ar
    JOIN public.shift_assignments sa ON sa.id = ar.shift_assignment_id
    WHERE ar.status::text = 'on_break'
      AND ar.break_start_at IS NOT NULL
      AND ar.break_end_at IS NULL
      AND ar.clock_out_at IS NULL
      AND ar.break_start_at > now() - make_interval(mins => p_limit_mins)
  ),
  planned AS (
    SELECT
      b.*,
      -- plannedBreakForGrossMins ile aynı tablo
      CASE
        WHEN b.gross_mins <= 0 THEN 0
        WHEN b.gross_mins <= 240 THEN 15
        WHEN b.gross_mins >= 660 THEN 120
        WHEN b.gross_mins >= 570 THEN 90
        ELSE 60
      END AS planned_mins
    FROM on_break b
  )
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT p.employee_id, 'attendance_break_ending', 'Molanız bitmek üzere',
         format('Molanızın bitmesine yaklaşık %s dakika kaldı. Hazır olduğunuzda dönüşünüzü okutmayı unutmayın, kolay gelsin!',
                p_limit_mins - p.break_mins),
         p.id, false
  FROM planned p
  WHERE p.break_mins >= p_limit_mins - p_warn_mins
    AND p.break_mins < p_limit_mins
    AND p.planned_mins - p.completed_break_minutes >= 45
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.related_id = p.id
        AND n.type::text = 'attendance_break_ending'
        AND n.created_at >= p.break_start_at
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.scan_break_ending(INT, INT) FROM PUBLIC, anon, authenticated;
