-- ============================================================
-- Veri bütünlüğü uyarısı bildirim tipi (pg_cron → private.check_row_count_drops, 20261030110100):
--   data_integrity_alert   kritik bir tablonun satır sayısı beklenmedik biçimde düştü (adminlere)
-- Canlıda notifications.type bir enum (notification_type); yeni değer kullanılmadan önce ayrı
-- migration'da eklenir. Sıfırdan kurulumda kolon TEXT olduğundan bu adım hiçbir şey yapmaz.
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS ''data_integrity_alert''';
  END IF;
END $$;
