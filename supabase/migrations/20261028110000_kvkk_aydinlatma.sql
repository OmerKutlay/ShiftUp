-- ============================================================
-- KVKK (6698) aydınlatma metni altyapısı.
--
--  * company_settings: şirket geneli (mağazadan bağımsız) tek satırlık ayar — veri sorumlusu
--    unvanı, adresi ve KVKK başvuru e-postası. /gizlilik sayfasındaki aydınlatma metnine yazılır.
--  * employees.kvkk_notice_ack_at / kvkk_notice_version: çalışanın aydınlatma metnini
--    "okudum, bilgilendirildim" diye onayladığı an ve metin sürümü. Bu bir RIZA değildir;
--    işleme dayanağı İş Kanunu / sözleşme / meşru menfaattir (KVKK m.5/2-c, ç, f).
--
-- Konum: QR okutulurken alınan ham GPS koordinatı (enlem/boylam) HİÇBİR tabloya yazılmaz;
-- attendance_records yalnızca mağazaya uzaklık (location_distance_m) ve doğruluk
-- (location_accuracy_m) tamsayılarını tutar. Bu yüzden ham koordinat için temizlik işi (cron)
-- gerekmez.
--
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_settings (
  id            BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),  -- tek satır
  legal_name    TEXT,
  address       TEXT,
  kvkk_email    TEXT,
  updated_by    UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_settings_len_check CHECK (
    char_length(coalesce(legal_name, '')) <= 200
    AND char_length(coalesce(address, '')) <= 500
    AND char_length(coalesce(kvkk_email, '')) <= 200
  )
);

INSERT INTO public.company_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Yalnızca sunucu erişimi (lockdown_rls modeli): RLS açık, policy yok
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_settings FROM anon, authenticated;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS kvkk_notice_ack_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kvkk_notice_version TEXT;
