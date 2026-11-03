-- ============================================================
-- Yönetilebilir izin türleri
--
-- leave_requests.leave_type puantaj / bordro / izin bakiyesinin anladığı TEMEL türdür (puantaj kodu):
--   annual → Yİ (yıllık izin bakiyesinden düşer) · sick → Rİ · unpaid → Üİ (SGK eksik gün) ·
--   personal / other → Mİ (ücretli mazeret) · public_holiday → RT (resmi tatil) · weekly_rest → HT
-- leave_type_definitions şirket genelindeki ADLANDIRILMIŞ türlerdir (Admin, Ayarlar › İzin türleri):
-- her tanım bir temel türe bağlıdır; izin kaydı tanımı leave_type_def_id ile taşır, leave_type tanımın
-- temel türüdür. Böylece yeni bir tür (ör. "Doğum izni" → Mİ) puantaj ve bordroya dokunmadan eklenir.
--
--   - Temel tür tanım oluşturulduktan sonra değişmez (geçmiş kayıtların puantaj kodu kaymasın).
--   - Tanım silinmez, pasifleştirilir (geçmiş kayıtlar adıyla görünmeye devam eder).
--   - employee_requestable: çalışan kendi adına talep edebilir mi (resmi tatil yalnızca yönetici atar).
--   - Sistem tanımları (system_key) mevcut temel türler için tohumlanır; mevcut kayıtlar bunlara bağlanır.
--
-- Canlı şemada leave_type bir enum'dur (repo tabanında TEXT + CHECK): yeni temel tür koşullu eklenir ve
-- bu migration'da enum değeri olarak kullanılmaz (CHECK metin karşılaştırmasıdır).
-- Servis rolü dışında erişim yok: RLS açık, politika yok. İdempotent.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'leave_type' AND n.nspname = 'public' AND t.typtype = 'e') THEN
    ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'public_holiday';
  END IF;
END $$;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_type_check
  CHECK (leave_type::text IN ('annual', 'sick', 'personal', 'unpaid', 'other', 'weekly_rest', 'public_holiday')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.leave_type_definitions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  base_type            TEXT        NOT NULL
                       CHECK (base_type IN ('annual', 'sick', 'personal', 'unpaid', 'other', 'public_holiday')),
  employee_requestable BOOLEAN     NOT NULL DEFAULT true,
  active               BOOLEAN     NOT NULL DEFAULT true,
  sort_order           INT         NOT NULL DEFAULT 100,
  system_key           TEXT        UNIQUE,
  created_by           UUID        REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_type_definitions_name
  ON public.leave_type_definitions (lower(btrim(name)));

ALTER TABLE public.leave_type_definitions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_leave_type_definitions_updated_at ON public.leave_type_definitions;
CREATE TRIGGER trg_leave_type_definitions_updated_at
  BEFORE UPDATE ON public.leave_type_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Temel türün değişmesini engelle (geçmiş kayıtların puantaj kodu)
CREATE OR REPLACE FUNCTION private.leave_type_definitions_freeze_base()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.base_type IS DISTINCT FROM OLD.base_type THEN
    RAISE EXCEPTION 'İzin türünün puantaj kodu değiştirilemez.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leave_type_definitions_freeze_base ON public.leave_type_definitions;
CREATE TRIGGER trg_leave_type_definitions_freeze_base
  BEFORE UPDATE ON public.leave_type_definitions
  FOR EACH ROW EXECUTE FUNCTION private.leave_type_definitions_freeze_base();

INSERT INTO public.leave_type_definitions (name, base_type, employee_requestable, active, sort_order, system_key) VALUES
  ('Yıllık izin',     'annual',         true,  true,  10, 'annual'),
  ('Hastalık raporu', 'sick',           true,  true,  20, 'sick'),
  ('Ücretsiz izin',   'unpaid',         true,  true,  30, 'unpaid'),
  ('Ücretli izin',    'personal',       true,  true,  40, 'personal'),
  ('Resmi tatil',     'public_holiday', false, true,  50, 'public_holiday'),
  ('Diğer',           'other',          true,  false, 90, 'other')
ON CONFLICT (system_key) DO NOTHING;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS leave_type_def_id UUID REFERENCES public.leave_type_definitions(id) ON DELETE SET NULL;

-- Mevcut kayıtlar temel türlerinin sistem tanımına bağlanır (haftalık tatil tanım taşımaz).
-- updated_at tetikleyicisi bu bağlama sırasında kapalı: kayıtların değiştirilme zamanı korunur.
DO $$
DECLARE v_trg BOOLEAN := EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.leave_requests'::regclass AND tgname = 'trg_leave_requests_updated_at');
BEGIN
  IF v_trg THEN ALTER TABLE public.leave_requests DISABLE TRIGGER trg_leave_requests_updated_at; END IF;
  UPDATE public.leave_requests lr
     SET leave_type_def_id = d.id
    FROM public.leave_type_definitions d
   WHERE lr.leave_type_def_id IS NULL
     AND d.system_key = lr.leave_type::text
     AND lr.leave_type::text <> 'weekly_rest';
  IF v_trg THEN ALTER TABLE public.leave_requests ENABLE TRIGGER trg_leave_requests_updated_at; END IF;
END $$;
