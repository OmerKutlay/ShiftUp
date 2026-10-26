-- ============================================================
-- Mağaza aylık norm saati (işgücü saat bütçesi)
-- Üst yönetim her ay mağazanın kadrosuna ve satışına göre bir "norm hakkı" belirler; bu, çalışan
-- değil MAĞAZA bazlıdır. Satır yoksa norm kayıt edilmez, uygulamada hesaplanır (src/lib/storeNorm.ts).
-- Servis rolü dışında erişim yok: RLS açık, politika yok.
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.store_monthly_norms (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  month       DATE         NOT NULL CHECK (month = date_trunc('month', month)::date),  -- ayın ilk günü
  norm_hours  NUMERIC(8,1) NOT NULL CHECK (norm_hours > 0),
  note        TEXT,
  set_by      UUID         REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, month)
);

CREATE INDEX IF NOT EXISTS idx_store_monthly_norms_month ON public.store_monthly_norms (month);

ALTER TABLE public.store_monthly_norms ENABLE ROW LEVEL SECURITY;
