-- ============================================================
-- Güvenlik denetimi — salt okunur sorgular (hiçbir şeyi değiştirmez).
-- Supabase SQL Editor'da veya `psql "$DATABASE_URL" -f supabase/audit/security_audit.sql`
-- ile çalıştırılır. Her bölüm sorunlu satırları listeler; boş sonuç = sorun yok.
-- ============================================================

-- 1) public'te RLS kapalı tablolar
SELECT '1_rls_disabled' AS check, c.relname AS object
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 2;

-- 1b) public'teki tüm policy'ler (yalnızca sunucu modelinde bu liste boş olmalı)
SELECT '1b_policy' AS check, tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 1c) "true" olan veya auth.uid() içermeyen policy'ler (tüm şemalar, sistem şemaları hariç;
--     erişimi tümden kapatan "false" policy'leri — deny_client_access — sorun değildir)
SELECT '1c_weak_policy' AS check, schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname NOT IN ('storage', 'auth', 'realtime', 'supabase_functions', 'extensions')
  AND NOT (coalesce(qual, 'false') = 'false' AND coalesce(with_check, 'false') = 'false')
  AND (coalesce(qual, '') IN ('true', '(true)') OR coalesce(with_check, '') IN ('true', '(true)')
       OR (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%auth.uid()%')
ORDER BY 2, 3;

-- 2) public'teki view'lar: security_invoker ve anon/authenticated yazma yetkisi
SELECT '2_view' AS check, c.relname AS view,
       coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') AS security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') AS anon_write,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') AS auth_write
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
ORDER BY 2;

-- 3) anon/authenticated'ın herhangi bir yetkisi olan public tablo/view'lar
SELECT '3_table_grant' AS check, table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY table_name, grantee
ORDER BY 2, 3;

-- 3b) Yeni nesnelerin varsayılan yetkileri (anon/authenticated/PUBLIC görünmemeli)
SELECT '3b_default_acl' AS check, pg_get_userbyid(d.defaclrole) AS owner, n.nspname AS schema,
       CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'f' THEN 'functions' WHEN 'S' THEN 'sequences' ELSE d.defaclobjtype::text END AS kind,
       d.defaclacl::text AS acl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE (n.nspname = 'public' OR n.nspname IS NULL)
  AND (d.defaclacl::text ~ '(^|[{,])(anon|authenticated)=' OR d.defaclacl::text ~ '(^|[{,])=')
ORDER BY 2, 4;

-- 4) Tüm ON DELETE CASCADE foreign key'leri
SELECT '4_cascade' AS check, con.conrelid::regclass AS child, a.attname AS column,
       con.confrelid::regclass AS parent
FROM pg_constraint con
JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
WHERE con.contype = 'f' AND con.confdeltype = 'c'
  AND con.connamespace = 'public'::regnamespace
ORDER BY 4, 2;

-- 5) SECURITY DEFINER fonksiyonları: kim çalıştırabilir, search_path sabit mi?
SELECT '5_definer' AS check, p.oid::regprocedure AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       coalesce(array_to_string(p.proconfig, ','), '— search_path YOK') AS config
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
ORDER BY 3 DESC, 4 DESC, 2::text;

-- 5b) anon/authenticated'ın çalıştırabildiği TÜM public fonksiyonlar (RPC yüzeyi)
SELECT '5b_rpc_surface' AS check, p.oid::regprocedure AS function, p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prorettype <> 'trigger'::regtype
  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY 2::text;

-- 6) Yetki veren employees/roles kolonlarına anon/authenticated'ın kolon bazında yazma yetkisi
SELECT '6_column_write' AS check, table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name IN ('employees', 'roles')
  AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE')
ORDER BY 2, 3;

-- 8) pg_cron işleri (cron şeması varsa)
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    RAISE NOTICE '8_cron: %', (SELECT string_agg(jobname || ' [' || schedule || '] ' || command, E'\n') FROM cron.job);
  END IF;
END $$;

-- 9) Storage bucket'ları (public olanlar listelenir)
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    RAISE NOTICE '9_public_buckets: %', (SELECT coalesce(string_agg(id, ', '), 'yok') FROM storage.buckets WHERE public);
  END IF;
END $$;
