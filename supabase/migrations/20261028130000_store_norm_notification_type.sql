-- ============================================================
-- Mağaza aylık norm saati bildirimi:
--   store_norm_set   Admin mağazanın aylık norm saatini belirledi / değiştirdi
-- Canlıda notifications.type bir enum (notification_type); yeni değer kullanılmadan önce ayrı
-- migration'da eklenir. Sıfırdan kurulumda kolon TEXT olduğundan bu adım hiçbir şey yapmaz.
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS ''store_norm_set''';
  END IF;
END $$;
