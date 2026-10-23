-- ============================================================
-- Okutulmamış giriş/çıkış taraması veritabanında (pg_cron) çalışır.
--
-- Önceden tarama yalnızca bir yönetici uygulamayı açıp GET /api/notifications çağırdığında
-- (scanMissedAttendanceThrottled) tetikleniyordu: uygulama kapalıyken "giriş okutulmadı" /
-- "çıkış okutulmadı" bildirimi hiç oluşmuyor, dolayısıyla push da gitmiyordu. Uygulama
-- açılınca tarama çalışıp bildirimler birden düşüyordu.
--
-- Artık pg_cron 2 dakikada bir public.scan_missed_attendance() çalıştırır; eklenen
-- bildirimler trg_notifications_push_fanout ile (20261016100000) push olarak gider.
-- Mantık src/lib/attendanceAlerts.ts → findMissedAttendance / scanMissedAttendance ile aynıdır
-- (eşikler varsayılan 30 dk; ATT_MISSED_CLOCK_*_MINS değiştirilirse cron komutu da güncellenmeli).
-- Uygulamadaki tarama yedek olarak kalır; uq_notifications_dedupe + mevcut kayıt kontrolü
-- aynı vardiya için ikinci bildirimi engeller.
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

-- Gönderilmesi gereken uyarılar (dün + bugün, son 24 saatte başlamış vardiyalar)
CREATE OR REPLACE FUNCTION public.missed_attendance_candidates(
  p_missed_in_mins  INT,
  p_missed_out_mins INT
)
RETURNS TABLE (shift_id UUID, employee_id UUID, kind TEXT, message_subject TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT
      sa.id,
      sa.employee_id,
      sa.work_date,
      sa.start_time,
      sa.end_time,
      COALESCE(e.full_name, 'Çalışan') AS full_name,
      (sa.work_date + sa.start_time) AT TIME ZONE 'Europe/Istanbul' AS starts_at,
      (sa.work_date + sa.end_time)   AT TIME ZONE 'Europe/Istanbul' AS ends_raw
    FROM public.shift_assignments sa
    JOIN public.employees e ON e.id = sa.employee_id
    WHERE sa.work_date IN (
        (now() AT TIME ZONE 'Europe/Istanbul')::date - 1,
        (now() AT TIME ZONE 'Europe/Istanbul')::date
      )
      AND sa.is_on_leave IS NOT TRUE
      AND e.active IS NOT FALSE
  ),
  shifts AS (
    SELECT
      b.*,
      -- Gece yarısını geçen vardiyada bitiş ertesi gündür
      CASE WHEN b.ends_raw <= b.starts_at THEN b.ends_raw + INTERVAL '1 day' ELSE b.ends_raw END AS ends_at,
      EXISTS (SELECT 1 FROM public.attendance_records ar
              WHERE ar.shift_assignment_id = b.id AND ar.clock_in_at IS NOT NULL)  AS has_in,
      EXISTS (SELECT 1 FROM public.attendance_records ar
              WHERE ar.shift_assignment_id = b.id AND ar.clock_out_at IS NOT NULL) AS has_out
    FROM base b
    WHERE now() - b.starts_at <= INTERVAL '1 day'
  ),
  alerts AS (
    SELECT
      s.*,
      CASE
        WHEN NOT s.has_in AND now() > s.starts_at + make_interval(mins => p_missed_in_mins) THEN 'in'
        WHEN s.has_in AND NOT s.has_out AND now() > s.ends_at + make_interval(mins => p_missed_out_mins) THEN 'out'
      END AS kind
    FROM shifts s
  )
  SELECT
    a.id,
    a.employee_id,
    a.kind,
    -- "Ad Soyad, 23 Ekim 09:00–18:00" (attendanceAlerts.ts → shiftLabel)
    format('%s, %s %s %s–%s',
      a.full_name,
      extract(day FROM a.work_date)::int,
      (ARRAY['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'])
        [extract(month FROM a.work_date)::int],
      left(a.start_time::text, 5),
      left(a.end_time::text, 5))
  FROM alerts a
  WHERE a.kind IS NOT NULL
    -- Aynı vardiya + tip için daha önce bildirim gittiyse tekrar gönderilmez
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.related_id = a.id
        AND n.type::text = CASE a.kind WHEN 'in' THEN 'attendance_missed_clock_in' ELSE 'attendance_missed_clock_out' END
    );
$$;

-- Uyarıları aktif yöneticilere (admin / store_manager / manager) bildirir; eklenen bildirim sayısını döner.
-- Tip başına tek INSERT: notification_type canlıda enum olduğundan tip sabit literal olarak yazılır,
-- push tetikleyicisi de ifade başına tek istek gönderir.
CREATE OR REPLACE FUNCTION public.scan_missed_attendance(
  p_missed_in_mins  INT DEFAULT 30,
  p_missed_out_mins INT DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows  INT;
  v_total INT := 0;
BEGIN
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT m.id, 'attendance_missed_clock_in', 'Giriş okutulmadı',
         a.message_subject || ' vardiyası için henüz giriş QR''ı okutmadı.', a.shift_id, false
  FROM public.missed_attendance_candidates(p_missed_in_mins, p_missed_out_mins) a
  JOIN (
    SELECT e.id FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.active AND r.access_level IN ('admin', 'store_manager', 'manager')
  ) m ON m.id <> a.employee_id
  WHERE a.kind = 'in'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT m.id, 'attendance_missed_clock_out', 'Çıkış okutulmadı',
         a.message_subject || ' vardiyası bitti ancak çıkış QR''ı okutulmadı.', a.shift_id, false
  FROM public.missed_attendance_candidates(p_missed_in_mins, p_missed_out_mins) a
  JOIN (
    SELECT e.id FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.active AND r.access_level IN ('admin', 'store_manager', 'manager')
  ) m ON m.id <> a.employee_id
  WHERE a.kind = 'out'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.missed_attendance_candidates(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_missed_attendance(INT, INT) FROM PUBLIC, anon, authenticated;

-- ─── pg_cron: 2 dakikada bir ─────────────────────────────────
-- Aynı adla cron.schedule mevcut işi günceller. pg_cron yoksa migration yine de başarılı olur.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'attendance-missed-scan',
    '*/2 * * * *',
    'SELECT public.scan_missed_attendance()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); okutulmamış giriş/çıkış taraması yalnızca uygulamadan tetiklenecek.', SQLERRM;
END $$;
