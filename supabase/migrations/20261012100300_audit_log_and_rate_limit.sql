-- ============================================================
-- Denetim kaydı (audit log) + paylaşılan rate limiter.
-- ============================================================

-- ─── audit_logs ──────────────────────────────────────────────
-- Override, mesai düzeltme, izin/takas kararları, çalışan yönetimi gibi hassas
-- işlemlerde kim, neyi, hangi eski/yeni değerle değiştirdi.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        REFERENCES employees(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit_logs FROM anon, authenticated;

-- Denetim kaydı değiştirilemez / silinemez (service role dahil, trigger ile)
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs kayıtları değiştirilemez veya silinemez';
END $$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ─── rate_limits ─────────────────────────────────────────────
-- Bellek içi sayaç serverless'ta / birden çok instance'ta işe yaramaz; sayaç
-- Postgres'te tutulur ve tek ifadede atomik artırılır.
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT        PRIMARY KEY,
  count    INTEGER     NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION rate_limit_hit(p_key TEXT, p_limit INTEGER, p_window_ms INTEGER)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_reset TIMESTAMPTZ;
  v_window INTERVAL := make_interval(secs => p_window_ms / 1000.0);
BEGIN
  INSERT INTO rate_limits AS r (key, count, reset_at)
  VALUES (p_key, 1, NOW() + v_window)
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN r.reset_at <= NOW() THEN 1 ELSE r.count + 1 END,
        reset_at = CASE WHEN r.reset_at <= NOW() THEN NOW() + v_window ELSE r.reset_at END
  RETURNING r.count, r.reset_at INTO v_count, v_reset;

  -- Fırsatçı temizlik: süresi çoktan dolmuş anahtarlar
  IF random() < 0.01 THEN
    DELETE FROM rate_limits WHERE rate_limits.reset_at < NOW() - INTERVAL '1 hour';
  END IF;

  RETURN QUERY SELECT v_count <= p_limit, GREATEST(p_limit - v_count, 0), v_reset;
END $$;

REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;
