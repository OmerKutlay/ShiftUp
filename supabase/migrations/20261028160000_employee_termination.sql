-- ============================================================
-- İşten ayrılış (offboarding)
--
--   employees.termination_date          son çalışma günü (dahil)
--   employees.termination_reason        SGK işten çıkış nedeninin sadeleştirilmiş kodu
--   employees.termination_note          serbest not
--   employees.terminated_by / _at       işlemi yapan yönetici ve zamanı
--   employees.termination_leave_balance çıkış tarihindeki kullanılmamış yıllık izin (gün; İş K. Md. 59 — bordro)
--   employees.termination_prev_active   işlemden önceki active değeri (geri almada kullanılır)
--
-- `active` anlamı: son çalışma günü geçtikten sonra false. Uygulama oturum / QR / giriş kontrollerinde
-- `termination_date < bugün` ise çalışanı zaten pasif sayar (bkz. src/lib/employment.ts); gece 00:15 cron'u
-- (Europe/Istanbul) kalıcı olarak active=false yapar, push aboneliklerini siler ve oturumları (auth.sessions,
-- bağlı refresh token'lar CASCADE ile) kapatır.
--
-- apply_employee_offboarding(): ayrılışın tüm yazma adımları TEK işlemde (transaction) yapılır; herhangi
-- bir adım hata verirse hiçbir şey değişmez.
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS termination_date          DATE,
  ADD COLUMN IF NOT EXISTS termination_reason        TEXT,
  ADD COLUMN IF NOT EXISTS termination_note          TEXT,
  ADD COLUMN IF NOT EXISTS terminated_by             UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS terminated_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS termination_leave_balance NUMERIC,
  ADD COLUMN IF NOT EXISTS termination_prev_active   BOOLEAN;

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

-- ─── Erişimi kapat: push abonelikleri + oturumlar ─────────────
-- employees.auth_user_id = auth.users.id = auth.sessions.user_id. Oturum satırları silinince
-- refresh token'lar da (FK ON DELETE CASCADE) silinir; mevcut access token ise en fazla JWT
-- süresi kadar (varsayılan 1 saat) geçerli kalır, uygulama tarafı ise her istekte aktifliği kontrol eder.
CREATE OR REPLACE FUNCTION public.revoke_employee_access(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.push_subscriptions WHERE employee_id = ANY (p_ids);
  BEGIN
    DELETE FROM auth.sessions
    WHERE user_id IN (SELECT e.auth_user_id FROM public.employees e WHERE e.id = ANY (p_ids) AND e.auth_user_id IS NOT NULL);
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    RAISE NOTICE 'auth.sessions temizlenemedi (%)', SQLERRM;
  END;
END $$;

REVOKE ALL ON FUNCTION public.revoke_employee_access(UUID[]) FROM PUBLIC, anon, authenticated;

-- Son çalışma günü geçenleri pasifleştirir; pasifleştirilen sayısını döner
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
  PERFORM public.revoke_employee_access(v_ids);
  RETURN array_length(v_ids, 1);
END $$;

REVOKE ALL ON FUNCTION public.apply_employee_terminations() FROM PUBLIC, anon, authenticated;

-- ─── Ayrılışı tek işlemde uygula ─────────────────────────────
-- Hata kodları (RAISE EXCEPTION mesajı): ALREADY_TERMINATED, NOT_FOUND, HAS_ATTENDANCE:<tarih>
-- Giriş/çıkış (attendance) kaydı olan vardiya ASLA silinmez/çevrilmez (attendance_records → vardiya CASCADE):
-- son günden sonra kaydı olan vardiya varsa işlem reddedilir.
-- Yalnızca bugün ve sonrası (izinli olmayan) vardiyalar açık vardiyaya çevrilebilir.
CREATE OR REPLACE FUNCTION public.apply_employee_offboarding(
  p_employee_id   UUID,
  p_actor_id      UUID,
  p_last_day      DATE,
  p_reason        TEXT,
  p_note          TEXT,
  p_leave_balance NUMERIC,
  p_convert       BOOLEAN,
  p_cancel_note   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today      DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_emp        public.employees%ROWTYPE;
  v_effective  BOOLEAN := p_last_day < v_today;
  v_conflict   DATE;
  v_leave      INT := 0;
  v_leave_fut  INT := 0;
  v_tc         INT := 0;
  v_swaps      JSONB := '[]'::jsonb;
  v_deleted    INT := 0;
  v_converted  INT := 0;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_emp.termination_date IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_TERMINATED'; END IF;

  SELECT min(sa.work_date) INTO v_conflict
  FROM public.shift_assignments sa
  WHERE sa.employee_id = p_employee_id AND sa.work_date > p_last_day
    AND EXISTS (SELECT 1 FROM public.attendance_records ar WHERE ar.shift_assignment_id = sa.id);
  IF v_conflict IS NOT NULL THEN RAISE EXCEPTION 'HAS_ATTENDANCE:%', v_conflict; END IF;

  UPDATE public.employees SET
    termination_date          = p_last_day,
    termination_reason        = p_reason,
    termination_note          = p_note,
    terminated_by             = p_actor_id,
    terminated_at             = now(),
    termination_leave_balance = p_leave_balance,
    termination_prev_active   = v_emp.active,
    active                    = CASE WHEN v_effective THEN false ELSE active END
  WHERE id = p_employee_id;

  -- Bekleyen talepler
  WITH u AS (
    UPDATE public.leave_requests
       SET status = 'rejected', reviewer_note = p_cancel_note, reviewed_by = p_actor_id, reviewed_at = now()
     WHERE employee_id = p_employee_id AND status = 'pending' RETURNING 1)
  SELECT count(*) INTO v_leave FROM u;

  WITH u AS (
    UPDATE public.leave_requests
       SET status = 'rejected', reviewer_note = p_cancel_note, reviewed_by = p_actor_id, reviewed_at = now()
     WHERE employee_id = p_employee_id AND status = 'approved' AND start_date > p_last_day RETURNING 1)
  SELECT count(*) INTO v_leave_fut FROM u;

  WITH u AS (
    UPDATE public.manual_time_correction_requests
       SET status = 'rejected', reviewer_note = p_cancel_note, reviewed_by = p_actor_id, reviewed_at = now()
     WHERE employee_id = p_employee_id AND status = 'pending' RETURNING 1)
  SELECT count(*) INTO v_tc FROM u;

  -- Takaslar (vardiya silinince bu satırlar zaten CASCADE ile gider; ayrıntı denetim kaydı için döner)
  WITH u AS (
    UPDATE public.shift_swap_requests
       SET status = 'cancelled', reviewer_note = p_cancel_note, reviewed_by = p_actor_id, reviewed_at = now()
     WHERE status = 'pending' AND (requester_id = p_employee_id OR target_id = p_employee_id)
     RETURNING id, requester_id, target_id, requester_shift_id, target_shift_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id, 'requester_id', u.requester_id, 'target_id', u.target_id,
      'requester_shift_date', (SELECT work_date FROM public.shift_assignments WHERE id = u.requester_shift_id),
      'target_shift_date',    (SELECT work_date FROM public.shift_assignments WHERE id = u.target_shift_id))), '[]'::jsonb)
    INTO v_swaps FROM u;

  -- Gelecek vardiyalar (tüm mağazalar). Kaydı olan vardiya yukarıda reddedildi.
  IF p_convert THEN
    INSERT INTO public.open_shifts (store_id, work_date, start_time, end_time, description, status)
    SELECT sa.store_id, sa.work_date, sa.start_time, sa.end_time, v_emp.full_name || ' işten ayrıldı', 'open'
    FROM public.shift_assignments sa
    WHERE sa.employee_id = p_employee_id AND sa.work_date > p_last_day
      AND sa.work_date >= v_today AND sa.is_on_leave IS NOT TRUE;
    GET DIAGNOSTICS v_converted = ROW_COUNT;
  END IF;

  WITH d AS (
    DELETE FROM public.shift_assignments
     WHERE employee_id = p_employee_id AND work_date > p_last_day RETURNING 1)
  SELECT count(*) INTO v_deleted FROM d;

  IF v_effective THEN
    PERFORM public.revoke_employee_access(ARRAY[p_employee_id]);
  END IF;

  RETURN jsonb_build_object(
    'shifts_deleted', v_deleted,
    'shifts_converted', v_converted,
    'leave_cancelled', v_leave + v_leave_fut,
    'time_corrections_cancelled', v_tc,
    'swaps', v_swaps,
    'deactivated_now', v_effective,
    'prev_active', v_emp.active);
END $$;

REVOKE ALL ON FUNCTION public.apply_employee_offboarding(UUID, UUID, DATE, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;

-- pg_cron UTC çalışır; Türkiye UTC+3 (kalıcı) → 00:15 İstanbul = 21:15 UTC
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('employee-terminations', '15 21 * * *', 'SELECT public.apply_employee_terminations()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); pasifleştirme yalnızca oturum kontrolüyle uygulanacak.', SQLERRM;
END $$;
