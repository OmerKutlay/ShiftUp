-- ============================================================
-- Güvenlik sıkılaştırması (güvenlik denetimi + Supabase Security Advisor bulguları).
--
-- Erişim modeli değişmez: uygulama verisine YALNIZCA sunucu (service role) erişir; anon ve
-- authenticated için tablolar kapalıdır (bkz. 20261012100200_lockdown_rls.sql). Bu migration o
-- modeli açık ve kalıcı hale getirir:
--
--   1. search_path'i sabitlenmemiş fonksiyonlar (Advisor: function_search_path_mutable)
--   2. Kiosk Realtime yetki fonksiyonu API'ye açık olmayan `private` şemasına taşınır
--      (Advisor: authenticated_security_definer_function_executable — /rest/v1/rpc ile çağrılabiliyordu)
--   3. Her public tabloya anon/authenticated için açık "deny" (RESTRICTIVE, false) policy'si
--      (Advisor: rls_enabled_no_policy — niyet artık şemada yazılı; ileride yanlışlıkla eklenecek
--      permissive bir policy de bu kısıtı aşamaz)
--   4. anon/authenticated'ın tüm tablo/view/sequence/fonksiyon yetkileri (DELETE ve TRUNCATE dahil)
--      kaldırılır; yeni nesneler için varsayılan yetkiler de kapatılır (sequence'lar ve PUBLIC'in
--      fonksiyon EXECUTE varsayılanı önceki kilitte açık kalmıştı)
--   5. employees / roles: yetki veren kolonlara istemci (anon/authenticated) yazmaları yok sayılır
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

-- ─── 1) search_path sabitleme ────────────────────────────────
ALTER FUNCTION public.update_updated_at() SET search_path = '';
ALTER FUNCTION public.audit_logs_immutable() SET search_path = '';
ALTER FUNCTION public.announcement_mark(UUID, UUID, BOOLEAN) SET search_path = '';

-- rate_limit_hit: search_path = public yerine '' + şema nitelikli adlar
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_limit INTEGER, p_window_ms INTEGER)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
  v_reset TIMESTAMPTZ;
  v_window INTERVAL := make_interval(secs => p_window_ms / 1000.0);
BEGIN
  INSERT INTO public.rate_limits AS r (key, count, reset_at)
  VALUES (p_key, 1, now() + v_window)
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
        reset_at = CASE WHEN r.reset_at <= now() THEN now() + v_window ELSE r.reset_at END
  RETURNING r.count, r.reset_at INTO v_count, v_reset;

  -- Fırsatçı temizlik: süresi çoktan dolmuş anahtarlar
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE public.rate_limits.reset_at < now() - INTERVAL '1 hour';
  END IF;

  RETURN QUERY SELECT v_count <= p_limit, GREATEST(p_limit - v_count, 0), v_reset;
END $$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

-- ─── 2) private şeması + kiosk Realtime yetkisi ─────────────
-- private, PostgREST'e açık değildir (config.toml [api].schemas = public, graphql_public).
-- realtime.messages policy'si authenticated rolüyle değerlendirildiği için yalnızca o
-- fonksiyonu çalıştırabilir; şemadaki diğer nesneler (silme arşivi vb.) kapalıdır.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_view_kiosk_qr_topic(p_topic TEXT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store UUID;
BEGIN
  IF p_topic IS NULL
     OR p_topic !~ '^kiosk-qr:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_store := substring(p_topic FROM 10)::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.active
      AND (e.termination_date IS NULL OR e.termination_date >= (now() AT TIME ZONE 'Europe/Istanbul')::date)
      AND (
        r.access_level = 'admin'
        OR (e.store_id = v_store AND r.access_level IN ('kiosk', 'manager', 'store_manager'))
      )
  );
END $$;
REVOKE ALL ON FUNCTION private.can_view_kiosk_qr_topic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_kiosk_qr_topic(TEXT) TO authenticated;

DROP POLICY IF EXISTS kiosk_qr_receive ON realtime.messages;
CREATE POLICY kiosk_qr_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND (SELECT private.can_view_kiosk_qr_topic((SELECT realtime.topic())))
  );

DROP FUNCTION IF EXISTS public.can_view_kiosk_qr_topic(TEXT);

-- ─── 3) + 4) public tabloları: RLS + açık deny + yetki kaldırma ─
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_client_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY deny_client_access ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t
    );
  END LOOP;
END $$;

-- Tablolar + view'lar (ALL TABLES view'ları da kapsar) — SELECT/INSERT/UPDATE/DELETE/TRUNCATE dahil
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Trigger fonksiyonları tetiklenirken EXECUTE denetlenmez; sunucu (service_role) kendi yetkisini korur
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Yeni nesneler: anon/authenticated'a otomatik yetki verilmesin (postgres rolünün oluşturdukları).
-- Not: Supabase'in supabase_admin rolüne ait varsayılanları postgres rolü değiştiremez; denetim
-- sorgusu (supabase/audit/security_audit.sql, 3b) bunları ayrıca listeler.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- PostgreSQL'in yerleşik "PUBLIC EXECUTE" varsayılanı yalnızca şemasız (global) kaldırılabilir.
-- Bundan sonra istemcinin çağırması gereken her fonksiyon açıkça GRANT edilmelidir.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ─── 5) Yetki veren kolonlar yalnızca sunucudan değişir ──────
-- Bugün istemcinin bu tablolara hiç yetkisi yok; bu tetikleyici ileride biri yanlışlıkla
-- GRANT / permissive policy eklerse ikinci savunma hattıdır. İstemci rolleri (anon,
-- authenticated) için yetki/kimlik/işten çıkış kolonlarındaki değişiklikler sessizce yok
-- sayılır (eski değer korunur); yeni çalışan satırı eklemek reddedilir. service_role,
-- postgres ve SECURITY DEFINER fonksiyonları (current_user = sahibi) etkilenmez.
CREATE OR REPLACE FUNCTION private.employees_ignore_client_privileged_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Çalışan kaydı yalnızca sunucu tarafından oluşturulabilir.' USING ERRCODE = '42501';
  END IF;
  NEW.id                        := OLD.id;
  NEW.role_id                   := OLD.role_id;
  NEW.active                    := OLD.active;
  NEW.store_id                  := OLD.store_id;
  NEW.email                     := OLD.email;
  NEW.auth_user_id              := OLD.auth_user_id;
  NEW.employment_type           := OLD.employment_type;
  NEW.hire_date                 := OLD.hire_date;
  NEW.overtime_consent_at       := OLD.overtime_consent_at;
  NEW.kvkk_notice_ack_at        := OLD.kvkk_notice_ack_at;
  NEW.kvkk_notice_version       := OLD.kvkk_notice_version;
  NEW.termination_date          := OLD.termination_date;
  NEW.termination_reason        := OLD.termination_reason;
  NEW.termination_note          := OLD.termination_note;
  NEW.terminated_by             := OLD.terminated_by;
  NEW.terminated_at             := OLD.terminated_at;
  NEW.termination_leave_balance := OLD.termination_leave_balance;
  NEW.termination_prev_active   := OLD.termination_prev_active;
  NEW.created_at                := OLD.created_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_employees_ignore_client_privileged_writes ON public.employees;
CREATE TRIGGER trg_employees_ignore_client_privileged_writes
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION private.employees_ignore_client_privileged_writes();

-- roles: access_level yetkinin kaynağıdır — istemci yazmaları (ekleme/güncelleme/silme) yok sayılır
CREATE OR REPLACE FUNCTION private.roles_ignore_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RETURN NULL;  -- satır işlenmez
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_roles_ignore_client_writes ON public.roles;
CREATE TRIGGER trg_roles_ignore_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION private.roles_ignore_client_writes();
