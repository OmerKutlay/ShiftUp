-- 'attendance_break_ending' bildirim tipi — "molanız bitmek üzere" hatırlatması (20261026100100).
-- Canlıda notifications.type bir enum (notification_type); yeni değer kullanılmadan önce ayrı
-- bir migration'da (ayrı işlemde) eklenmelidir. Sıfırdan kurulumda kolon TEXT olduğundan
-- enum yoksa bu adım hiçbir şey yapmaz (20261017100000 ile aynı desen).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS ''attendance_break_ending''';
  END IF;
END $$;
