-- ============================================================
-- Web Push bildirimleri: cihaz abonelikleri + notifications → send-push tetikleyicisi.
--
-- Bildirimler hem uygulamadan (API route'ları) hem de dışarıdan (shift-reminder Edge
-- Function, pg_cron) eklendiği için push dağıtımı veritabanından tetiklenir:
-- notifications'a INSERT → (ifade başına tek) pg_net isteği → send-push Edge Function.
--
-- Fonksiyon adresi ve paylaşılan anahtar Supabase Vault'tan okunur:
--   push_function_url   → https://<proje>.supabase.co/functions/v1/send-push
--   push_webhook_secret → Edge Function'daki PUSH_WEBHOOK_SECRET ile aynı değer
-- pg_net veya secret'lar yoksa tetikleyici sessizce hiçbir şey yapmaz; bildirim
-- eklemeyi ASLA hata verdirmez ve yavaşlatmaz (pg_net istekleri commit sonrası arka planda
-- gönderilir; rollback olan işlemde istek de düşer).
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

-- pg_net (Supabase'de mevcut; düz Postgres'te yoksa migration yine de başarılı olur)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net kurulamadı (%); push tetikleyicisi devre dışı kalacak.', SQLERRM;
END $$;

-- ─── push_subscriptions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  endpoint        TEXT        NOT NULL UNIQUE,
  p256dh          TEXT,
  auth            TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  failure_count   INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee ON public.push_subscriptions(employee_id);

-- Yalnızca sunucu erişimi (lockdown_rls modeli): RLS açık, anon/authenticated için policy yok
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- ─── notifications AFTER INSERT → send-push ──────────────────
-- İfade (statement) seviyesinde: notifyManagers gibi toplu insert'ler tek istekle gider.
-- Yalnızca push aboneliği olan çalışanların bildirim id'leri gönderilir; Edge Function
-- içeriği veritabanından yeniden okur (istek gövdesine güvenmez).
CREATE OR REPLACE FUNCTION public.notifications_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids    UUID[];
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT array_agg(n.id) INTO v_ids
    FROM new_rows n
    WHERE EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.employee_id = n.employee_id);

    IF v_ids IS NULL THEN RETURN NULL; END IF;
    IF to_regnamespace('net') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'push_function_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL OR v_url = '' OR v_secret = '' THEN
      RETURN NULL;
    END IF;

    PERFORM net.http_post(
      url                  := v_url,
      body                 := jsonb_build_object('notification_ids', to_jsonb(v_ids)),
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'x-push-secret', v_secret
                              ),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Push en iyi çaba (best effort): bildirim kaydı her durumda tamamlanır
    RAISE LOG 'notifications_push_fanout atlandı: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notifications_push_fanout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_push_fanout ON public.notifications;
CREATE TRIGGER trg_notifications_push_fanout
  AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notifications_push_fanout();
