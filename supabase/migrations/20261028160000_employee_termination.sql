-- ============================================================
-- İşten ayrılış (offboarding)
--
--   employees.termination_date          son çalışma günü (dahil)
--   employees.termination_reason        SGK işten çıkış nedeninin sadeleştirilmiş kodu
--   employees.termination_note          serbest not
--   employees.terminated_by / _at       işlemi yapan yönetici ve zamanı
--   employees.termination_leave_balance çıkış tarihindeki kullanılmamış yıllık izin (gün; İş K. Md. 59 — bordro)
--
-- `active` anlamı: son çalışma günü geçtikten sonra false. Uygulama oturum / QR / giriş kontrollerinde
-- `termination_date < bugün` ise çalışanı zaten pasif sayar (bkz. src/lib/employment.ts); bu cron
-- gece 00:15'te (Europe/Istanbul) kalıcı olarak active=false yapar ve push aboneliklerini siler.
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS termination_date          DATE,
  ADD COLUMN IF NOT EXISTS termination_reason        TEXT,
  ADD COLUMN IF NOT EXISTS termination_note          TEXT,
  ADD COLUMN IF NOT EXISTS terminated_by             UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS terminated_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termination_leave_balance NUMERIC;

DO $$ BEGIN
  ALTER TABLE public.employees ADD CONSTRAINT employees_termination_reason_check
    CHECK (termination_reason IS NULL OR termination_reason IN (
      'istifa', 'isveren_feshi', 'deneme_suresi', 'emeklilik',
      'karsilikli_anlasma', 'sozlesme_sonu', 'vefat', 'diger'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ayrılış tarihi varsa neden de olmalı (ve tersi)
DO $$ BEGIN
  ALTER TABLE public.employees ADD CONSTRAINT employees_termination_consistent_check
    CHECK ((termination_date IS NULL) = (termination_reason IS NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_employees_termination_date
  ON public.employees (termination_date) WHERE termination_date IS NOT NULL;

-- Son çalışma günü geçenleri pasifleştirir, push aboneliklerini siler; pasifleştirilen sayısını döner
CREATE OR REPLACE FUNCTION public.apply_employee_terminations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_ids   UUID[];
BEGIN
  SELECT array_agg(e.id) INTO v_ids
  FROM public.employees e
  WHERE e.active AND e.termination_date IS NOT NULL AND e.termination_date < v_today;

  IF v_ids IS NULL THEN RETURN 0; END IF;

  UPDATE public.employees SET active = false WHERE id = ANY (v_ids);
  DELETE FROM public.push_subscriptions WHERE employee_id = ANY (v_ids);
  RETURN array_length(v_ids, 1);
END $$;

REVOKE ALL ON FUNCTION public.apply_employee_terminations() FROM PUBLIC, anon, authenticated;

-- pg_cron UTC çalışır; Türkiye UTC+3 (kalıcı) → 00:15 İstanbul = 21:15 UTC
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('employee-terminations', '15 21 * * *', 'SELECT public.apply_employee_terminations()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); pasifleştirme yalnızca oturum kontrolüyle uygulanacak.', SQLERRM;
END $$;
