-- Seed: örnek çalışanlar ve bugünün vardiyaları (yerel geliştirme)
-- Çalıştırmak için: npx supabase db reset  (migration'lardan sonra otomatik çalışır)

-- İkinci mağaza (ana mağaza 0003-…001 migration'da oluşturulur) — çoklu mağaza denemesi için
INSERT INTO stores (id, name) VALUES
  ('00000000-0000-0000-0003-000000000002', 'Kadıköy Mağazası')
ON CONFLICT (id) DO NOTHING;

-- Çalışanlar
-- role_id: 0006 Kasiyer, 0009 Reyon Sorumlusu, 0007 Depo Çalışanı
INSERT INTO employees (id, full_name, active, role_id, employment_type, store_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Ahmet Kaya',   TRUE, '00000000-0000-0000-0000-000000000006', 'full_time', '00000000-0000-0000-0003-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', 'Ayşe Demir',   TRUE, '00000000-0000-0000-0000-000000000009', 'full_time', '00000000-0000-0000-0003-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', 'Mehmet Can',   TRUE, '00000000-0000-0000-0000-000000000007', 'part_time', '00000000-0000-0000-0003-000000000002')
ON CONFLICT (id) DO NOTHING;

-- Bugünün vardiyaları — "bugün" Türkiye saatine göre (DB sunucusu UTC'de çalışır)
-- store_id verilmez: trigger çalışanın mağazasını yazar
INSERT INTO shift_assignments (id, employee_id, work_date, start_time, end_time) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '09:00', '18:00'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', (NOW() AT TIME ZONE 'Europe/Istanbul')::date, '14:00', '22:00')
ON CONFLICT (id) DO NOTHING;
