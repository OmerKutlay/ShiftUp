-- ============================================================
-- Duyuru bildirim tipi (announcement). Canlıda notifications.type bir enum (notification_type);
-- yeni değer kullanılmadan önce ayrı migration'da eklenir. Sıfırdan kurulumda kolon TEXT olduğundan
-- bu adım hiçbir şey yapmaz. İdempotent: tekrar çalıştırılabilir.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS ''announcement''';
  END IF;
END $$;
