-- ============================================================
-- Veri saklama (retention) işi + uygulama hata günlüğü (app_errors).
--
-- Supabase ücretsiz plan: 500 MB veritabanı, PITR yok. Sınırsız büyüyen operasyonel
-- tablolar günlük olarak budanır. YASAL KAYITLAR ASLA SİLİNMEZ:
--   audit_logs, attendance_records, shift_assignments, leave_requests, manual_time_correction_requests,
--   shift_swap_requests (İş Kanunu / KVKK gereği saklama). Konum alanlarına dokunulmaz
--   (KVKK konum saklama başka bir görevde ele alınır). net._http_response pg_net'e aittir, dokunulmaz.
--
-- Saklama süreleri (gerekçe):
--   qr_tokens        süresi dolmuş / kullanılmış, 2 günden eski  → tek kullanımlık, doğrulaması saniyeler içinde biter
--   rate_limits      süresi dolmuş, 1 günden eski               → fırsatçı temizlik (%1) yetmez, garanti altına alınır
--   notifications    okunmuş 90 gün, okunmamış 180 gün          → okunmamış bile 6 ayda anlamını yitirir
--   app_errors       30 gün                                     → hata ayıklama için yeterli, büyümeyi sınırlar
-- Silme sınırlı gruplar halinde yapılır (tek seferde uzun kilit / WAL şişmesi olmasın).
-- İdempotent.
-- ============================================================

-- ─── app_errors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_errors (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT        NOT NULL,                 -- 'api:GET /x', 'client:error-boundary' ...
  message     TEXT        NOT NULL,
  stack       TEXT,                                 -- uygulama tarafında kısaltılır
  request_id  TEXT,                                 -- cf-ray
  employee_id UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  store_id    UUID        REFERENCES public.stores(id) ON DELETE SET NULL,
  meta        JSONB
);
CREATE INDEX IF NOT EXISTS idx_app_errors_created ON public.app_errors (created_at DESC);

-- "Yalnızca sunucu" erişim modeli: RLS açık, politika yok
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_errors FROM anon, authenticated;

-- ─── purge_expired_data() ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_expired_data(
  p_batch     INT DEFAULT 5000,
  p_max_loops INT DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_summary jsonb := '{}'::jsonb;
  v_rows    INT;
  v_total   BIGINT;
  v_loop    INT;
  v_spec    RECORD;
BEGIN
  -- (etiket, tablo, silinecek satırların koşulu) — koşullar sabittir, kullanıcı girdisi yok
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('qr_tokens',     'public.qr_tokens',
        $c$ (expires_at < now() - interval '2 days') OR (used_at IS NOT NULL AND used_at < now() - interval '2 days') $c$),
      ('rate_limits',   'public.rate_limits',
        $c$ reset_at < now() - interval '1 day' $c$),
      ('notifications_read',   'public.notifications',
        $c$ is_read AND created_at < now() - interval '90 days' $c$),
      ('notifications_unread', 'public.notifications',
        $c$ NOT is_read AND created_at < now() - interval '180 days' $c$),
      ('app_errors',    'public.app_errors',
        $c$ created_at < now() - interval '30 days' $c$)
    ) AS t(label, tbl, cond)
  LOOP
    v_total := 0;
    BEGIN
      FOR v_loop IN 1..p_max_loops LOOP
        EXECUTE format(
          'DELETE FROM %s WHERE ctid IN (SELECT ctid FROM %s WHERE %s LIMIT %s)',
          v_spec.tbl, v_spec.tbl, v_spec.cond, p_batch
        );
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        EXIT WHEN v_rows < p_batch;
      END LOOP;
      v_summary := v_summary || jsonb_build_object(v_spec.label, v_total);
    EXCEPTION WHEN OTHERS THEN
      -- Bir tablodaki hata (ör. eksik tablo) diğerlerinin temizlenmesini engellemez
      v_summary := v_summary || jsonb_build_object(v_spec.label, 'error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN v_summary;
END $$;

REVOKE ALL ON FUNCTION public.purge_expired_data(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data(INT, INT) TO service_role;

-- ─── pg_cron: her gün 03:30 Türkiye saati (00:30 UTC) ────────
-- Aynı adla cron.schedule mevcut işi günceller. pg_cron yoksa migration yine de başarılı olur.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'purge-expired-data',
    '30 0 * * *',
    'SELECT public.purge_expired_data()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron işi kurulamadı (%); eski veriler otomatik temizlenmeyecek.', SQLERRM;
END $$;
