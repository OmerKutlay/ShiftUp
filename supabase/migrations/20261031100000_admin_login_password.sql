-- ============================================================
-- Admin girişi: e-posta kodundan (OTP) önce istenen admin şifresi.
--
-- Her admin için ayrı şifre; yalnızca bcrypt özeti (pgcrypto, maliyet 10) saklanır.
-- Özet hesaplama ve karşılaştırma veritabanında yapılır — Worker'ın CPU sınırına girmez.
--
-- Erişim: tablo ve fonksiyonlar yalnızca service role'e açıktır (anon/authenticated kapalı).
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_credentials (
  employee_id   UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.employees(id) ON DELETE SET NULL
);

ALTER TABLE public.admin_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_client_access ON public.admin_credentials;
CREATE POLICY deny_client_access ON public.admin_credentials
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.admin_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_credentials TO service_role;

-- Şifre belirle / değiştir (uzunluk kuralı uygulama ile aynı: 10–72 bayt; bcrypt 72 baytı aşanı keser)
CREATE OR REPLACE FUNCTION public.set_admin_password(p_employee_id UUID, p_password TEXT, p_actor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_password IS NULL OR char_length(p_password) < 10 OR octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'invalid admin password length' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_credentials (employee_id, password_hash, updated_at, updated_by)
  VALUES (p_employee_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(), p_actor_id)
  ON CONFLICT (employee_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        updated_at    = EXCLUDED.updated_at,
        updated_by    = EXCLUDED.updated_by;
END $$;

-- Şifre doğru mu? Kayıt yoksa da bir bcrypt hesaplanır: yanıt süresi şifresi olmayan /
-- admin olmayan hesabı ele vermez.
CREATE OR REPLACE FUNCTION public.verify_admin_password(p_employee_id UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash FROM public.admin_credentials WHERE employee_id = p_employee_id;
  IF v_hash IS NULL OR p_password IS NULL THEN
    PERFORM extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    RETURN FALSE;
  END IF;
  RETURN v_hash = extensions.crypt(p_password, v_hash);
END $$;

REVOKE ALL ON FUNCTION public.set_admin_password(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_admin_password(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_password(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(UUID, TEXT) TO service_role;
