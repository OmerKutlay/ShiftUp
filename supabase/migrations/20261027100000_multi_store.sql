-- ============================================================
-- Çoklu mağaza desteği
--
-- Model:
--   stores                    → mağaza (ad, aktiflik)
--   employees.store_id        → çalışanın (tek) ana mağazası. Admin şirket genelidir; kendi
--                               ana mağazası olsa da uygulamada mağaza seçerek tümüne erişir.
--   shift_assignments.store_id→ vardiyanın yapıldığı mağaza. Çalışan başka mağazaya geçince
--                               geçmiş vardiyaları ait oldukları mağazada kalır. Verilmezse
--                               çalışanın mağazası yazılır (trigger).
--   shift_templates / open_shifts / store_locations → mağazaya özel
--   qr_tokens.store_id        → kiosk kodu mağaza başına bir tane (kişiye bağlı kodlarda NULL)
--   public_holidays.store_id  → NULL = ulusal (tüm mağazalar), dolu = o mağazanın yerel tatili
--   audit_logs.store_id       → kaydın ait olduğu mağaza (Ayarlar › Denetim kaydı filtresi)
--
-- İzin, mesai düzeltme, takas, uygunluk ve bildirimler çalışana bağlıdır; mağazaları
-- çalışanın mağazasından okunur.
--
-- Mevcut veri tek mağazaya aittir: hepsi "ana mağaza"ya (sabit UUID) taşınır. Adı, aktif
-- mağaza konumu kaydının adından alınır.
--
-- Kiosk QR Realtime kanalı mağaza başına ayrılır: "kiosk-qr:<store_id>".
-- ============================================================

-- ─── stores ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stores (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_name_lower ON public.stores (lower(btrim(name)));

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stores FROM anon, authenticated;

-- Ana mağaza: mevcut tüm veri buna aittir
INSERT INTO public.stores (id, name)
SELECT
  '00000000-0000-0000-0003-000000000001',
  COALESCE(
    (SELECT btrim(name) FROM public.store_locations WHERE active ORDER BY created_at LIMIT 1),
    'Ana Mağaza'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── store_id kolonları + veri taşıma ─────────────────────────
ALTER TABLE public.employees         ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
ALTER TABLE public.shift_assignments ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
ALTER TABLE public.shift_templates   ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
ALTER TABLE public.open_shifts       ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
ALTER TABLE public.store_locations   ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT;
ALTER TABLE public.qr_tokens         ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.public_holidays   ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;
ALTER TABLE public.audit_logs        ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL;

UPDATE public.employees         SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
UPDATE public.shift_assignments SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
UPDATE public.shift_templates   SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
UPDATE public.open_shifts       SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
UPDATE public.store_locations   SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
-- Kiosk kodları (kişiye bağlı olmayanlar) ana mağazanındır
UPDATE public.qr_tokens         SET store_id = '00000000-0000-0000-0003-000000000001'
  WHERE store_id IS NULL AND employee_id IS NULL;

-- Denetim kaydı normalde değiştirilemez; yalnızca mağaza bilgisini doldurmak için trigger
-- bu işlem süresince kapatılır (aynı transaction'da yeniden açılır).
ALTER TABLE public.audit_logs DISABLE TRIGGER trg_audit_logs_immutable;
UPDATE public.audit_logs SET store_id = '00000000-0000-0000-0003-000000000001' WHERE store_id IS NULL;
ALTER TABLE public.audit_logs ENABLE TRIGGER trg_audit_logs_immutable;

ALTER TABLE public.employees         ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.shift_assignments ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.shift_templates   ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.open_shifts       ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.store_locations   ALTER COLUMN store_id SET NOT NULL;

-- Kiosk kodunun mağazası zorunludur
DO $$ BEGIN
  ALTER TABLE public.qr_tokens ADD CONSTRAINT qr_tokens_kiosk_store_check
    CHECK (employee_id IS NOT NULL OR store_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_employees_store             ON public.employees (store_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_store_date ON public.shift_assignments (store_id, work_date);
CREATE INDEX IF NOT EXISTS idx_open_shifts_store_status    ON public.open_shifts (store_id, status, work_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_store_created    ON public.audit_logs (store_id, created_at DESC);

-- ─── Vardiya mağazası: verilmezse çalışanın mağazası ─────────
CREATE OR REPLACE FUNCTION public.shift_assignments_default_store()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    SELECT e.store_id INTO NEW.store_id FROM public.employees e WHERE e.id = NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shift_assignments_default_store ON public.shift_assignments;
CREATE TRIGGER trg_shift_assignments_default_store
  BEFORE INSERT ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.shift_assignments_default_store();

-- ─── Vardiya şablonu adı mağaza içinde tekil ─────────────────
ALTER TABLE public.shift_templates DROP CONSTRAINT IF EXISTS uq_shift_template_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_template_store_name ON public.shift_templates (store_id, name);

-- ─── Mağaza konumu: mağaza başına tek aktif konum ────────────
-- Birden çok aktif kayıt varsa en yenisi aktif kalır
UPDATE public.store_locations sl SET active = FALSE
WHERE sl.active AND EXISTS (
  SELECT 1 FROM public.store_locations o
  WHERE o.store_id = sl.store_id AND o.active AND o.id <> sl.id
    AND (o.created_at, o.id) > (sl.created_at, sl.id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_locations_one_active
  ON public.store_locations (store_id) WHERE active;

-- ─── Kiosk QR: mağaza başına tek aktif kod ───────────────────
DROP INDEX IF EXISTS public.qr_tokens_one_active_kiosk;
CREATE UNIQUE INDEX IF NOT EXISTS qr_tokens_one_active_kiosk_per_store
  ON public.qr_tokens (store_id)
  WHERE employee_id IS NULL AND used_at IS NULL;

-- ─── Resmi tatiller: ulusal (store_id NULL) + mağazaya özel ──
-- Birincil anahtar tarihten id'ye taşınır; aynı gün hem ulusal hem yerel kayıt olmaz,
-- tekillik iki kısmi indeksle sağlanır.
ALTER TABLE public.public_holidays ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.public_holidays'::regclass AND c.contype = 'p' AND a.attname = 'date'
  ) THEN
    ALTER TABLE public.public_holidays DROP CONSTRAINT public_holidays_pkey;
    ALTER TABLE public.public_holidays ADD CONSTRAINT public_holidays_pkey PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_public_holidays_national
  ON public.public_holidays (date) WHERE store_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_public_holidays_store
  ON public.public_holidays (store_id, date) WHERE store_id IS NOT NULL;

-- ─── Kiosk Realtime kanalı: mağaza başına ────────────────────
-- Konu "kiosk-qr:<store_id>". Katılabilenler: o mağazanın aktif Kiosk / Yönetici+ hesabı
-- veya herhangi bir aktif Admin (şirket geneli).
CREATE OR REPLACE FUNCTION public.can_view_kiosk_qr_topic(p_topic TEXT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store UUID;
BEGIN
  IF p_topic IS NULL
     OR p_topic !~ '^kiosk-qr:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_store := substring(p_topic FROM 10)::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.active
      AND (
        r.access_level = 'admin'
        OR (e.store_id = v_store AND r.access_level IN ('kiosk', 'manager', 'store_manager'))
      )
  );
END $$;
REVOKE ALL ON FUNCTION public.can_view_kiosk_qr_topic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_kiosk_qr_topic(TEXT) TO authenticated;

DROP POLICY IF EXISTS kiosk_qr_receive ON realtime.messages;
CREATE POLICY kiosk_qr_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT public.can_view_kiosk_qr_topic((SELECT realtime.topic())))
  );

-- Eski tek kanallı fonksiyon artık kullanılmıyor
DROP FUNCTION IF EXISTS public.can_view_kiosk_qr();

-- get_employee_by_auth_uid search_path'siz ve PUBLIC'e açık kalmıştı; kod kullanmıyor
DROP FUNCTION IF EXISTS public.get_employee_by_auth_uid(UUID);

-- ─── Okutulmamış giriş/çıkış: yalnızca o mağazanın yöneticileri + adminler ──
-- Dönüş tipi değiştiği (store_id eklendi) için fonksiyon yeniden oluşturulur.
DROP FUNCTION IF EXISTS public.missed_attendance_candidates(INT, INT);
CREATE FUNCTION public.missed_attendance_candidates(
  p_missed_in_mins  INT,
  p_missed_out_mins INT
)
RETURNS TABLE (shift_id UUID, employee_id UUID, store_id UUID, kind TEXT, message_subject TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT
      sa.id,
      sa.employee_id,
      sa.store_id,
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
    a.store_id,
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

-- Uyarıyı vardiyanın mağazasındaki aktif yöneticilere (store_manager / manager) ve tüm aktif
-- adminlere bildirir; eklenen bildirim sayısını döner.
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
    SELECT e.id, e.store_id, r.access_level FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.active AND r.access_level IN ('admin', 'store_manager', 'manager')
  ) m ON m.id <> a.employee_id AND (m.access_level = 'admin' OR m.store_id = a.store_id)
  WHERE a.kind = 'in'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT m.id, 'attendance_missed_clock_out', 'Çıkış okutulmadı',
         a.message_subject || ' vardiyası bitti ancak çıkış QR''ı okutulmadı.', a.shift_id, false
  FROM public.missed_attendance_candidates(p_missed_in_mins, p_missed_out_mins) a
  JOIN (
    SELECT e.id, e.store_id, r.access_level FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.active AND r.access_level IN ('admin', 'store_manager', 'manager')
  ) m ON m.id <> a.employee_id AND (m.access_level = 'admin' OR m.store_id = a.store_id)
  WHERE a.kind = 'out'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.missed_attendance_candidates(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_missed_attendance(INT, INT) FROM PUBLIC, anon, authenticated;
