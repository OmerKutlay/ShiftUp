-- ============================================================
-- Duyurular: mağaza duyuruları + okundu / "okudum" onayı takibi.
--   announcements            duyuru (store_id NULL = tüm mağazalar, yalnızca Admin yayınlar)
--   announcement_recipients  yayın anındaki alıcı anlık görüntüsü (okundu/onay istatistiği,
--                            sonradan çalışan değişse de sabit kalır)
-- Bildirim tipi 'announcement' önceki migration'da (20261028140000) eklenir.
-- RLS açık, politika yok: erişim yalnızca service role ile (API route'ları).
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID        REFERENCES public.stores(id),            -- NULL = şirket geneli
  title            TEXT        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body             TEXT        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  pinned           BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_ack     BOOLEAN     NOT NULL DEFAULT FALSE,
  target_roles     TEXT        NOT NULL DEFAULT 'all' CHECK (target_roles IN ('all', 'managers')),
  expires_at       TIMESTAMPTZ,
  created_by       UUID        NOT NULL REFERENCES public.employees(id),
  last_reminded_at TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_store_created
  ON public.announcements (store_id, created_at DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON public.announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.announcement_recipients (
  announcement_id UUID        NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  ack_at          TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_recipients_employee
  ON public.announcement_recipients (employee_id, created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcements FROM anon, authenticated;
REVOKE ALL ON public.announcement_recipients FROM anon, authenticated;
