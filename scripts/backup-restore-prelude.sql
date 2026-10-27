-- Yedek geri yükleme testi için boş veritabanı hazırlığı (CI: .github/workflows/db-backup.yml).
-- Yedek yalnızca public + private şemalarını içerir; Supabase platform nesnelerinin
-- (roller, auth.users, extensions) geri yüklemenin derlenmesine yetecek kadarı burada oluşturulur.
-- YALNIZCA boş, geçici bir test veritabanında çalıştırın: public şemasını siler.
DROP SCHEMA IF EXISTS public CASCADE;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
