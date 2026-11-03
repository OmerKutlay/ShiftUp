-- ============================================================
-- Tekrarlayan haftalık tatil
--
-- Yönetici bir çalışanın bir gününü "her hafta tatil" yapınca bir kural (recurring_weekly_rests) açılır ve
-- kuralın günleri sonraki haftalar için gerçek weekly_rest izin kayıtları olarak yazılır (recurrence_id ile
-- kurala bağlı). Böylece plan, puantaj, bordro, otomatik plan ve hatırlatmalar tekrarlayan tatili tek
-- günlük tatil gibi görür; hiçbirinin kuralı ayrıca bilmesi gerekmez.
--
--   - Ufuk: bugünden itibaren 182 gün (26 hafta). Gece cron'u ufku her gün ileri taşır.
--   - materialized_until: kuralın en son işlenen günü. Üretim yalnızca bu günden SONRASI için yapılır;
--     böylece yöneticinin tek tek kaldırdığı ("yalnızca bu gün") tekrarlar geri gelmez.
--   - Zaten vardiyası ya da bekleyen/onaylı izni olan günler atlanır: önceden yapılmış planın üstüne yazılmaz.
--   - İşe giriş öncesi / son çalışma günü sonrası günlere yazılmaz; pasif çalışana üretim duraklar.
--   - Çalışan başka mağazaya geçer ya da işten ayrılırsa kural kapanır, bugünden sonraki tekrarları silinir.
--   - end_recurring_weekly_rest(): "bu ve sonraki haftalar" — verilen günden itibaren tekrarları siler,
--     kuralı bir önceki günde bitirir (ilk günden siliniyorsa kural tamamen kalkar).
--   - restore_recurring_weekly_rests(): çalışanın izin talebi reddedilir / silinirse, talebe yer açmak için
--     kaldırılan tekrarları (bugün ve sonrası) geri yazar.
--
-- Servis rolü dışında erişim yok: RLS açık, politika yok; fonksiyonlar yalnızca service_role'e açık.
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recurring_weekly_rests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  employee_id        UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  weekday            SMALLINT    NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- EXTRACT(DOW): 0 = Pazar
  start_date         DATE        NOT NULL,
  end_date           DATE,                                                    -- NULL → süresiz
  materialized_until DATE        NOT NULL,
  created_by         UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recurring_weekly_rests_weekday_matches CHECK (EXTRACT(DOW FROM start_date)::int = weekday),
  CONSTRAINT recurring_weekly_rests_dates_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Aynı çalışanın aynı günü için tek süresiz kural
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_weekly_rests_open
  ON public.recurring_weekly_rests (employee_id, weekday) WHERE end_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_weekly_rests_store ON public.recurring_weekly_rests (store_id);

ALTER TABLE public.recurring_weekly_rests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_recurring_weekly_rests_updated_at ON public.recurring_weekly_rests;
CREATE TRIGGER trg_recurring_weekly_rests_updated_at
  BEFORE UPDATE ON public.recurring_weekly_rests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Tatil kaydı → kuralı. Kural silinirse geçmiş tekrarlar tek günlük tatil olarak kalır.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES public.recurring_weekly_rests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_recurrence
  ON public.leave_requests (recurrence_id, start_date) WHERE recurrence_id IS NOT NULL;

-- ─── Tek günü yerleştir (boşsa) ─────────────────────────────────
CREATE OR REPLACE FUNCTION private.place_recurring_weekly_rest(p_rule public.recurring_weekly_rests, p_day DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp public.employees%ROWTYPE;
  v_n   INT;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_rule.employee_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_emp.hire_date IS NOT NULL AND p_day < v_emp.hire_date THEN RETURN false; END IF;
  IF v_emp.termination_date IS NOT NULL AND p_day > v_emp.termination_date THEN RETURN false; END IF;

  -- Önceden yapılmış plan korunur: vardiyası ya da izni olan gün atlanır
  IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE employee_id = p_rule.employee_id AND work_date = p_day) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE employee_id = p_rule.employee_id AND status IN ('pending', 'approved')
      AND start_date <= p_day AND end_date >= p_day
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.leave_requests
    (employee_id, leave_type, start_date, end_date, reason, status, reviewed_at, reviewed_by, recurrence_id)
  VALUES
    (p_rule.employee_id, 'weekly_rest', p_day, p_day, 'Haftalık tatil (her hafta)', 'approved', now(), p_rule.created_by, p_rule.id)
  ON CONFLICT DO NOTHING;   -- eşzamanlı izin (leave_requests_no_overlap) → atla
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

REVOKE ALL ON FUNCTION private.place_recurring_weekly_rest(public.recurring_weekly_rests, DATE)
  FROM PUBLIC, anon, authenticated;

-- ─── Ufka kadar üret (kural ya da tümü) ─────────────────────────
-- Dönen: { created, skipped } — skipped: vardiya/izin/istihdam dışı nedeniyle yazılmayan günler
CREATE OR REPLACE FUNCTION public.materialize_recurring_weekly_rests(p_rule_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_horizon DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date + 182;
  v_created INT := 0;
  v_skipped INT := 0;
  v_until   DATE;
  v_day     DATE;
  r         public.recurring_weekly_rests%ROWTYPE;
  v_id      UUID;
BEGIN
  -- Mağazadan ayrılan ya da son çalışma günü geçen çalışanın kuralı kapanır
  FOR v_id IN
    SELECT w.id FROM public.recurring_weekly_rests w
    JOIN public.employees e ON e.id = w.employee_id
    WHERE (p_rule_id IS NULL OR w.id = p_rule_id)
      AND (e.store_id IS DISTINCT FROM w.store_id OR (e.termination_date IS NOT NULL AND e.termination_date < v_today))
  LOOP
    DELETE FROM public.leave_requests WHERE recurrence_id = v_id AND start_date > v_today;
    DELETE FROM public.recurring_weekly_rests WHERE id = v_id;
  END LOOP;

  FOR r IN
    SELECT w.* FROM public.recurring_weekly_rests w
    JOIN public.employees e ON e.id = w.employee_id
    WHERE (p_rule_id IS NULL OR w.id = p_rule_id)
      AND e.active AND e.store_id = w.store_id
      AND w.materialized_until < LEAST(v_horizon, COALESCE(w.end_date, v_horizon))
    FOR UPDATE OF w
  LOOP
    v_until := LEAST(v_horizon, COALESCE(r.end_date, v_horizon));
    -- Geçmiş günler doldurulmaz (pasifken atlanan haftalar geriye dönük yazılmaz)
    v_day := GREATEST(r.materialized_until + 1, r.start_date, v_today);
    v_day := v_day + ((r.weekday - EXTRACT(DOW FROM v_day)::int + 7) % 7);
    WHILE v_day <= v_until LOOP
      IF private.place_recurring_weekly_rest(r, v_day) THEN
        v_created := v_created + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      v_day := v_day + 7;
    END LOOP;
    UPDATE public.recurring_weekly_rests SET materialized_until = v_until WHERE id = r.id;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.materialize_recurring_weekly_rests(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_recurring_weekly_rests(UUID) TO service_role;

-- ─── "Bu ve sonraki haftalar" ───────────────────────────────────
-- Dönen: silinen tatil günü sayısı. Hata: NOT_FOUND
CREATE OR REPLACE FUNCTION public.end_recurring_weekly_rest(p_rule_id UUID, p_from DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r   public.recurring_weekly_rests%ROWTYPE;
  v_n INT;
BEGIN
  SELECT * INTO r FROM public.recurring_weekly_rests WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  WITH d AS (
    DELETE FROM public.leave_requests WHERE recurrence_id = p_rule_id AND start_date >= p_from RETURNING 1
  ) SELECT count(*) INTO v_n FROM d;

  IF p_from <= r.start_date THEN
    DELETE FROM public.recurring_weekly_rests WHERE id = p_rule_id;
  ELSE
    UPDATE public.recurring_weekly_rests
       SET end_date = p_from - 1, materialized_until = LEAST(materialized_until, p_from - 1)
     WHERE id = p_rule_id;
  END IF;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.end_recurring_weekly_rest(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_recurring_weekly_rest(UUID, DATE) TO service_role;

-- ─── İzin talebine yer açmak için kaldırılan tekrarları geri yaz ──
-- Yalnızca bugün ve sonrası, kuralın işlenmiş aralığında. Dönen: geri yazılan gün sayısı
CREATE OR REPLACE FUNCTION public.restore_recurring_weekly_rests(p_employee_id UUID, p_from DATE, p_to DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_n     INT := 0;
  v_day   DATE;
  v_until DATE;
  r       public.recurring_weekly_rests%ROWTYPE;
BEGIN
  FOR r IN
    SELECT w.* FROM public.recurring_weekly_rests w
    JOIN public.employees e ON e.id = w.employee_id
    WHERE w.employee_id = p_employee_id AND e.active AND e.store_id = w.store_id
  LOOP
    v_until := LEAST(p_to, r.materialized_until, COALESCE(r.end_date, p_to));
    v_day := GREATEST(p_from, r.start_date, v_today);
    v_day := v_day + ((r.weekday - EXTRACT(DOW FROM v_day)::int + 7) % 7);
    WHILE v_day <= v_until LOOP
      IF private.place_recurring_weekly_rest(r, v_day) THEN v_n := v_n + 1; END IF;
      v_day := v_day + 7;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.restore_recurring_weekly_rests(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_recurring_weekly_rests(UUID, DATE, DATE) TO service_role;

-- ─── Gece cron'u: ufku ileri taşı (00:40 TR, işten ayrılış işinden sonra) ──
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('recurring-weekly-rests', '40 21 * * *', 'SELECT public.materialize_recurring_weekly_rests()');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron işi oluşturulamadı (recurring-weekly-rests): %', SQLERRM;
END $$;
