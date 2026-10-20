-- ============================================================
-- Sistem rolü tek kaynak: yetki (access_level) + planlama görevi (planning_group)
--
-- Önceden yetki rol adından ('Yönetici', 'Mağaza Müdürü'…), planlamadaki görev ise serbest
-- metin employees.role (pozisyon/unvan) içinde kelime aranarak bulunuyordu. Artık:
--   roles.access_level   → admin > store_manager > manager > employee (+ kiosk, hiyerarşi dışı)
--   roles.planning_group → planlayıcıdaki görev; NULL = vardiya planına girmez
--   roles.sort_order     → listelerde sıra
-- Kod rol adına bakmaz; rol adı yalnızca gösterim içindir. employees.role kaldırılır.
-- ============================================================

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS access_level   TEXT,
  ADD COLUMN IF NOT EXISTS planning_group TEXT,
  ADD COLUMN IF NOT EXISTS sort_order     INT NOT NULL DEFAULT 100;

-- ── Mevcut roller ────────────────────────────────────────────
UPDATE public.roles SET name = 'Admin', description = 'Tam sistem erişimi — vardiya planına girmez',
  access_level = 'admin', planning_group = NULL, sort_order = 0
  WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE public.roles SET description = 'Mağaza yönetimi, ayarlar ve planlama',
  access_level = 'store_manager', planning_group = 'store_manager', sort_order = 10
  WHERE id = '00000000-0000-0000-0000-000000000002';
UPDATE public.roles SET description = 'Yönetici yetkisi — açılış/kapanış yönetici kapsaması',
  access_level = 'manager', planning_group = 'assistant_manager', sort_order = 20
  WHERE id = '00000000-0000-0000-0000-000000000003';
UPDATE public.roles SET name = 'Satış Danışmanı', description = 'Çalışan — satış katı',
  access_level = 'employee', planning_group = 'sales', sort_order = 60
  WHERE id = '00000000-0000-0000-0000-000000000004';
UPDATE public.roles SET access_level = 'kiosk', planning_group = NULL, sort_order = 200
  WHERE id = '00000000-0000-0000-0000-000000000005';

-- ── Yeni roller ──────────────────────────────────────────────
INSERT INTO public.roles (id, name, description, access_level, planning_group, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000006', 'Kasiyer',                 'Çalışan — kasa',                                         'employee', 'cashier',   50),
  ('00000000-0000-0000-0000-000000000007', 'Depo Çalışanı',           'Çalışan — depo, 08:00 sabit mesai',                      'employee', 'stock',     70),
  ('00000000-0000-0000-0000-000000000008', 'Görsel Uzmanı',           'Yönetici yetkisi — görsel düzen, 08:00 sabit mesai',     'manager',  'visual',    40),
  ('00000000-0000-0000-0000-000000000009', 'Reyon Sorumlusu',         'Yönetici yetkisi — açılış/kapanış yönetici kapsaması',   'manager',  'floor_lead', 30),
  ('00000000-0000-0000-0000-000000000010', 'Admin · Kasiyer',         'Tam sistem erişimi — kasiyer olarak planlanır',          'admin',    'cashier',    1),
  ('00000000-0000-0000-0000-000000000011', 'Admin · Satış Danışmanı', 'Tam sistem erişimi — satış danışmanı olarak planlanır',   'admin',    'sales',      2)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.roles
  ALTER COLUMN access_level SET NOT NULL,
  ADD CONSTRAINT roles_access_level_check
    CHECK (access_level IN ('admin', 'store_manager', 'manager', 'employee', 'kiosk')),
  ADD CONSTRAINT roles_planning_group_check
    CHECK (planning_group IS NULL OR planning_group IN
      ('store_manager', 'assistant_manager', 'floor_lead', 'visual', 'stock', 'cashier', 'sales')),
  -- Kiosk cihaz hesabı hiçbir zaman planlanmaz
  ADD CONSTRAINT roles_kiosk_not_planned_check
    CHECK (access_level <> 'kiosk' OR planning_group IS NULL);

-- ── Çalışanları yeni rollere taşı (pozisyon metninden, son kez) ──
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000010'
  WHERE role ILIKE '%şef kasiyer%';
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000011'
  WHERE full_name = 'Eminenur Akgün';
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000008'
  WHERE role ILIKE '%görsel%' AND role_id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000007'
  WHERE role ILIKE '%depo%' AND role_id = '00000000-0000-0000-0000-000000000004';
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000006'
  WHERE role ILIKE '%kasiyer%' AND role NOT ILIKE '%şef%' AND role_id = '00000000-0000-0000-0000-000000000004';
UPDATE public.employees SET role_id = '00000000-0000-0000-0000-000000000005'
  WHERE role ILIKE 'kiosk%';

-- ── Pozisyon (serbest metin) kaldırılır ──────────────────────
DROP FUNCTION IF EXISTS public.get_employee_by_auth_uid(UUID);
CREATE FUNCTION public.get_employee_by_auth_uid(p_uid UUID)
RETURNS TABLE (id UUID, full_name TEXT, email TEXT, role_id UUID, active BOOLEAN, auth_user_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT e.id, e.full_name, e.email, e.role_id, e.active, e.auth_user_id
  FROM employees e
  WHERE e.auth_user_id = p_uid
  LIMIT 1;
$$;

ALTER TABLE public.employees DROP COLUMN role;

-- ── Kiosk QR yayını: rol adı yerine yetki seviyesi ───────────
CREATE OR REPLACE FUNCTION public.can_view_kiosk_qr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
    WHERE e.auth_user_id = (SELECT auth.uid())
      AND e.active
      AND r.access_level IN ('kiosk', 'manager', 'store_manager', 'admin')
  );
$$;
