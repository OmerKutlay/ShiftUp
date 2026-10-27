-- ============================================================
-- Silme güvenlik ağı: toplu silme sınırı + silinen satır arşivi + satır sayısı düşüş alarmı.
--
-- Uygulama service role ile çalışır; bir API hatası veya sızmış secret key tek istekte tabloları
-- boşaltabilir. Ücretsiz planda PITR yok (yalnızca haftalık şifreli yedek, .github/workflows/db-backup.yml).
--
--   1. Sınır: kritik tablolarda TEK İFADEDE silinebilecek satır sayısı sınırlıdır (aşılırsa ifade
--      tümüyle geri alınır). Sınırlar uygulamanın gerçek toplu silmelerinin üstündedir:
--        shift_assignments 1000  (workforce/apply: istek başına ≤ 500 atama, mağazanın haftası)
--        leave_requests     500  (haftalık tatil yeniden planı)
--        shift_swap_requests 1000 (vardiya silinince CASCADE)
--      Bilinçli toplu işlem (SQL Editor, bakım betiği) aynı transaction'da açar:
--        SET LOCAL app.allow_bulk_delete = 'on';
--      TRUNCATE satır tetikleyicisi çalıştırmadığından bu tablolarda aynı bayrak olmadan reddedilir.
--   2. Arşiv: bu tablolardan silinen her satır (CASCADE ile silinenler dahil) private.deleted_rows'a
--      JSON olarak kopyalanır (365 gün saklanır). Geri yükleme: jsonb_populate_record ile.
--   3. Alarm: pg_cron saatte bir kritik tabloların satır sayısını önceki ölçümle karşılaştırır;
--      eşiği aşan düşüşte app_errors'a kayıt + tüm aktif adminlere 'data_integrity_alert'
--      bildirimi (push: trg_notifications_push_fanout).
--
-- private şeması API'ye açık değildir (20261030100000). İdempotent.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ─── Arşiv ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.deleted_rows (
  id          BIGSERIAL   PRIMARY KEY,
  table_name  TEXT        NOT NULL,
  row_id      TEXT,
  row_data    JSONB       NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  db_role     TEXT        NOT NULL DEFAULT current_user,
  app_name    TEXT        DEFAULT current_setting('application_name', true),
  -- İsteği yapan kullanıcı (PostgREST JWT'si; service role / cron isteklerinde NULL)
  jwt_sub     TEXT        DEFAULT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
  txid        BIGINT      NOT NULL DEFAULT txid_current()
);
CREATE INDEX IF NOT EXISTS idx_deleted_rows_table_time ON private.deleted_rows (table_name, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_rows_row_id ON private.deleted_rows (row_id);
REVOKE ALL ON private.deleted_rows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.deleted_rows_id_seq FROM PUBLIC, anon, authenticated;

-- ─── Sınır + arşiv tetikleyicisi (ifade başına) ─────────────
-- TG_ARGV[0] = tek ifadede izin verilen en fazla satır
CREATE OR REPLACE FUNCTION private.guard_and_archive_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max   INT := TG_ARGV[0]::int;
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM old_rows;
  IF v_count = 0 THEN RETURN NULL; END IF;

  IF v_count > v_max AND coalesce(current_setting('app.allow_bulk_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Toplu silme engellendi: public.% tablosundan tek ifadede % satır (sınır %).',
      TG_TABLE_NAME, v_count, v_max
      USING ERRCODE = 'P0001',
            HINT = 'Bilinçli bir işlemse aynı transaction''da önce: SET LOCAL app.allow_bulk_delete = ''on'';';
  END IF;

  INSERT INTO private.deleted_rows (table_name, row_id, row_data)
  SELECT TG_TABLE_NAME, j ->> 'id', j
  FROM (SELECT to_jsonb(o) AS j FROM old_rows o) s;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.guard_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('app.allow_bulk_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'TRUNCATE engellendi: public.%', TG_TABLE_NAME
      USING ERRCODE = 'P0001',
            HINT = 'Bilinçli bir işlemse aynı transaction''da önce: SET LOCAL app.allow_bulk_delete = ''on'';';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION private.guard_and_archive_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_truncate() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v RECORD;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('employees',                       5),
      ('stores',                          1),
      ('roles',                           1),
      ('company_settings',                1),
      ('attendance_records',             10),
      ('shift_assignments',            1000),
      ('leave_requests',                500),
      ('manual_time_correction_requests', 20),
      ('shift_swap_requests',          1000),
      ('open_shifts',                   200),
      ('employee_availability',         100),
      ('shift_templates',                50),
      ('store_locations',                10),
      ('public_holidays',               100),
      ('store_monthly_norms',            24),
      ('announcements',                  20),
      ('checklist_templates',            50),
      ('checklist_runs',              1000)
    ) AS t(tbl, max_rows)
  LOOP
    IF to_regclass('public.' || v.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_delete_guard ON public.%I', v.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_delete_guard AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows '
      'FOR EACH STATEMENT EXECUTE FUNCTION private.guard_and_archive_delete(%s)',
      v.tbl, v.max_rows
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_truncate_guard ON public.%I', v.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_truncate_guard BEFORE TRUNCATE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION private.guard_truncate()',
      v.tbl
    );
  END LOOP;
END $$;

-- ─── Satır sayısı düşüş alarmı ───────────────────────────────
CREATE TABLE IF NOT EXISTS private.row_count_snapshots (
  table_name TEXT        NOT NULL,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  row_count  BIGINT      NOT NULL,
  PRIMARY KEY (table_name, taken_at)
);
REVOKE ALL ON private.row_count_snapshots FROM PUBLIC, anon, authenticated;

-- Eşik: önceki ölçüme göre bu kadar (veya daha fazla) satır azalırsa alarm. Normalde hiç azalmayan
-- tablolarda (devam kaydı, denetim kaydı, çalışan, mağaza) eşik 1'dir. Dönüş: alarm veren tablo sayısı.
CREATE OR REPLACE FUNCTION private.check_row_count_drops()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v       RECORD;
  v_now   BIGINT;
  v_prev  BIGINT;
  v_drops TEXT[] := '{}';
  v_msg   TEXT;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('employees',                         1),
      ('stores',                            1),
      ('roles',                             1),
      ('attendance_records',                1),
      ('audit_logs',                        1),
      ('shift_assignments',               300),
      ('leave_requests',                  100),
      ('manual_time_correction_requests',  10),
      ('announcements',                    10),
      ('checklist_runs',                   50)
    ) AS t(tbl, threshold)
  LOOP
    IF to_regclass('public.' || v.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v.tbl) INTO v_now;

    SELECT s.row_count INTO v_prev
    FROM private.row_count_snapshots s
    WHERE s.table_name = v.tbl
    ORDER BY s.taken_at DESC
    LIMIT 1;

    IF v_prev IS NOT NULL AND v_prev - v_now >= v.threshold THEN
      v_drops := v_drops || format('%s: %s → %s', v.tbl, v_prev, v_now);
    END IF;

    INSERT INTO private.row_count_snapshots (table_name, row_count) VALUES (v.tbl, v_now);
  END LOOP;

  DELETE FROM private.row_count_snapshots WHERE taken_at < now() - INTERVAL '30 days';

  IF cardinality(v_drops) = 0 THEN RETURN 0; END IF;

  v_msg := 'Satır sayısı beklenmedik biçimde düştü — ' || array_to_string(v_drops, '; ')
        || '. Silinen satırlar: private.deleted_rows.';
  RAISE WARNING '%', v_msg;

  INSERT INTO public.app_errors (source, message, meta)
  VALUES ('db:row-count-monitor', v_msg, jsonb_build_object('drops', to_jsonb(v_drops)));

  INSERT INTO public.notifications (employee_id, type, title, message, is_read)
  SELECT e.id, 'data_integrity_alert', 'Veri kaybı uyarısı', v_msg, false
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.active AND r.access_level = 'admin';

  RETURN cardinality(v_drops);
END $$;

REVOKE ALL ON FUNCTION private.check_row_count_drops() FROM PUBLIC, anon, authenticated;

-- Arşiv saklama süresi
CREATE OR REPLACE FUNCTION private.purge_deleted_rows_archive(p_keep_days INT DEFAULT 365)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM private.deleted_rows WHERE deleted_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION private.purge_deleted_rows_archive(INT) FROM PUBLIC, anon, authenticated;

-- İlk ölçüm (alarm bir sonraki çalıştırmadan itibaren karşılaştırır)
SELECT private.check_row_count_drops();

-- ─── pg_cron ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('row-count-monitor', '17 * * * *', 'SELECT private.check_row_count_drops()');
  PERFORM cron.schedule('deleted-rows-retention', '45 0 * * *', 'SELECT private.purge_deleted_rows_archive()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); satır sayısı alarmı çalışmayacak.', SQLERRM;
END $$;
