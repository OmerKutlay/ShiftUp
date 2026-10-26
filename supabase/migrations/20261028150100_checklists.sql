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
-- UNIQUE kısıtı sayesinde idempotenttir. Gün/saat Europe/Istanbul. Maddesi olmayan şablon için
-- uygulama oluşturulmaz.
--
-- Son saat (due_time) aynı günün saatidir; ertesi güne taşmaz. Gece yarısını geçen bir liste
-- (ör. 23:50) için: gecikme taraması dünün ve bugünün uygulamalarına bakar; dünün uygulaması
-- sabah 06:00'a (Istanbul) kadar düzenlenebilir, sonra salt okunurdur (src/lib/checklistRules.ts
-- → isRunEditable ile aynı kural).
--
-- Gecikme: son saat + 15 dk geçmiş, tamamlanmamış, maddesi olan, şablonu aktif uygulama için
-- mağaza yöneticilerine ve tüm adminlere bir kez 'checklist_overdue' bildirimi
-- (push: trg_notifications_push_fanout). Son saati geçtikten SONRA oluşan (şablon sonradan
-- eklendi / yeniden aktifleştirildi) uygulama baştan "bildirildi" işaretlenir: yanlış alarm yok.
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
-- Gecikme taraması yalnızca bekleyen (tamamlanmamış, bildirilmemiş, son saatli) uygulamalara bakar
CREATE INDEX IF NOT EXISTS idx_checklist_runs_overdue_scan ON public.checklist_runs (run_date)
  WHERE completed_at IS NULL AND overdue_notified_at IS NULL AND due_time IS NOT NULL;

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

-- ─── Şablonu oluştur / güncelle + maddeleri tek işlemde değiştir ─────────
-- p_template_id NULL → yeni şablon. p_items NULL → maddelere dokunma (kısmi güncelleme);
-- verilirse sıralı dizi olarak tümüyle değiştirilir ([{ "text": "...", "required": true }, ...]).
-- Şablon yok / başka mağazanın → P0002. Pasif şablon yeniden aktifleştirilirse, son saati zaten
-- geçmiş bugünkü/dünkü bekleyen uygulamalar bildirilmiş sayılır (yanlış gecikme alarmı olmasın).
CREATE OR REPLACE FUNCTION public.save_checklist_template(
  p_template_id UUID,
  p_store_id    UUID,
  p_actor       UUID,
  p_name        TEXT,
  p_kind        TEXT,
  p_weekdays    SMALLINT[],
  p_due_time    TIME,
  p_active      BOOLEAN,
  p_items       JSONB,
  p_grace_mins  INT DEFAULT 15
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id         UUID;
  v_was_active BOOLEAN;
  v_today      DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  IF p_items IS NOT NULL AND (jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) THEN
    RAISE EXCEPTION 'En az bir madde gerekli.' USING ERRCODE = '22023';
  END IF;

  IF p_template_id IS NULL THEN
    IF p_items IS NULL THEN
      RAISE EXCEPTION 'En az bir madde gerekli.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.checklist_templates (store_id, name, kind, weekdays, due_time, active, created_by)
    VALUES (p_store_id, p_name, p_kind, p_weekdays, p_due_time, p_active, p_actor)
    RETURNING id INTO v_id;
  ELSE
    SELECT t.active INTO v_was_active
      FROM public.checklist_templates t
     WHERE t.id = p_template_id AND t.store_id = p_store_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kontrol listesi bulunamadı.' USING ERRCODE = 'P0002';
    END IF;
    v_id := p_template_id;
    UPDATE public.checklist_templates
       SET name = p_name, kind = p_kind, weekdays = p_weekdays, due_time = p_due_time,
           active = p_active, updated_at = now()
     WHERE id = v_id;

    IF p_active AND NOT v_was_active THEN
      UPDATE public.checklist_runs r
         SET overdue_notified_at = now()
       WHERE r.template_id = v_id
         AND r.run_date IN (v_today, v_today - 1)
         AND r.completed_at IS NULL
         AND r.overdue_notified_at IS NULL
         AND r.due_time IS NOT NULL
         AND now() > ((r.run_date + r.due_time) AT TIME ZONE 'Europe/Istanbul') + make_interval(mins => p_grace_mins);
    END IF;
  END IF;

  IF p_items IS NOT NULL THEN
    DELETE FROM public.checklist_template_items WHERE template_id = v_id;
    INSERT INTO public.checklist_template_items (template_id, position, text, required)
    SELECT v_id, (e.ord - 1)::int, btrim(e.item ->> 'text'), COALESCE((e.item ->> 'required')::boolean, FALSE)
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(item, ord);
  END IF;

  RETURN v_id;
END $$;

-- ─── Maddeyi işaretle / geri al + tamamlanma durumunu tek işlemde güncelle ───
-- Uygulama satırı FOR UPDATE ile kilitlenir: eşzamanlı tikler sırayla işlenir, completed_at/by
-- her zaman madde durumundan türetilir. İşaretleme yetkisi (vardiya / yönetici) API'de denetlenir;
-- burada: mağaza eşleşmesi, düzenleme penceresi (bugün; dün yalnızca 06:00'a kadar) ve geri alma
-- sahipliği. Hatalar: P0002 yok / başka mağaza, 42501 yetki / pencere.
CREATE OR REPLACE FUNCTION public.set_checklist_item(
  p_run_id     UUID,
  p_item_id    UUID,
  p_store_id   UUID,
  p_done       BOOLEAN,
  p_actor      UUID,
  p_is_manager BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now      TIMESTAMPTZ := now();
  v_ist      TIMESTAMP := now() AT TIME ZONE 'Europe/Istanbul';
  v_today    DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_run      public.checklist_runs%ROWTYPE;
  v_item     public.checklist_run_items%ROWTYPE;
  v_total    INT;
  v_open     INT;
  v_req      INT;
  v_req_open INT;
  v_complete BOOLEAN;
BEGIN
  SELECT * INTO v_run FROM public.checklist_runs
   WHERE id = p_run_id AND store_id = p_store_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kontrol listesi bulunamadı.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_run.run_date = v_today OR (v_run.run_date = v_today - 1 AND v_ist::time < TIME '06:00')) THEN
    RAISE EXCEPTION 'Bu kontrol listesi artık düzenlenemez.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.checklist_run_items
   WHERE id = p_item_id AND run_id = p_run_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Madde bulunamadı.' USING ERRCODE = 'P0002';
  END IF;

  IF p_done THEN
    IF v_item.done_at IS NULL THEN
      UPDATE public.checklist_run_items SET done_at = v_now, done_by = p_actor WHERE id = p_item_id;
    END IF;
  ELSIF v_item.done_at IS NOT NULL THEN
    IF NOT p_is_manager AND v_item.done_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'Bu işareti yalnızca işaretleyen kişi ya da bir yönetici geri alabilir.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.checklist_run_items SET done_at = NULL, done_by = NULL WHERE id = p_item_id;
  END IF;

  -- Tamamlanma: tüm zorunlu maddeler işaretli; zorunlu yoksa tüm maddeler; boş liste tamamlanmaz
  SELECT count(*),
         count(*) FILTER (WHERE done_at IS NULL),
         count(*) FILTER (WHERE required),
         count(*) FILTER (WHERE required AND done_at IS NULL)
    INTO v_total, v_open, v_req, v_req_open
    FROM public.checklist_run_items WHERE run_id = p_run_id;
  v_complete := v_total > 0 AND (CASE WHEN v_req > 0 THEN v_req_open = 0 ELSE v_open = 0 END);

  IF v_complete AND v_run.completed_at IS NULL THEN
    UPDATE public.checklist_runs SET completed_at = v_now, completed_by = p_actor WHERE id = p_run_id;
  ELSIF NOT v_complete AND v_run.completed_at IS NOT NULL THEN
    UPDATE public.checklist_runs SET completed_at = NULL, completed_by = NULL WHERE id = p_run_id;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'done_at', i.done_at, 'done_by', i.done_by,
      'completed_at', r.completed_at, 'completed_by', r.completed_by)
      FROM public.checklist_run_items i, public.checklist_runs r
     WHERE i.id = p_item_id AND r.id = p_run_id
  );
END $$;

-- ─── Bugünün uygulamalarını oluştur (idempotent) ─────────────
-- p_due_only: true → yalnızca son saati olan şablonlar (cron); false → hepsi.
-- Maddesi olmayan şablon için uygulama oluşturulmaz. Son saat + tolerans oluşturma anında zaten
-- geçmişse uygulama "bildirildi" işaretli doğar (şablon gün içinde sonradan eklendi / aktifleşti).
-- Madde kopyası, maddesi hiç olmayan bugünkü uygulamalar için eklenir (yarışta kaybeden de tamamlar).
CREATE OR REPLACE FUNCTION public.ensure_checklist_runs(
  p_due_only   BOOLEAN DEFAULT FALSE,
  p_grace_mins INT DEFAULT 15
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_rows  INT;
BEGIN
  INSERT INTO public.checklist_runs (store_id, template_id, run_date, name, kind, due_time, overdue_notified_at)
  SELECT t.store_id, t.id, v_today, t.name, t.kind, t.due_time,
         CASE WHEN t.due_time IS NOT NULL
               AND now() > ((v_today + t.due_time) AT TIME ZONE 'Europe/Istanbul') + make_interval(mins => p_grace_mins)
              THEN now() END
    FROM public.checklist_templates t
    JOIN public.stores s ON s.id = t.store_id AND s.active
   WHERE t.active
     AND extract(dow FROM v_today)::smallint = ANY (t.weekdays)
     AND (NOT p_due_only OR t.due_time IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.checklist_template_items i WHERE i.template_id = t.id)
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

-- ─── Geciken listeleri yöneticilere ve adminlere bildir ──────
-- Bugün VE dün (Istanbul) uygulamalarına bakar: 23:50 son saatli liste 00:05'te hâlâ açıksa
-- bildirilir. Maddesi olmayan uygulama ve pasif şablonun uygulaması taranmaz.
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
  PERFORM public.ensure_checklist_runs(TRUE, p_grace_mins);

  -- Tek ifade: geciken uygulamalar "bildirildi" işaretlenir (bir kez) ve alıcılara yazılır
  WITH due AS (
    UPDATE public.checklist_runs r
       SET overdue_notified_at = now()
     WHERE r.run_date IN (v_today, v_today - 1)
       AND r.completed_at IS NULL
       AND r.due_time IS NOT NULL
       AND r.overdue_notified_at IS NULL
       AND now() > ((r.run_date + r.due_time) AT TIME ZONE 'Europe/Istanbul') + make_interval(mins => p_grace_mins)
       AND EXISTS (SELECT 1 FROM public.checklist_templates t WHERE t.id = r.template_id AND t.active)
       AND EXISTS (SELECT 1 FROM public.checklist_run_items i WHERE i.run_id = r.id)
    RETURNING r.id, r.store_id, r.name, r.due_time
  )
  INSERT INTO public.notifications (employee_id, type, title, message, related_id, is_read)
  SELECT m.id, 'checklist_overdue', 'Kontrol listesi gecikti',
         format('"%s" listesi son saati (%s) geçmesine rağmen tamamlanmadı.', d.name, left(d.due_time::text, 5)),
         d.id, false
    FROM due d
    JOIN public.employees m ON m.active
    JOIN public.roles ro ON ro.id = m.role_id
   WHERE ro.access_level = 'admin'
      OR (m.store_id = d.store_id AND ro.access_level IN ('store_manager', 'manager'));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.save_checklist_template(UUID, UUID, UUID, TEXT, TEXT, SMALLINT[], TIME, BOOLEAN, JSONB, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_checklist_item(UUID, UUID, UUID, BOOLEAN, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_checklist_runs(BOOLEAN, INT) FROM PUBLIC, anon, authenticated;
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
