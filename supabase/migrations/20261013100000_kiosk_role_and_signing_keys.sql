-- ============================================================
-- Kiosk rolü + yerel imzalı QR (kiosk_keys / qr_scan_uses)
--
-- Önceki model: kiosk ekranı müdür oturumuyla açılıyor, 10 sn'de bir /api/qr/generate ve
-- 1.5 sn'de bir /api/qr/status çağırıyordu (dakikada ~46 istek).
--
-- Yeni model:
--   * "Kiosk" rolündeki hesap yalnızca kiosk ekranını açabilir (müdür oturumu gerekmez).
--   * Kiosk saatte bir kısa ömürlü imzalama anahtarı alır (kiosk_keys = "access token");
--     oturumun kendisi Supabase Auth refresh token'ı ile döner.
--   * QR kodları tarayıcıda HMAC-SHA256(secret, "SU1.<key_id>.<step>") ile 15 sn'lik
--     pencerelerde üretilir; sunucu imzayı, pencereyi ve tekrar kullanımı doğrular.
--   * qr_scan_uses: aynı çalışan aynı kodu (anahtar + pencere) ikinci kez kullanamaz.
-- ============================================================

INSERT INTO roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000005', 'Kiosk', 'QR kiosk cihazı — yalnızca kiosk ekranı')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kiosk_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  secret      TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kiosk_keys_employee ON public.kiosk_keys(employee_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_keys_expires ON public.kiosk_keys(expires_at);

CREATE TABLE IF NOT EXISTS public.qr_scan_uses (
  key_id      UUID NOT NULL REFERENCES public.kiosk_keys(id) ON DELETE CASCADE,
  time_step   BIGINT NOT NULL,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, time_step, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_qr_scan_uses_created ON public.qr_scan_uses(created_at);

-- "Yalnızca sunucu" erişim modeli (bkz. 20261012100200_lockdown_rls.sql)
ALTER TABLE public.kiosk_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_scan_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kiosk_keys FROM anon, authenticated;
REVOKE ALL ON public.qr_scan_uses FROM anon, authenticated;
