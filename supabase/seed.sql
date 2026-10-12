-- Seed: örnek çalışanlar ve bugünün vardiyaları (yerel geliştirme)
-- Çalıştırmak için: npx supabase db reset  (migration'lardan sonra otomatik çalışır)

-- Çalışanlar
INSERT INTO employees (id, full_name, role, active, role_id, employment_type) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Ahmet Kaya',   'Kasiyer',           TRUE, '00000000-0000-0000-0000-000000000004', 'full_time'),
  ('a1000000-0000-0000-0000-000000000002', 'Ayşe Demir',   'Reyon Görevlisi',   TRUE, '00000000-0000-0000-0000-000000000004', 'full_time'),
  ('a1000000-0000-0000-0000-000000000003', 'Mehmet Can',   'Depo Sorumlusu',    TRUE, '00000000-0000-0000-0000-000000000004', 'part_time')
ON CONFLICT (id) DO NOTHING;

-- Bugünün vardiyaları — "bugün" Türkiye saatine göre (DB sunucusu UTC'de çalışır)
INSERT INTO shift_assignments (id, employee_id, work_date, start_time, end_time) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '14:00', '22:00')
ON CONFLICT (id) DO NOTHING;
