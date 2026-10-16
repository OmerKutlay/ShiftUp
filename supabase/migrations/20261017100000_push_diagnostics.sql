-- ============================================================
-- Web Push teşhis araçları.
--
-- 1) 'push_test' bildirim tipi (POST /api/push/test — "Test bildirimi gönder").
--    Canlıda notifications.type bir enum (notification_type); sıfırdan kurulumda kolon
--    TEXT olduğundan enum yoksa bu adım hiçbir şey yapmaz (20261012050000 ile aynı desen).
--
-- 2) public.push_diagnostics() — push zincirinin hangi halkasının eksik olduğunu söyler:
--    pg_net, Vault erişimi, Vault secret'ları (yalnızca var/yok — değerler ASLA dönmez),
--    tetikleyici, abonelik sayısı ve send-push'a yapılan son çağrıların yanıt kodları.
--    Her parça ayrı korunur: eksik şema/tablo hata yerine false / boş liste döndürür.
--    Yalnızca service_role çalıştırabilir (GET /api/push/diagnostics, Mağaza Müdürü+).
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

-- ─── 1) Enum değeri ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS ''push_test''';
  END IF;
END $$;

-- ─── 2) push_diagnostics() ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pg_net         BOOLEAN := false;
  v_vault          BOOLEAN := false;
  v_function_url   BOOLEAN := false;
  v_webhook_secret BOOLEAN := false;
  v_trigger        BOOLEAN := false;
  v_subscriptions  INTEGER := 0;
  v_responses      JSONB   := '[]'::jsonb;
BEGIN
  -- pg_net eklentisi
  BEGIN
    v_pg_net := EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_net');
  EXCEPTION WHEN OTHERS THEN v_pg_net := false;
  END;

  -- Vault erişimi + secret'lar (yalnızca dolu mu? — değer döndürülmez)
  BEGIN
    IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = $1 AND COALESCE(decrypted_secret, '''') <> '''')'
        INTO v_function_url USING 'push_function_url';
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = $1 AND COALESCE(decrypted_secret, '''') <> '''')'
        INTO v_webhook_secret USING 'push_webhook_secret';
      v_vault := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_vault := false;
    v_function_url := false;
    v_webhook_secret := false;
  END;

  -- notifications üzerindeki push tetikleyicisi (var ve etkin)
  BEGIN
    IF to_regclass('public.notifications') IS NOT NULL THEN
      v_trigger := EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.notifications'::regclass
          AND t.tgname = 'trg_notifications_push_fanout'
          AND t.tgenabled <> 'D'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN v_trigger := false;
  END;

  -- Toplam push aboneliği
  BEGIN
    IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
      EXECUTE 'SELECT count(*)::int FROM public.push_subscriptions' INTO v_subscriptions;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_subscriptions := 0;
  END;

  -- pg_net'in son 5 yanıtı (send-push çağrıları; pg_net bunları ~6 saat tutar)
  BEGIN
    IF to_regclass('net._http_response') IS NOT NULL THEN
      EXECUTE $q$
        SELECT COALESCE(jsonb_agg(r ORDER BY r.created DESC), '[]'::jsonb)
        FROM (
          SELECT status_code,
                 left(error_msg, 200) AS error_msg,
                 left(content::text, 200) AS content,
                 created
          FROM net._http_response
          ORDER BY created DESC
          LIMIT 5
        ) r
      $q$ INTO v_responses;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_responses := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'pg_net', v_pg_net,
    'vault', v_vault,
    'function_url', v_function_url,
    'webhook_secret', v_webhook_secret,
    'trigger', v_trigger,
    'subscriptions', v_subscriptions,
    'recent_responses', v_responses
  );
END $$;

REVOKE ALL ON FUNCTION public.push_diagnostics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_diagnostics() TO service_role;
