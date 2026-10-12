-- ============================================================
-- Resmi tatiller (UBGT) + fazla çalışma onayı
-- ============================================================

-- ─── public_holidays ─────────────────────────────────────────
-- 2429 sayılı Kanun: ulusal bayram ve genel tatiller. Dini bayram tarihleri her yıl
-- değiştiği için tablo Ayarlar ekranından yönetilebilir; aşağıdaki kayıtlar başlangıç
-- verisidir. half_day: arife günleri 13:00'ten itibaren tatildir.
-- İş K. Md. 47: bu günlerde çalışan işçiye ayrıca bir günlük ücret ödenir.
CREATE TABLE IF NOT EXISTS public_holidays (
  date       DATE        PRIMARY KEY,
  name       TEXT        NOT NULL,
  half_day   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public_holidays FROM anon, authenticated;

INSERT INTO public_holidays (date, name, half_day) VALUES
  -- 2026
  ('2026-01-01', 'Yılbaşı', FALSE),
  ('2026-03-19', 'Ramazan Bayramı Arifesi', TRUE),
  ('2026-03-20', 'Ramazan Bayramı 1. Gün', FALSE),
  ('2026-03-21', 'Ramazan Bayramı 2. Gün', FALSE),
  ('2026-03-22', 'Ramazan Bayramı 3. Gün', FALSE),
  ('2026-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', FALSE),
  ('2026-05-01', 'Emek ve Dayanışma Günü', FALSE),
  ('2026-05-19', 'Atatürk''ü Anma, Gençlik ve Spor Bayramı', FALSE),
  ('2026-05-26', 'Kurban Bayramı Arifesi', TRUE),
  ('2026-05-27', 'Kurban Bayramı 1. Gün', FALSE),
  ('2026-05-28', 'Kurban Bayramı 2. Gün', FALSE),
  ('2026-05-29', 'Kurban Bayramı 3. Gün', FALSE),
  ('2026-05-30', 'Kurban Bayramı 4. Gün', FALSE),
  ('2026-07-15', 'Demokrasi ve Millî Birlik Günü', FALSE),
  ('2026-08-30', 'Zafer Bayramı', FALSE),
  ('2026-10-28', 'Cumhuriyet Bayramı Arifesi', TRUE),
  ('2026-10-29', 'Cumhuriyet Bayramı', FALSE),
  -- 2027
  ('2027-01-01', 'Yılbaşı', FALSE),
  ('2027-03-08', 'Ramazan Bayramı Arifesi', TRUE),
  ('2027-03-09', 'Ramazan Bayramı 1. Gün', FALSE),
  ('2027-03-10', 'Ramazan Bayramı 2. Gün', FALSE),
  ('2027-03-11', 'Ramazan Bayramı 3. Gün', FALSE),
  ('2027-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', FALSE),
  ('2027-05-01', 'Emek ve Dayanışma Günü', FALSE),
  ('2027-05-15', 'Kurban Bayramı Arifesi', TRUE),
  ('2027-05-16', 'Kurban Bayramı 1. Gün', FALSE),
  ('2027-05-17', 'Kurban Bayramı 2. Gün', FALSE),
  ('2027-05-18', 'Kurban Bayramı 3. Gün', FALSE),
  ('2027-05-19', 'Kurban Bayramı 4. Gün / Atatürk''ü Anma, Gençlik ve Spor Bayramı', FALSE),
  ('2027-07-15', 'Demokrasi ve Millî Birlik Günü', FALSE),
  ('2027-08-30', 'Zafer Bayramı', FALSE),
  ('2027-10-28', 'Cumhuriyet Bayramı Arifesi', TRUE),
  ('2027-10-29', 'Cumhuriyet Bayramı', FALSE)
ON CONFLICT (date) DO NOTHING;

-- ─── Fazla çalışma onayı (İş K. Md. 41/8) ────────────────────
-- Fazla çalışma için işçinin yazılı onayı gerekir; onay tarihi saklanır.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS overtime_consent_at DATE;
