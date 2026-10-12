-- ============================================================
-- RLS kilitleme — "yalnızca sunucu" erişim modeli.
--
-- Önceki durum: employees / shift_assignments / attendance_records tablolarında RLS
-- hiç açılmamıştı ve anon rolüne `USING (true)` yazma policy'leri tanımlıydı. Tarayıcıda
-- açık olan anon key ile herkes PostgREST üzerinden çalışan rolünü Yönetici yapabilir,
-- e-posta değiştirip hesap ele geçirebilir, puantajı değiştirebilirdi.
--
-- Yeni model: uygulama verisine YALNIZCA Next.js API route'ları erişir (service role,
-- RLS'yi bypass eder) ve yetkiyi kendisi kontrol eder (requireAuth / requireMinRole).
-- Bu yüzden tüm tablolarda RLS açılır ve anon/authenticated için HİÇBİR policy yoktur:
-- anon key ile doğrudan okuma/yazma tamamen kapalıdır.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  p RECORD;
  app_tables TEXT[] := ARRAY[
    'employees', 'roles', 'shift_assignments', 'attendance_records', 'shift_templates',
    'qr_tokens', 'store_locations', 'leave_requests', 'notifications', 'open_shifts',
    'employee_availability', 'shift_swap_requests', 'manual_time_correction_requests'
  ];
BEGIN
  FOREACH t IN ARRAY app_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Tüm mevcut policy'leri kaldır (repodakiler + dashboard'dan elle eklenmiş olanlar)
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Tablo yetkileri: anon/authenticated hiçbir şey yapamaz (RLS'e ek savunma katmanı)
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Kullanılmayan ve anon tarafından çağrılabilen SECURITY DEFINER fonksiyon
-- (herhangi bir auth uid'si için çalışan kaydı döndürüyordu)
DROP FUNCTION IF EXISTS public.get_employee_by_auth_uid(UUID);

-- Yeni tablolar için varsayılan: anon/authenticated'a otomatik yetki verilmesin
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
