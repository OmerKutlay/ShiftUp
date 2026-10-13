-- ============================================================
-- Kiosk QR: tek kullanımlık kod + Realtime Broadcast (private kanal "kiosk-qr")
--
-- 20261013100000'deki yerel imzalı (TOTP) model yerine: kod zamanla değişmez, yalnızca
-- okutulup onaylanınca sunucu yeni kodu üretip private kanala yayınlar.
-- Ayrıca proje Realtime ayarı private_only=true yapılır (Management API, migration dışı).
-- ============================================================

-- TOTP modelinin tabloları (yalnızca aynı gün kullanıldı, kalıcı veri yok)
DROP TABLE IF EXISTS public.qr_scan_uses;
DROP TABLE IF EXISTS public.kiosk_keys;

-- Eski sunucu tabanlı kiosk kodlarını kapat; ardından her an tek aktif kiosk kodu
UPDATE public.qr_tokens SET used_at = now() WHERE employee_id IS NULL AND used_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_tokens_one_active_kiosk
  ON public.qr_tokens ((employee_id IS NULL))
  WHERE employee_id IS NULL AND used_at IS NULL;

-- Kanala katılma yetkisi: oturumdaki kullanıcı aktif Kiosk veya Müdür Yardımcısı+ mı?
-- SECURITY DEFINER: authenticated rolünün employees/roles tablolarına erişimi yok (RLS kilidi).
CREATE OR REPLACE FUNCTION public.can_view_kiosk_qr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.active
      AND r.name IN ('Kiosk', 'Müdür Yardımcısı', 'Mağaza Müdürü', 'Yönetici')
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_kiosk_qr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_kiosk_qr() TO authenticated;

-- Yalnızca yetkili kullanıcılar "kiosk-qr" yayınlarını alabilir.
-- INSERT politikası bilinçli olarak yok: istemciler kanala mesaj gönderemez, yalnızca sunucu
-- (secret key, RLS'yi bypass eder) yayınlar.
DROP POLICY IF EXISTS kiosk_qr_receive ON realtime.messages;
CREATE POLICY kiosk_qr_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    (SELECT realtime.topic()) = 'kiosk-qr'
    AND realtime.messages.extension = 'broadcast'
    AND (SELECT public.can_view_kiosk_qr())
  );
