-- ============================================================
-- Kontrol listeleri: mağazaya özel tekrarlayan listeler (açılış / kapanış / özel).
--
--   checklist_templates       şablon: ad, tür, haftanın günleri, opsiyonel son saat, aktif
--   checklist_template_items  şablonun sıralı maddeleri (metin ≤ 200, "zorunlu" bayrağı)
--   checklist_runs            (şablon, gün) başına tek uygulama — UNIQUE(template_id, run_date)
--   checklist_run_items       uygulamanın madde KOPYASI (şablon sonradan değişse de geçmiş sabit)
--
-- Uygulamalar tembel oluşur: GET /api/checklists/today (src/lib/checklistRepository.ts →
-- ensureTodayRuns) VE pg_cron'daki scan_checklist_overdue() aynı mantıkla ekler; ikisi de
-- UNIQUE kısıtı sayesinde idempotenttir. Gün/saat Europe/Istanbul.
-- Gecikme: son saat + 15 dk geçmiş, tamamlanmamış uygulama için mağaza yöneticilerine bir kez
-- 'checklist_overdue' bildirimi (push: trg_notifications_push_fanout).
--
-- Tablolar yalnızca service role ile okunur/yazılır: RLS açık, politika yok.
-- weekdays: 0 = Pazar … 6 = Cumartesi (JS getUTCDay / Postgres extract(dow) ile aynı).
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  kind       TEXT        NOT NULL DEFAULT 'custom' CHECK (kind IN ('opening', 'closing', 'custom')),
  weekdays   SMALLINT[]  NOT NULL DEFAULT '{0,1,2,3,4,5,6}'
             CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  due_time   TIME,
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_store ON public.checklist_templates (store_id, active);

CREATE TABLE IF NOT EXISTS public.checklist_template_items (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID    NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 0),
  text        TEXT    NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 200),
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (template_id, position)
);

CREATE TABLE IF NOT EXISTS public.checklist_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  template_id         UUID        NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  run_date            DATE        NOT NULL,
  -- Şablonun oluşturulma andaki hali (geçmiş şablon düzenlemelerinden etkilenmesin)
  name                TEXT        NOT NULL,
  kind                TEXT        NOT NULL CHECK (kind IN ('opening', 'closing', 'custom')),
  due_time            TIME,
  completed_at        TIMESTAMPTZ,
  completed_by        UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  note                TEXT        CHECK (note IS NULL OR length(note) <= 500),
  overdue_notified_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, run_date)
);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_store_date ON public.checklist_runs (store_id, run_date DESC);

CREATE TABLE IF NOT EXISTS public.checklist_run_items (
  id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id   UUID    NOT NULL REFERENCES public.checklist_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  text     TEXT    NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  done_at  TIMESTAMPTZ,
  done_by  UUID    REFERENCES public.employees(id) ON DELETE SET NULL,
  UNIQUE (run_id, position)
);

ALTER TABLE public.checklist_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_run_items      ENABLE ROW LEVEL SECURITY;

-- ─── Bugünün uygulamalarını oluştur (idempotent) ─────────────
-- p_due_only: true → yalnızca son saati olan şablonlar (cron); false → hepsi.
-- Madde kopyası, maddesi hiç olmayan bugünkü uygulamalar için eklenir (yarışta kaybeden de tamamlar).
CREATE OR REPLACE FUNCTION public.ensure_checklist_runs(p_due_only BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_rows  INT;
BEGIN
  INSERT INTO public.checklist_runs (store_id, template_id, run_date, name, kind, due_time)
  SELECT t.store_id, t.id, v_today, t.name, t.kind, t.due_time
  FROM public.checklist_templates t
  JOIN public.stores s ON s.id = t.store_id AND s.active
  WHERE t.active
    AND extract(dow FROM v_today)::smallint = ANY (t.weekdays)
    AND (NOT p_due_only OR t.due_time IS NOT NULL)
  ON CONFLICT (template_id, run_date) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.checklist_run_items (run_id, position, text, required)
  SELECT r.id, i.position, i.text, i.required
  FROM public.checklist_runs r
  JOIN public.checklist_template_items i ON i.template_id = r.template_id
  WHERE r.run_date = v_today
    AND NOT EXISTS (SELECT 1 FROM public.checklist_run_items x WHERE x.run_id = r.id)
  ON CONFLICT (run_id, position) DO NOTHING;

  RETURN v_rows;
END $$;

-- ─── Geciken listeleri yöneticilere bildir ───────────────────
CREATE OR REPLACE FUNCTION public.scan_checklist_overdue(p_grace_mins INT DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_rows  INT;
BEGIN
  PERFORM public.ensure_checklist_runs(TRUE);

  -- Tek ifade: geciken uygulamalar "bildirildi" işaretlenir (bir kez) ve yöneticilere yazılır
  WITH due AS (
    UPDATE public.checklist_runs r
       SET overdue_notified_at = now()
     WHERE r.run_date = v_today
       AND r.completed_at IS NULL
       AND r.due_time IS NOT NULL
       AND r.overdue_notified_at IS NULL
       AND now() > ((r.run_date + r.due_time) AT TIME ZONE 'Europe/Istanbul') + make_interval(mins => p_grace_mins)
    RETURNING r.id, r.store_id, r.name, r.due_time
  )
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT m.id, 'checklist_overdue', 'Kontrol listesi gecikti',
         format('"%s" listesi son saati (%s) geçmesine rağmen tamamlanmadı.', d.name, left(d.due_time::text, 5)),
         d.id, false
  FROM due d
  JOIN public.employees m ON m.store_id = d.store_id AND m.active
  JOIN public.roles ro ON ro.id = m.role_id
  WHERE ro.access_level IN ('admin', 'store_manager', 'manager');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.ensure_checklist_runs(BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_checklist_overdue(INT) FROM PUBLIC, anon, authenticated;

-- ─── pg_cron: 5 dakikada bir ─────────────────────────────────
-- Aynı adla cron.schedule mevcut işi günceller. pg_cron yoksa migration yine de başarılı olur.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'checklist-overdue-scan',
    '*/5 * * * *',
    'SELECT public.scan_checklist_overdue()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); kontrol listesi gecikme bildirimi gönderilmeyecek.', SQLERRM;
END $$;
