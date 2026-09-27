-- Seed: örnek çalışanlar ve bugünün vardiyaları
-- Çalıştırmak için: npx supabase db execute --file supabase/seed.sql

-- Çalışanlar
INSERT INTO employees (id, full_name, role, active) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Ahmet Kaya',   'Kasiyer',           TRUE),
  ('a1000000-0000-0000-0000-000000000002', 'Ayşe Demir',   'Reyon Görevlisi',   TRUE),
  ('a1000000-0000-0000-0000-000000000003', 'Mehmet Can',   'Depo Sorumlusu',    TRUE)
ON CONFLICT (id) DO NOTHING;

-- Bugünün vardiyaları (CURRENT_DATE = veritabanı sunucusunun günü)
INSERT INTO shift_assignments (id, employee_id, work_date, start_time, end_time) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', CURRENT_DATE, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', CURRENT_DATE, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', CURRENT_DATE, '14:00', '22:00')
ON CONFLICT (id) DO NOTHING;
