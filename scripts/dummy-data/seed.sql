-- ============================================================
-- ShiftUp — test amaçlı DUMMY veri (employees tablosuna DOKUNMAZ)
-- Temizlik: scripts/dummy-data/cleanup.sql  (ayrıntı: DUMMY_DATA.md)
--
-- Eklenen her satırın id'si public._dummy_seed tablosuna yazılır;
-- temizlik yalnızca bu id'leri siler. Tekrar çalıştırılmaz (koruma var).
--
-- Aralık: 2026-09-01 → 2026-10-31. Amaç: sitenin gerçekten kullanılmış gibi görünmesi.
--   * Plan: elle girilmiş (gerçek) vardiyası olan haftaya dummy vardiya EKLENMEZ — o hafta
--     gerçek plan geçerlidir, yalnızca devam kaydı yazılır. Diğer haftalarda kurallara uygun
--     plan: tam zamanlı 6 gün × 8 sa (42 sa net), yarı zamanlı 4 gün × 5 sa; haftada 1 sabit
--     tatil günü (weekly_rest), aynı hafta aynı vardiya (açılış / ara / kapanış haftalık döner).
--   * Devam: uygulamanın yazacağı gibi — 15 dk'yı aşan geç giriş / erken çıkış çeyrek saate
--     yuvarlanır ve not düşülür (lib/attendanceRounding); molaların toplamı planlı mola kadar
--     (lib/workingTimeService), birden çok mola saatleriyle previous_breaks'te. Fazla çalışma
--     onayı olmayan kimseye fazla mesai yazılmaz.
--   * Bugün: isimle belirlenmiş kontrol senaryoları (bkz. 2a). Saatler çalıştırma anına göre
--     kırpılır; en anlamlı sonuç 11:40 – 14:00 arası çalıştırınca alınır.
--   * Kontrol listeleri (şablon + her günün uygulaması) ve duyurular (alıcılar, okunma/onay).
--   * Bildirimler geçmiş tarihli yazılır; push tetikleyicisi işlem süresince kapalıdır
--     (dummy bildirim telefona gitmez).
--
-- Mod (SET LOCAL dummy.mode = '...'):
--   full     (varsayılan) tüm aktif çalışanlar (Kiosk hariç), _dummy_seed boş olmalı
--   yonetici yalnızca henüz dummy vardiyası olmayan Yönetici hesapları; açık vardiya, takas,
--            bugünkü senaryolar, kontrol listesi ve duyuru üretmez
-- ============================================================

CREATE TABLE IF NOT EXISTS public._dummy_seed (
  tbl        TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tbl, id)
);
ALTER TABLE public._dummy_seed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._dummy_seed FROM anon, authenticated;

-- Dummy bildirimler cihazlara push olarak gitmesin (yalnızca bu işlem süresince)
ALTER TABLE public.notifications DISABLE TRIGGER trg_notifications_push_fanout;

CREATE OR REPLACE FUNCTION pg_temp.trk(p_tbl TEXT, p_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public._dummy_seed (tbl, id) VALUES (p_tbl, p_id::text) ON CONFLICT DO NOTHING;
END $$;

-- Türkiye saatiyle tarih+saat → timestamptz
CREATE OR REPLACE FUNCTION pg_temp.tr_ts(d DATE, t TIME) RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE AS $$
  SELECT (d + t) AT TIME ZONE 'Europe/Istanbul'
$$;

CREATE OR REPLACE FUNCTION pg_temp.hhmi(t TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char(t AT TIME ZONE 'Europe/Istanbul', 'HH24:MI')
$$;

-- Bugünkü senaryo saati: 'HH:MI' (Türkiye saati) ya da '-N' (şimdiden N dk önce); NULL → NULL
CREATE OR REPLACE FUNCTION pg_temp.tt(d DATE, x TEXT, p_now TIMESTAMPTZ) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF x IS NULL THEN RETURN NULL; END IF;
  IF x LIKE '-%' THEN RETURN date_trunc('minute', p_now) - make_interval(mins => substr(x, 2)::int); END IF;
  RETURN (d + x::time) AT TIME ZONE 'Europe/Istanbul';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rnd(lo INT, hi INT) RETURNS INT LANGUAGE sql VOLATILE AS $$
  SELECT lo + floor(random() * (hi - lo + 1))::int
$$;

-- Planlanan mola (dk) — lib/workingTimeService.plannedBreakForGrossMins ile aynı
CREATE OR REPLACE FUNCTION pg_temp.plan_break(gross INT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN gross <= 0 THEN 0 WHEN gross <= 240 THEN 15 WHEN gross >= 660 THEN 120 WHEN gross >= 570 THEN 90 ELSE 60 END
$$;

-- Duyuru önizlemesi — lib/announcementText.previewText ile aynı (140 karakter)
CREATE OR REPLACE FUNCTION pg_temp.preview(body TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(f) > 140 THEN rtrim(left(f, 139)) || '…' ELSE f END
  FROM (SELECT btrim(regexp_replace(body, '\s+', ' ', 'g')) AS f) x
$$;

CREATE OR REPLACE FUNCTION pg_temp.notify(p_emp UUID, p_type TEXT, p_title TEXT, p_msg TEXT, p_rel UUID, p_at TIMESTAMPTZ, p_read BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (employee_id, type, title, message, related_id, created_at, is_read)
  VALUES (p_emp, p_type::notification_type, p_title, p_msg, p_rel, p_at, p_read)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN PERFORM pg_temp.trk('notifications', v_id); END IF;
END $$;

-- Devam kaydı — uygulamanın QR akışının yazacağı biçimde:
--   * okutma saatleri "şimdi"ye göre kırpılır (gelecekteki olay yazılmaz; bitişi gelmemiş son mola sürüyor)
--   * giriş ≥ 15 dk geç / çıkış ≥ 15 dk erken → çeyrek saate yuvarlanır, exception_note'a
--     "Giriş 10:24'de okutuldu, 10:30 olarak işlendi." düşülür (lib/attendanceRounding)
--   * son mola break_start_at / break_end_at'te, öncekiler previous_breaks'te, toplamları
--     completed_break_minutes'ta (lib/attendanceStateMachine)
CREATE OR REPLACE FUNCTION pg_temp.att(
  p_emp UUID, p_sid UUID, p_sched_in TIMESTAMPTZ, p_sched_out TIMESTAMPTZ,
  p_in TIMESTAMPTZ, p_bs TIMESTAMPTZ[], p_be TIMESTAMPTZ[], p_out TIMESTAMPTZ,
  p_method TEXT, p_note TEXT, p_dist INT, p_acc INT, p_now TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  n INT := 0; j INT; late INT; early INT;
  v_prev JSONB := '[]'::jsonb; v_done INT := 0;
  v_in TIMESTAMPTZ := p_in; v_ls TIMESTAMPTZ; v_le TIMESTAMPTZ; v_out TIMESTAMPTZ := p_out; v_floor TIMESTAMPTZ;
  v_notes TEXT[] := ARRAY[]::text[];
  v_status TEXT; v_id UUID;
BEGIN
  IF p_in IS NULL OR p_in > p_now THEN RETURN NULL; END IF;
  IF p_note IS NOT NULL THEN v_notes := v_notes || p_note; END IF;
  IF v_out IS NOT NULL AND v_out > p_now THEN v_out := NULL; END IF;

  late := floor(extract(epoch FROM date_trunc('minute', p_in) - p_sched_in) / 60)::int;
  IF late >= 15 THEN
    v_in := p_sched_in + make_interval(mins => GREATEST(30, ceil(late / 15.0)::int * 15));
    v_notes := v_notes || format('Giriş %s''de okutuldu, %s olarak işlendi.', pg_temp.hhmi(date_trunc('minute', p_in)), pg_temp.hhmi(v_in));
  END IF;

  FOR j IN 1..COALESCE(array_length(p_bs, 1), 0) LOOP
    EXIT WHEN p_bs[j] > p_now OR (v_out IS NOT NULL AND p_bs[j] >= v_out);
    n := j;
  END LOOP;
  FOR j IN 1..n - 1 LOOP
    v_prev := v_prev || jsonb_build_array(jsonb_build_object('start_at', p_bs[j], 'end_at', p_be[j]));
    v_done := v_done + round(extract(epoch FROM p_be[j] - p_bs[j]) / 60)::int;
  END LOOP;
  IF n > 0 THEN
    v_ls := p_bs[n];
    v_le := CASE WHEN p_be[n] <= p_now THEN p_be[n] END;
  END IF;
  IF n > 0 AND v_le IS NULL THEN v_out := NULL; END IF;

  IF v_out IS NOT NULL THEN
    early := floor(extract(epoch FROM p_sched_out - date_trunc('minute', v_out)) / 60)::int;
    IF early >= 15 THEN
      v_floor := GREATEST(v_in, COALESCE(v_le, v_in));
      v_notes := v_notes || format('Çıkış %s''de okutuldu, %s olarak işlendi.', pg_temp.hhmi(date_trunc('minute', v_out)),
        pg_temp.hhmi(GREATEST(p_sched_out - make_interval(mins => GREATEST(30, ceil(early / 15.0)::int * 15)), v_floor)));
      v_out := GREATEST(p_sched_out - make_interval(mins => GREATEST(30, ceil(early / 15.0)::int * 15)), v_floor);
    END IF;
  END IF;

  v_status := CASE WHEN n > 0 AND v_le IS NULL THEN 'on_break'
                   WHEN v_out IS NOT NULL      THEN 'clocked_out'
                   WHEN n > 0                  THEN 'working_after_break'
                   ELSE 'working' END;

  INSERT INTO attendance_records (employee_id, shift_assignment_id, status, clock_in_at, break_start_at, break_end_at, clock_out_at,
                                  completed_break_minutes, previous_breaks, verification_method, exception_note,
                                  location_distance_m, location_accuracy_m, created_at, updated_at)
  VALUES (p_emp, p_sid, v_status::attendance_status, v_in, v_ls, v_le, v_out, v_done, v_prev, p_method,
          NULLIF(array_to_string(v_notes, ' | '), ''), p_dist, p_acc, p_in, COALESCE(v_out, v_le, v_ls, p_in))
  RETURNING id INTO v_id;
  PERFORM pg_temp.trk('attendance_records', v_id);
  RETURN v_id;
END $$;

DO $seed$
DECLARE
  d_start   CONSTANT DATE := DATE '2026-09-01';
  d_end     CONSTANT DATE := DATE '2026-10-31';
  v_now     TIMESTAMPTZ := NOW();
  v_today   DATE := (NOW() AT TIME ZONE 'Europe/Istanbul')::date;

  tpl_ids   UUID[];
  tpl_s     TIME[];
  tpl_e     TIME[];
  n_tpl     INT;

  emp_ids   UUID[];
  emp_names TEXT[];
  emp_pt    BOOLEAN[];
  n_emp     INT;
  mgr_ids   UUID[];
  reviewer  UUID;

  i INT; k INT; t INT;
  v_rev UUID;
  d DATE; wk DATE; v_week_no INT;
  real_weeks DATE[];
  v_id UUID; v_sid UUID; v_aid UUID;
  rest_dow INT; dow INT;
  s_time TIME; e_time TIME; v_tpl UUID;
  sched_in TIMESTAMPTZ; sched_out TIMESTAMPTZ;
  c_in TIMESTAMPTZ; b_s TIMESTAMPTZ; b_e TIMESTAMPTZ; c_out TIMESTAMPTZ;
  bs TIMESTAMPTZ[]; be TIMESTAMPTZ[]; v_parts INT[]; v_len INT; v_plan INT;
  v_status TEXT; v_method TEXT; v_note TEXT; v_brk INT; r FLOAT;
  v_dist INT; v_acc INT;
  rec RECORD;
  ex RECORD;
  spec RECORD;
  who RECORD;
  ls DATE; le DATE;
  v_kinds TEXT[];
  -- kontrol listesi / duyuru
  v_store UUID; v_author UUID; v_tid UUID; v_rid UUID; v_alt UUID;
  v_outcome TEXT; v_cursor TIMESTAMPTZ; v_last_req INT; v_stop INT; v_req_done TIMESTAMPTZ; v_completed TIMESTAMPTZ;
  v_due TIMESTAMPTZ; v_overdue TIMESTAMPTZ; v_at TIMESTAMPTZ; v_read TIMESTAMPTZ; v_ack TIMESTAMPTZ; v_reminded BOOLEAN;
  v_mode TEXT := COALESCE(NULLIF(current_setting('dummy.mode', true), ''), 'full');
BEGIN
  IF v_mode NOT IN ('full', 'yonetici') THEN RAISE EXCEPTION 'Geçersiz dummy.mode: %', v_mode; END IF;
  IF v_mode = 'full' AND EXISTS (SELECT 1 FROM public._dummy_seed) THEN
    RAISE EXCEPTION 'Dummy veri zaten yüklü (_dummy_seed dolu). Önce cleanup.sql çalıştırın.';
  END IF;
  PERFORM setseed(0.4242);

  -- ── Şablonlar: 6–10 saatlik, gece devretmeyen aktif şablonlar (en fazla 3: açılış / ara / kapanış) ──
  SELECT array_agg(id ORDER BY start_time), array_agg(start_time ORDER BY start_time), array_agg(end_time ORDER BY start_time)
    INTO tpl_ids, tpl_s, tpl_e
  FROM (
    SELECT id, start_time, end_time FROM shift_templates
    WHERE active AND end_time > start_time AND end_time - start_time BETWEEN INTERVAL '6 hours' AND INTERVAL '10 hours'
    ORDER BY start_time LIMIT 3
  ) x;
  IF tpl_ids IS NULL THEN
    tpl_ids := ARRAY[NULL, NULL, NULL]::uuid[];
    tpl_s   := ARRAY['10:00', '12:00', '14:00']::time[];
    tpl_e   := ARRAY['18:00', '20:00', '22:00']::time[];
  END IF;
  n_tpl := array_length(tpl_s, 1);

  -- ── Çalışanlar (yalnızca okunur): aktif, Kiosk hariç ──
  SELECT array_agg(e.id ORDER BY e.created_at, e.id),
         array_agg(e.full_name ORDER BY e.created_at, e.id),
         array_agg(e.employment_type = 'part_time' ORDER BY e.created_at, e.id)
    INTO emp_ids, emp_names, emp_pt
  FROM employees e LEFT JOIN roles ro ON ro.id = e.role_id
  WHERE e.active
    AND e.role_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000005'::uuid
    AND COALESCE(ro.access_level, 'employee') <> 'kiosk'
    AND (v_mode = 'full' OR (
      ro.access_level = 'manager'
      AND NOT EXISTS (SELECT 1 FROM shift_assignments sa JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
                      WHERE sa.employee_id = e.id)
    ));
  n_emp := COALESCE(array_length(emp_ids, 1), 0);
  IF n_emp < (CASE WHEN v_mode = 'full' THEN 4 ELSE 1 END) THEN RAISE EXCEPTION 'Yeterli çalışan yok (%).', n_emp; END IF;

  SELECT array_agg(e.id ORDER BY CASE ro.access_level WHEN 'store_manager' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, e.created_at)
    INTO mgr_ids
  FROM employees e LEFT JOIN roles ro ON ro.id = e.role_id
  WHERE e.active AND ro.access_level IN ('manager', 'store_manager');
  IF mgr_ids IS NULL THEN RAISE EXCEPTION 'Yönetici rolünde çalışan yok.'; END IF;
  reviewer := mgr_ids[1];

  -- ============================================================
  -- 1) İZİN TALEPLERİ (haftalık tatil hariç)
  -- ============================================================
  FOR spec IN
    SELECT * FROM (VALUES
      -- slot, gün ofseti (d_start'tan), süre, tür, durum, gerekçe, yönetici notu
      ( 0,   2, 5, 'annual',   'approved', 'Yaz sonu tatili — ailece Bodrum''a gidiyoruz.', NULL),
      ( 1,   6, 4, 'annual',   'approved', 'Memlekete aile ziyareti (Trabzon).', 'İyi tatiller.'),
      ( 2,  10, 2, 'sick',     'approved', 'Doktor raporu — üst solunum yolu enfeksiyonu.', 'Geçmiş olsun, rapor sisteme işlendi.'),
      ( 3,  13, 1, 'personal', 'approved', 'Tapu dairesinde randevum var.', NULL),
      ( 4,  15, 3, 'annual',   'rejected', 'Kısa bir tatil planı.', 'Ay ortası sayımı nedeniyle bu tarihler uygun değil, farklı bir hafta seçebilir misin?'),
      ( 5,  17, 1, 'sick',     'approved', 'Diş tedavisi — kanal tedavisi sonrası istirahat.', NULL),
      ( 6,  20, 5, 'annual',   'approved', 'Düğün hazırlıkları.', 'Tebrikler! Mutluluklar dileriz.'),
      ( 7,  24, 1, 'other',    'approved', 'Ev taşıma.', NULL),
      ( 8,  26, 2, 'unpaid',   'approved', 'Ailevi bir mesele nedeniyle ücretsiz izin.', 'Ücretsiz izin olarak işlendi.'),
      ( 9,  29, 1, 'personal', 'rejected', 'Arkadaşımın nişanı.', 'O gün iki kişi zaten izinli, maalesef onaylayamıyorum.'),
      (10,  32, 3, 'sick',     'approved', 'Ayak bileği burkulması — 3 gün istirahat raporu.', 'Geçmiş olsun.'),
      (11,  36, 1, 'other',    'approved', 'Askerlik şubesi yoklaması.', NULL),
      (12,  39, 2, 'annual',   'approved', 'Kardeşimin mezuniyet töreni (İzmir).', NULL),
      (13,  43, 1, 'personal', 'approved', 'Çocuğumun veli toplantısı ve okul kaydı işlemleri.', NULL),
      (14,  46, 4, 'annual',   'rejected', 'Hafta sonuna bağlayarak tatil.', 'Kampanya haftasına denk geliyor, kasım ortası için tekrar talep oluştur.'),
      (15,  50, 1, 'sick',     'approved', 'Migren atağı, acil servis raporu.', NULL),
      (16,  54, 2, 'personal', 'approved', 'Vefat — amcamın cenazesi.', 'Başınız sağ olsun.'),
      -- bugünden (30 Ekim) sonrası: çoğu bekliyor
      (17,  62, 3, 'annual',   'pending',  'Kasım başında memlekete gitmek istiyorum.', NULL),
      (18,  64, 1, 'personal', 'pending',  'Ehliyet sınavı.', NULL),
      (19,  70, 5, 'annual',   'pending',  'Kasım tatili — yurt dışı seyahati.', NULL),
      (20,  73, 2, 'other',    'pending',  'Üniversite vize sınavları.', NULL),
      (21,  77, 3, 'annual',   'approved', 'Balayı sonrası kalan izin günlerim.', 'Onaylandı.'),
      (22,  80, 1, 'unpaid',   'pending',  'Kişisel işler.', NULL),
      (23,  66, 2, 'sick',     'pending',  'Planlı küçük cerrahi operasyon (rapor ibraz edilecek).', NULL),
      (24,  85, 3, 'annual',   'rejected', 'Yıl sonu öncesi kısa tatil.', 'Kasım sonu envanter sayımı var.')
    ) AS s(slot, off, len, ltype, lstatus, reason, rnote)
  LOOP
    CONTINUE WHEN v_mode = 'yonetici' AND spec.slot NOT IN (1, 5, 12, 17, 19, 23);
    i  := CASE WHEN v_mode = 'full' THEN (spec.slot * 5) % n_emp ELSE spec.slot % n_emp END + 1;
    ls := d_start + spec.off;
    le := ls + spec.len - 1;
    v_rev := CASE WHEN emp_ids[i] = reviewer THEN COALESCE(mgr_ids[2], reviewer) ELSE reviewer END;
    -- açık/onaylı izin: başka izinle ya da elle girilmiş vardiyayla çakışmasın
    IF spec.lstatus IN ('pending', 'approved') AND (
      EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status IN ('pending', 'approved')
              AND lr.start_date <= le AND lr.end_date >= ls)
      OR EXISTS (SELECT 1 FROM shift_assignments sa WHERE sa.employee_id = emp_ids[i] AND sa.work_date BETWEEN ls AND le)
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, reviewer_note, reviewed_at, reviewed_by, created_at, updated_at)
    VALUES (
      emp_ids[i], spec.ltype::leave_type, ls, le, spec.reason, spec.lstatus::leave_status, spec.rnote,
      CASE WHEN spec.lstatus = 'pending' THEN NULL ELSE LEAST(pg_temp.tr_ts(ls - pg_temp.rnd(2, 6), '11:30'), v_now - INTERVAL '1 hour') END,
      CASE WHEN spec.lstatus = 'pending' THEN NULL ELSE v_rev END,
      LEAST(pg_temp.tr_ts(ls - pg_temp.rnd(7, 14), '09:15'), v_now - INTERVAL '2 hours'),
      LEAST(pg_temp.tr_ts(ls - pg_temp.rnd(2, 6), '11:30'), v_now - INTERVAL '1 hour')
    ) RETURNING id INTO v_id;
    PERFORM pg_temp.trk('leave_requests', v_id);

    IF spec.lstatus = 'pending' THEN
      PERFORM pg_temp.notify(m, 'leave_submitted', 'Yeni izin talebi',
        emp_names[i] || ' — izin talebi: ' || ls || ' – ' || le || ' tarihleri için onay bekliyor.', v_id,
        LEAST(pg_temp.tr_ts(ls - 8, '09:16'), v_now - INTERVAL '2 hours'), FALSE)
      FROM unnest(mgr_ids) m WHERE m <> emp_ids[i];
    ELSE
      PERFORM pg_temp.notify(emp_ids[i],
        CASE WHEN spec.lstatus = 'approved' THEN 'leave_approved' ELSE 'leave_rejected' END,
        CASE WHEN spec.lstatus = 'approved' THEN 'İzin talebiniz onaylandı' ELSE 'İzin talebiniz reddedildi' END,
        ls || ' – ' || le || ' tarihli izin talebiniz ' || CASE WHEN spec.lstatus = 'approved' THEN 'onaylandı.' ELSE 'reddedildi.' END
          || COALESCE(' Not: ' || spec.rnote, ''),
        v_id, LEAST(pg_temp.tr_ts(ls - 3, '11:31'), v_now - INTERVAL '1 hour'), ls < v_today);
    END IF;
  END LOOP;

  -- ============================================================
  -- 2a) BUGÜN — kontrol senaryoları (Günlük operasyon, QR tara, Genel bakış)
  --     Gerçek vardiyası olan kişide o vardiya kullanılır; yoksa dummy vardiya eklenir.
  --     Saatler okutma anıdır: 'HH:MI' ya da '-N' (şimdiden N dk önce). Mola bitişi NULL → sürüyor.
  --     Molaların toplamı planlı mola kadardır (8 sa → 60 dk, 12 sa → 120 dk).
  -- ============================================================
  IF v_mode = 'full' THEN
  FOR spec IN
    SELECT * FROM (VALUES
      -- ad,                  vardiya,          giriş,   mola başlangıçları,               mola bitişleri,                  çıkış,         izinli
      ('Sibel Can',           '06:00', '14:00', '05:56', ARRAY['08:00', '09:45', '11:00']::text[], ARRAY['08:15', '10:15', '11:15']::text[], NULL::text, FALSE),  -- 3 mola, döndü
      ('Ömer Kutlay',         '06:00', '11:00', '05:57', ARRAY['07:45', '09:30'],             ARRAY['08:15', '10:00'],                '11:04',    FALSE),  -- çıkış yaptı, 2 mola
      ('Kader Alemdar',       '07:00', '15:00', '06:55', ARRAY['09:30', '-10'],               ARRAY['09:45', NULL],                   NULL,       FALSE),  -- 2. mola sürüyor
      ('Tülay Temirtoy',      '08:00', '17:00', '07:54', ARRAY['09:45', '11:00'],             ARRAY['10:00', '11:15'],                NULL,       FALSE),  -- 2 mola, döndü
      ('Zehra Özen',          '09:00', '17:00', NULL,    ARRAY[]::text[],                     ARRAY[]::text[],                        NULL,       TRUE),   -- izinli
      ('Ömer F Kutlay',       '10:00', '22:00', '09:52', ARRAY['-50', '-5'],                  ARRAY['-35', NULL],                     NULL,       FALSE),  -- 2. mola sürüyor
      ('Beyzanur Meşe',       '10:00', '18:00', '09:58', ARRAY['-18'],                        ARRAY[NULL]::text[],                    NULL,       FALSE),  -- 1. mola sürüyor (uzun)
      ('Ecrin Zehra Çiçek',   '10:00', '18:00', '10:01', ARRAY['11:00'],                      ARRAY['11:15'],                         NULL,       FALSE),  -- 1 mola, döndü
      ('Methiye Yılmaz',      '10:00', '18:00', '09:59', ARRAY[]::text[],                     ARRAY[]::text[],                        NULL,       FALSE),  -- çalışıyor
      ('Seyfullah Demir',     '10:00', '22:00', '09:48', ARRAY[]::text[],                     ARRAY[]::text[],                        NULL,       FALSE),  -- çalışıyor
      ('Mert Can',            '10:00', '18:00', '10:24', ARRAY[]::text[],                     ARRAY[]::text[],                        NULL,       FALSE),  -- 24 dk geç → 10:30 işlenir
      ('Şeyma Yorulmaz',      '10:00', '18:00', NULL,    ARRAY[]::text[],                     ARRAY[]::text[],                        NULL,       FALSE),  -- gelmedi
      ('Çalışan bir',         '08:00', '16:00', '07:50', ARRAY['10:00'],                      ARRAY['10:30'],                         NULL,       FALSE),  -- Canpark: 1 mola, döndü
      ('Çalışan üç',          '09:00', '17:00', '09:21', ARRAY['-3'],                         ARRAY[NULL]::text[],                    NULL,       FALSE),  -- Canpark: geç (09:30 işlenir) + molada
      ('Çalışan2',            '07:00', '11:00', '06:59', ARRAY['09:00'],                      ARRAY['09:15'],                         '10:40',    FALSE)   -- Canpark: erken çıkış (10:30 işlenir)
      -- Bugün 11:00 ve 14:00'te başlayan gerçek vardiyalar "Başlamadı" olarak kalır.
      -- Gerçek planda bugün haftalık tatilde olanlar (onaylı izin) atlanır.
    ) AS s(name, s_t, e_t, c_in, b_starts, b_ends, c_out, on_leave)
  LOOP
    i := array_position(emp_names, spec.name);
    CONTINUE WHEN i IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status = 'approved'
                          AND v_today BETWEEN lr.start_date AND lr.end_date);

    SELECT sa.id, sa.start_time, sa.end_time, sa.is_on_leave INTO ex
    FROM shift_assignments sa WHERE sa.employee_id = emp_ids[i] AND sa.work_date = v_today;
    IF FOUND THEN
      CONTINUE WHEN ex.is_on_leave OR spec.on_leave
        OR EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.shift_assignment_id = ex.id);
      v_sid := ex.id; s_time := ex.start_time; e_time := ex.end_time;
    ELSE
      IF spec.on_leave THEN
        INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, reviewer_note, reviewed_at, reviewed_by, created_at, updated_at)
        VALUES (emp_ids[i], 'annual', v_today, v_today, 'Bir günlük yıllık izin.', 'approved', 'Onaylandı.', v_now - INTERVAL '3 days',
                CASE WHEN emp_ids[i] = reviewer THEN COALESCE(mgr_ids[2], reviewer) ELSE reviewer END,
                v_now - INTERVAL '5 days', v_now - INTERVAL '3 days')
        RETURNING id INTO v_id;
        PERFORM pg_temp.trk('leave_requests', v_id);
      END IF;
      INSERT INTO shift_assignments (employee_id, work_date, start_time, end_time, is_on_leave, created_at, updated_at)
      VALUES (emp_ids[i], v_today, spec.s_t::time, spec.e_t::time, spec.on_leave, v_now - INTERVAL '6 days', v_now - INTERVAL '6 days')
      RETURNING id INTO v_sid;
      PERFORM pg_temp.trk('shift_assignments', v_sid);
      s_time := spec.s_t::time; e_time := spec.e_t::time;
    END IF;
    CONTINUE WHEN spec.on_leave OR spec.c_in IS NULL;

    sched_in  := pg_temp.tr_ts(v_today, s_time);
    sched_out := pg_temp.tr_ts(v_today, e_time);
    IF sched_out <= sched_in THEN sched_out := sched_out + INTERVAL '1 day'; END IF;
    c_in := pg_temp.tt(v_today, spec.c_in, v_now) + make_interval(secs => pg_temp.rnd(0, 59));
    bs := ARRAY(SELECT pg_temp.tt(v_today, x, v_now) FROM unnest(spec.b_starts) WITH ORDINALITY u(x, o) ORDER BY o);
    be := ARRAY(SELECT pg_temp.tt(v_today, x, v_now) FROM unnest(spec.b_ends) WITH ORDINALITY u(x, o) ORDER BY o);
    v_aid := pg_temp.att(emp_ids[i], v_sid, sched_in, sched_out, c_in, bs, be, pg_temp.tt(v_today, spec.c_out, v_now),
                         'qr_location', NULL, pg_temp.rnd(3, 45), pg_temp.rnd(5, 25), v_now);

    IF v_aid IS NOT NULL AND c_in - sched_in >= INTERVAL '15 minutes' THEN
      PERFORM pg_temp.notify(m, 'attendance_late_clock_in', 'Geç giriş',
        emp_names[i] || ', ' || to_char(v_today, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI')
          || ' vardiyasına ' || floor(extract(epoch FROM c_in - sched_in) / 60) || ' dk geç giriş okuttu (giriş: '
          || pg_temp.hhmi(c_in) || ').', v_sid, c_in, FALSE)
      FROM unnest(mgr_ids) m WHERE m <> emp_ids[i];
    END IF;
  END LOOP;
  END IF;

  -- ============================================================
  -- 2) VARDİYA PLANI + HAFTALIK TATİL + DEVAM KAYITLARI (bugün hariç)
  -- ============================================================
  FOR i IN 1..n_emp LOOP
    rest_dow := (i % 5) + 1;  -- ISO: haftalık tatil Pzt–Cum arasında; hafta sonu herkes çalışır

    -- Elle girilmiş (gerçek) vardiyası olan haftalar: o hafta dummy plan yapılmaz
    SELECT COALESCE(array_agg(DISTINCT date_trunc('week', sa.work_date)::date), ARRAY[]::date[]) INTO real_weeks
    FROM shift_assignments sa
    WHERE sa.employee_id = emp_ids[i] AND sa.work_date BETWEEN d_start - 7 AND d_end + 7
      AND NOT EXISTS (SELECT 1 FROM public._dummy_seed ds WHERE ds.tbl = 'shift_assignments' AND ds.id = sa.id::text);

    d := d_start;
    WHILE d <= d_end LOOP
      IF d = v_today AND v_mode = 'full' THEN d := d + 1; CONTINUE; END IF;   -- bugün: 2a senaryoları
      dow := EXTRACT(ISODOW FROM d)::int;
      wk  := date_trunc('week', d)::date;
      v_week_no := (wk - DATE '2026-08-31') / 7;

      SELECT sa.id, sa.start_time, sa.end_time, sa.is_on_leave,
             EXISTS (SELECT 1 FROM public._dummy_seed ds WHERE ds.tbl = 'shift_assignments' AND ds.id = sa.id::text) AS dummy
        INTO ex
      FROM shift_assignments sa WHERE sa.employee_id = emp_ids[i] AND sa.work_date = d;
      IF FOUND THEN
        -- gerçek vardiya: vardiyaya dokunulmaz, yalnızca devam kaydı yazılır
        IF ex.dummy OR ex.is_on_leave
           OR EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.shift_assignment_id = ex.id)
           OR EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status = 'approved' AND d BETWEEN lr.start_date AND lr.end_date)
        THEN
          d := d + 1; CONTINUE;
        END IF;
        v_sid := ex.id; s_time := ex.start_time; e_time := ex.end_time;
      ELSIF wk = ANY (real_weeks) THEN
        d := d + 1; CONTINUE;   -- gerçek planın boş günü (tatil) — dokunulmaz
      ELSE
        -- haftalık tatil: onaylı weekly_rest kaydı
        IF dow = rest_dow THEN
          IF NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status IN ('pending', 'approved') AND d BETWEEN lr.start_date AND lr.end_date) THEN
            INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status, reviewed_at, reviewed_by, created_at, updated_at)
            VALUES (emp_ids[i], 'weekly_rest', d, d, 'approved',
                    LEAST(pg_temp.tr_ts(wk - 4, '17:00'), v_now - INTERVAL '3 hours'), reviewer,
                    LEAST(pg_temp.tr_ts(wk - 4, '17:00'), v_now - INTERVAL '3 hours'), LEAST(pg_temp.tr_ts(wk - 4, '17:00'), v_now - INTERVAL '3 hours'))
            RETURNING id INTO v_id;
            PERFORM pg_temp.trk('leave_requests', v_id);
          END IF;
          d := d + 1; CONTINUE;
        END IF;
        -- yarı zamanlı: haftada 4 gün; onaylı izin günleri boş
        IF (emp_pt[i] AND dow IN (((rest_dow + 1) % 7) + 1, ((rest_dow + 3) % 7) + 1))
           OR EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status = 'approved' AND d BETWEEN lr.start_date AND lr.end_date)
        THEN
          d := d + 1; CONTINUE;
        END IF;

        -- aynı hafta aynı vardiya; açılış / ara / kapanış haftalık döner (kapanış → açılış arası 12 sa dinlenme)
        IF emp_pt[i] THEN
          s_time := CASE (v_week_no + i) % 2 WHEN 0 THEN TIME '10:00' ELSE TIME '17:00' END;
          e_time := s_time + INTERVAL '5 hours'; v_tpl := NULL;
        ELSE
          t := ((v_week_no + i) % n_tpl) + 1;
          s_time := tpl_s[t]; e_time := tpl_e[t]; v_tpl := tpl_ids[t];
        END IF;

        INSERT INTO shift_assignments (employee_id, work_date, start_time, end_time, shift_template_id, created_at, updated_at)
        VALUES (emp_ids[i], d, s_time, e_time, v_tpl,
                LEAST(pg_temp.tr_ts(wk - 4, '16:00'), v_now - INTERVAL '4 hours'),
                LEAST(pg_temp.tr_ts(wk - 4, '16:00'), v_now - INTERVAL '4 hours'))
        RETURNING id INTO v_sid;
        PERFORM pg_temp.trk('shift_assignments', v_sid);
      END IF;

      sched_in  := pg_temp.tr_ts(d, s_time);
      sched_out := pg_temp.tr_ts(d, e_time);
      IF sched_out <= sched_in THEN sched_out := sched_out + INTERVAL '1 day'; END IF;

      -- vardiya hatırlatması (son 2 hafta ve yarın)
      IF d BETWEEN v_today - 14 AND v_today + 1 THEN
        PERFORM pg_temp.notify(emp_ids[i], 'shift_reminder', 'Vardiya hatırlatması',
          to_char(d, 'DD.MM.YYYY') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI') || ' vardiyanız var.',
          v_sid, LEAST(sched_in - INTERVAL '12 hours', v_now - INTERVAL '5 minutes'), d < v_today - 2);
      END IF;

      IF d >= v_today OR sched_in > v_now THEN d := d + 1; CONTINUE; END IF;   -- henüz gelmemiş gün

      -- %1 gelmedi: devam kaydı yok → mesai düzeltme senaryoları için
      IF random() < 0.01 THEN
        PERFORM pg_temp.notify(m, 'attendance_missed_clock_in', 'Giriş okutulmadı',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyası için henüz giriş QR''ı okutmadı.', v_sid, sched_in + INTERVAL '30 minutes', d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i] AND d >= v_today - 21;
        d := d + 1; CONTINUE;
      END IF;

      -- giriş okutması: çoğunlukla 2–14 dk erken, bazen birkaç dk geç, %4 15–38 dk geç (yuvarlanır)
      r := random();
      c_in := sched_in + make_interval(mins => CASE WHEN r < 0.80 THEN -pg_temp.rnd(2, 14) WHEN r < 0.96 THEN pg_temp.rnd(0, 9) ELSE pg_temp.rnd(15, 38) END)
              + make_interval(secs => pg_temp.rnd(0, 59));
      IF c_in - sched_in >= INTERVAL '15 minutes' THEN
        PERFORM pg_temp.notify(m, 'attendance_late_clock_in', 'Geç giriş',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyasına ' || floor(extract(epoch FROM c_in - sched_in) / 60) || ' dk geç giriş okuttu (giriş: '
            || pg_temp.hhmi(c_in) || ').', v_sid, c_in, d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i] AND d >= v_today - 21;
      END IF;

      -- çıkış okutması: çoğunlukla kapanıştan 0–12 dk sonra, bazen birkaç dk önce; %2 erken çıkış (yuvarlanır)
      r := random();
      c_out := sched_out + make_interval(mins => CASE WHEN r < 0.75 THEN pg_temp.rnd(0, 12) WHEN r < 0.98 THEN -pg_temp.rnd(1, 12) ELSE -pg_temp.rnd(35, 100) END)
               + make_interval(secs => pg_temp.rnd(0, 59));
      v_note := CASE WHEN r >= 0.98 THEN (ARRAY['Rahatsızlandı, müdür izniyle erken çıktı.', 'Hastane randevusu — müdür onaylı erken çıkış.',
                                               'Çocuğunu okuldan alması gerekti, müdür onaylı.'])[pg_temp.rnd(1, 3)] END;

      -- molalar: toplam ≈ planlı mola (8 sa → 60, 9,5 sa → 90, 11+ sa → 120), 1–3 parça, tam dakika
      v_len  := round(extract(epoch FROM sched_out - sched_in) / 60)::int;
      v_plan := pg_temp.plan_break(v_len);
      r := random();
      v_parts := CASE v_plan
        WHEN 15  THEN ARRAY[15]
        WHEN 90  THEN CASE WHEN r < 0.5 THEN ARRAY[30, 60] WHEN r < 0.8 THEN ARRAY[45, 45] ELSE ARRAY[15, 60, 15] END
        WHEN 120 THEN CASE WHEN r < 0.45 THEN ARRAY[60, 60] WHEN r < 0.8 THEN ARRAY[30, 60, 30] ELSE ARRAY[15, 60, 45] END
        ELSE          CASE WHEN r < 0.35 THEN ARRAY[60] WHEN r < 0.65 THEN ARRAY[30, 30] WHEN r < 0.85 THEN ARRAY[15, 45] ELSE ARRAY[15, 30, 15] END
      END;
      bs := ARRAY[]::timestamptz[]; be := ARRAY[]::timestamptz[];
      FOR k IN 1..array_length(v_parts, 1) LOOP
        b_s := date_trunc('minute', sched_in + (sched_out - sched_in) * k / (array_length(v_parts, 1) + 1)
                                    + make_interval(mins => pg_temp.rnd(-20, 15)));
        IF k = 1 THEN
          b_s := GREATEST(b_s, date_trunc('minute', GREATEST(c_in, sched_in)) + INTERVAL '75 minutes');
        ELSE
          b_s := GREATEST(b_s, be[k - 1] + INTERVAL '45 minutes');
        END IF;
        -- %6 molasını birkaç dakika uzatır
        v_brk := v_parts[k] + pg_temp.rnd(-1, 2) + CASE WHEN random() < 0.06 THEN pg_temp.rnd(5, 12) ELSE 0 END;
        b_e := b_s + make_interval(mins => v_brk);
        EXIT WHEN b_e > c_out - INTERVAL '30 minutes';
        bs := bs || b_s; be := be || b_e;
      END LOOP;

      v_method := 'qr_location';
      IF random() < 0.01 THEN
        v_method := 'manual_override';
        v_note := COALESCE(v_note, 'Kiosk tableti arızalıydı, giriş-çıkış müdür tarafından elle girildi.');
      END IF;
      v_dist := CASE WHEN v_method = 'qr_location' THEN pg_temp.rnd(3, 45) END;
      v_acc  := CASE WHEN v_method = 'qr_location' THEN pg_temp.rnd(5, 25) END;

      -- %0,8 çıkış okutmayı unuttu
      IF random() < 0.008 THEN
        c_out := NULL;
        PERFORM pg_temp.notify(m, 'attendance_missed_clock_out', 'Çıkış okutulmadı',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyası bitti ancak çıkış QR''ı okutulmadı.', v_sid, sched_out + INTERVAL '45 minutes', d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i];
      END IF;

      v_aid := pg_temp.att(emp_ids[i], v_sid, sched_in, sched_out, c_in, bs, be, c_out, v_method, v_note, v_dist, v_acc, v_now);

      IF v_aid IS NOT NULL AND v_method = 'manual_override' THEN
        SELECT ar.status::text INTO v_status FROM attendance_records ar WHERE ar.id = v_aid;
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, note, created_at)
        VALUES (reviewer, 'attendance.override', 'attendance_record', v_aid::text, NULL,
                jsonb_build_object('clock_in_at', c_in, 'clock_out_at', c_out, 'status', v_status), v_note, COALESCE(c_out, c_in) + INTERVAL '10 minutes')
        RETURNING id INTO v_id;
        PERFORM pg_temp.trk('audit_logs', v_id);
        PERFORM pg_temp.notify(emp_ids[i], 'attendance_override', 'Devam kaydınız güncellendi',
          to_char(d, 'DD.MM.YYYY') || ' tarihli devam kaydınız yönetici tarafından düzenlendi.', v_aid, COALESCE(c_out, c_in) + INTERVAL '10 minutes', TRUE);
      END IF;

      d := d + 1;
    END LOOP;
  END LOOP;

  -- ============================================================
  -- 3) MESAİ DÜZELTME TALEPLERİ
  -- ============================================================
  -- 3a) Gelmeyen (kaydı olmayan) geçmiş dummy vardiyalar
  k := 0;
  FOR rec IN
    SELECT sa.id, sa.employee_id, sa.work_date, sa.start_time, sa.end_time,
           (SELECT array_position(emp_ids, sa.employee_id)) AS ei
    FROM shift_assignments sa
    JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
    WHERE sa.work_date < v_today
      AND NOT sa.is_on_leave
      AND sa.employee_id = ANY (emp_ids)
      AND NOT EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.shift_assignment_id = sa.id)
      AND NOT EXISTS (SELECT 1 FROM manual_time_correction_requests m WHERE m.employee_id = sa.employee_id AND m.date = sa.work_date)
    ORDER BY sa.work_date DESC
    LIMIT CASE WHEN v_mode = 'full' THEN 6 ELSE 3 END
  LOOP
    k := k + 1;
    v_status := (ARRAY['pending', 'approved', 'rejected', 'approved', 'direct', 'approved'])[k];
    v_brk := pg_temp.plan_break(round(extract(epoch FROM (CASE WHEN rec.end_time > rec.start_time THEN rec.end_time - rec.start_time
                                                                ELSE rec.end_time - rec.start_time + INTERVAL '24 hours' END)) / 60)::int);
    v_note := (ARRAY['Telefonumun şarjı bitti, QR okutamadım.', 'Kiosk tableti açılmıyordu, giriş yapamadım.',
                     'Depo sayımındaydım, mağazaya uğramadan başladım.', 'Uygulama oturumum kapanmıştı, fark etmedim.',
                     'Sabah eğitime katıldım, oradan direkt işe geldim.'])[pg_temp.rnd(1, 5)];
    INSERT INTO manual_time_correction_requests (employee_id, date, requested_start_time, requested_end_time, break_minutes, reason, status,
                                                 reviewed_by, reviewed_at, reviewer_note, created_at, updated_at)
    VALUES (rec.employee_id, rec.work_date, rec.start_time, rec.end_time, v_brk,
            CASE WHEN v_status = 'direct' THEN 'Yönetici tarafından doğrudan girildi: çalışan kiosk arızası nedeniyle okutamadı.' ELSE v_note END,
            v_status,
            CASE WHEN v_status = 'pending' THEN NULL ELSE reviewer END,
            CASE WHEN v_status = 'pending' THEN NULL ELSE LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now - INTERVAL '1 hour') END,
            CASE v_status WHEN 'rejected' THEN 'Kamera kayıtlarında mağazada olduğun görülmüyor, lütfen benimle görüş.'
                          WHEN 'approved' THEN 'Kontrol edildi, onaylandı.' ELSE NULL END,
            LEAST(pg_temp.tr_ts(rec.work_date + 1, '09:05'), v_now - INTERVAL '2 hours'),
            LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now - INTERVAL '1 hour'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('manual_time_correction_requests', v_id);

    IF v_status IN ('approved', 'direct') THEN
      INSERT INTO attendance_records (employee_id, shift_assignment_id, status, clock_in_at, break_start_at, break_end_at, clock_out_at,
                                      completed_break_minutes, verification_method, created_at, updated_at)
      VALUES (rec.employee_id, rec.id, 'clocked_out', pg_temp.tr_ts(rec.work_date, rec.start_time), NULL, NULL, pg_temp.tr_ts(rec.work_date, rec.end_time),
              v_brk, 'manual_correction', LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now), LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now))
      RETURNING id INTO v_aid;
      PERFORM pg_temp.trk('attendance_records', v_aid);
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after, created_at)
      VALUES (reviewer, 'time_correction.' || v_status, 'manual_time_correction_request', v_id::text,
              jsonb_build_object('date', rec.work_date, 'start', rec.start_time, 'end', rec.end_time, 'break_minutes', v_brk),
              LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now))
      RETURNING id INTO v_aid;
      PERFORM pg_temp.trk('audit_logs', v_aid);
    END IF;

    IF v_status = 'pending' THEN
      PERFORM pg_temp.notify(m, 'time_correction_submitted', 'Yeni Mesai Düzeltme Talebi',
        emp_names[rec.ei] || ' — ' || to_char(rec.work_date, 'DD.MM.YYYY') || ' için ' || to_char(rec.start_time, 'HH24:MI') || '–' || to_char(rec.end_time, 'HH24:MI')
          || ' mesai düzeltme talebi oluşturdu.', v_id, LEAST(pg_temp.tr_ts(rec.work_date + 1, '09:05'), v_now - INTERVAL '2 hours'), FALSE)
      FROM unnest(mgr_ids) m WHERE m <> rec.employee_id;
    ELSIF v_status = 'direct' THEN
      PERFORM pg_temp.notify(rec.employee_id, 'time_correction_approved', 'Mesai düzeltmeniz uygulandı',
        to_char(rec.work_date, 'DD.MM.YYYY') || ' ' || to_char(rec.start_time, 'HH24:MI') || '–' || to_char(rec.end_time, 'HH24:MI') || ' mesai saatiniz yönetici tarafından güncellendi.',
        v_id, LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now), TRUE);
    ELSE
      PERFORM pg_temp.notify(rec.employee_id,
        CASE WHEN v_status = 'approved' THEN 'time_correction_approved' ELSE 'time_correction_rejected' END,
        CASE WHEN v_status = 'approved' THEN 'Mesai düzeltme talebiniz onaylandı' ELSE 'Mesai düzeltme talebiniz reddedildi' END,
        to_char(rec.work_date, 'DD.MM.YYYY') || ' tarihli mesai düzeltme talebiniz ' || CASE WHEN v_status = 'approved' THEN 'onaylandı.' ELSE 'reddedildi.' END,
        v_id, LEAST(pg_temp.tr_ts(rec.work_date + 1, '10:20'), v_now), rec.work_date < v_today - 5);
    END IF;
  END LOOP;

  -- 3b) Çıkış okutmayı unutanlar → bekleyen / onaylı düzeltme (mola = önceki molalar + son mola)
  k := 0;
  FOR rec IN
    SELECT ar.id AS aid, sa.employee_id, sa.work_date, sa.start_time, sa.end_time,
           ar.completed_break_minutes + COALESCE(round(extract(epoch FROM ar.break_end_at - ar.break_start_at) / 60)::int, 0) AS brk,
           (SELECT array_position(emp_ids, sa.employee_id)) AS ei
    FROM attendance_records ar
    JOIN shift_assignments sa ON sa.id = ar.shift_assignment_id
    JOIN public._dummy_seed ds ON ds.tbl = 'attendance_records' AND ds.id = ar.id::text
    WHERE ar.clock_out_at IS NULL AND sa.work_date < v_today
      AND sa.employee_id = ANY (emp_ids)
      AND NOT EXISTS (SELECT 1 FROM manual_time_correction_requests m WHERE m.employee_id = sa.employee_id AND m.date = sa.work_date AND m.status = 'pending')
    ORDER BY sa.work_date
  LOOP
    k := k + 1;
    v_status := CASE WHEN k % 2 = 1 THEN 'pending' ELSE 'approved' END;
    INSERT INTO manual_time_correction_requests (employee_id, date, requested_start_time, requested_end_time, break_minutes, reason, status,
                                                 reviewed_by, reviewed_at, reviewer_note, created_at, updated_at)
    VALUES (rec.employee_id, rec.work_date, rec.start_time, rec.end_time, rec.brk,
            'Çıkışta QR okutmayı unuttum, vardiya bitiminde çıktım.', v_status,
            CASE WHEN v_status = 'approved' THEN reviewer END,
            CASE WHEN v_status = 'approved' THEN LEAST(pg_temp.tr_ts(rec.work_date + 1, '12:00'), v_now - INTERVAL '1 hour') END,
            CASE WHEN v_status = 'approved' THEN 'Kapanış raporuyla uyumlu, onaylandı.' END,
            LEAST(pg_temp.tr_ts(rec.work_date + 1, '08:40'), v_now - INTERVAL '2 hours'),
            LEAST(pg_temp.tr_ts(rec.work_date + 1, '12:00'), v_now - INTERVAL '1 hour'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('manual_time_correction_requests', v_id);
    IF v_status = 'approved' THEN
      UPDATE attendance_records SET status = 'clocked_out', clock_out_at = pg_temp.tr_ts(rec.work_date, rec.end_time),
             verification_method = 'manual_correction' WHERE id = rec.aid;
      PERFORM pg_temp.notify(rec.employee_id, 'time_correction_approved', 'Mesai düzeltme talebiniz onaylandı',
        to_char(rec.work_date, 'DD.MM.YYYY') || ' tarihli mesai düzeltme talebiniz onaylandı.', v_id, LEAST(pg_temp.tr_ts(rec.work_date + 1, '12:00'), v_now), TRUE);
    ELSE
      PERFORM pg_temp.notify(m, 'time_correction_submitted', 'Yeni Mesai Düzeltme Talebi',
        emp_names[rec.ei] || ' — ' || to_char(rec.work_date, 'DD.MM.YYYY') || ' için çıkış saati düzeltme talebi oluşturdu.',
        v_id, LEAST(pg_temp.tr_ts(rec.work_date + 1, '08:40'), v_now - INTERVAL '2 hours'), FALSE)
      FROM unnest(mgr_ids) m WHERE m <> rec.employee_id;
    END IF;
  END LOOP;

  IF v_mode = 'full' THEN
  -- ============================================================
  -- 4) AÇIK VARDİYALAR
  -- ============================================================
  FOR spec IN
    SELECT * FROM (VALUES
      ( 2, 1, 'open',      'Çalışan',          'Hafta sonu yoğunluğu için kasa desteği.'),
      ( 4, 3, 'open',      'Çalışan',          'Sevkiyat günü — depo ve raf dizilimi desteği.'),
      ( 9, 2, 'open',      'Müdür Yardımcısı', 'Mağaza müdürü eğitimde, kapanış sorumlusu gerekiyor.'),
      (12, 1, 'open',      'Çalışan',          'Kasım indirim günleri yoğunluğu.'),
      (16, 2, 'open',      NULL,               'Kampanya haftası ek personel.'),
      (23, 3, 'open',      'Çalışan',          'Yıllık sayım hazırlığı.'),
      ( 6, 1, 'cancelled', 'Çalışan',          'Hafta sonu ek kasa (ihtiyaç kalmadı).'),
      (-9, 2, 'cancelled', 'Çalışan',          'Vitrin değişimi desteği — tedarikçi erteledi.'),
      (-25,3, 'cancelled', NULL,               'Etkinlik günü ek personel — etkinlik iptal edildi.')
    ) AS s(off, ti, ostatus, role_needed, descr)
  LOOP
    t := LEAST(spec.ti, n_tpl);
    -- Çoklu mağaza: dummy veri ana mağazaya yazılır
    INSERT INTO open_shifts (store_id, work_date, start_time, end_time, role_needed, description, status, created_at, updated_at)
    VALUES ('00000000-0000-0000-0003-000000000001', v_today + spec.off, tpl_s[t], tpl_e[t], spec.role_needed, spec.descr, spec.ostatus::open_shift_status,
            LEAST(pg_temp.tr_ts(v_today + spec.off - 6, '15:00'), v_now - INTERVAL '3 hours'),
            LEAST(pg_temp.tr_ts(v_today + spec.off - 2, '15:00'), v_now - INTERVAL '1 hour'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('open_shifts', v_id);
    IF spec.ostatus = 'open' AND spec.off <= 4 THEN
      PERFORM pg_temp.notify(emp_ids[gs], 'open_shift_available', 'Yeni Açık Vardiya',
        to_char(v_today + spec.off, 'DD.MM.YYYY') || ' tarihinde ' || to_char(tpl_s[t], 'HH24:MI') || '–' || to_char(tpl_e[t], 'HH24:MI')
          || ' için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.',
        v_id, v_now - INTERVAL '30 hours', gs % 3 = 0)
      FROM generate_series(1, n_emp) gs;
    END IF;
  END LOOP;

  -- doldurulmuş açık vardiyalar: mevcut dummy vardiyaya bağlanır
  FOR rec IN
    SELECT sa.id, sa.employee_id, sa.work_date, sa.start_time, sa.end_time, (SELECT array_position(emp_ids, sa.employee_id)) AS ei
    FROM shift_assignments sa JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
    WHERE sa.work_date BETWEEN v_today - 40 AND v_today + 10 AND EXTRACT(ISODOW FROM sa.work_date) IN (5, 6, 7)
      AND NOT sa.is_on_leave
    ORDER BY md5(sa.id::text) LIMIT 6
  LOOP
    INSERT INTO open_shifts (store_id, work_date, start_time, end_time, role_needed, description, status, filled_by, filled_assignment_id, created_at, updated_at)
    VALUES ((SELECT store_id FROM shift_assignments WHERE id = rec.id), rec.work_date, rec.start_time, rec.end_time, 'Çalışan',
            (ARRAY['Hafta sonu ek kasa ihtiyacı.', 'Hastalık nedeniyle boşalan vardiya.', 'İndirim günü yoğunluğu.'])[pg_temp.rnd(1, 3)],
            'filled', rec.employee_id, rec.id,
            LEAST(pg_temp.tr_ts(rec.work_date - 5, '14:00'), v_now - INTERVAL '3 hours'),
            LEAST(pg_temp.tr_ts(rec.work_date - 4, '09:30'), v_now - INTERVAL '2 hours'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('open_shifts', v_id);
    PERFORM pg_temp.notify(m, 'open_shift_claimed', 'Açık vardiya alındı',
      emp_names[rec.ei] || ', ' || rec.work_date || ' ' || to_char(rec.start_time, 'HH24:MI') || '–' || to_char(rec.end_time, 'HH24:MI') || ' açık vardiyasını üstlendi.',
      rec.id, LEAST(pg_temp.tr_ts(rec.work_date - 4, '09:30'), v_now - INTERVAL '2 hours'), rec.work_date < v_today)
    FROM unnest(mgr_ids) m WHERE m <> rec.employee_id;
  END LOOP;

  -- ============================================================
  -- 5) VARDİYA TAKAS TALEPLERİ
  --    Önümüzdeki 3 haftanın vardiyaları (gerçek ya da dummy). Onaylı takas vardiyaları
  --    gerçekten el değiştirdiği için yalnızca iki tarafı da dummy olan çiftlerde yapılır;
  --    öyle çift yoksa onaylı takas üretilmez. 7. talep devretmedir (karşı vardiya yok).
  -- ============================================================
  v_kinds := ARRAY['pending', 'pending', 'pending', 'pending', 'rejected', 'cancelled', 'pending', 'approved', 'approved'];
  k := 0;
  FOR rec IN
    SELECT a.id AS a_id, a.employee_id AS a_emp, b.id AS b_id, b.employee_id AS b_emp, a.work_date,
           (SELECT array_position(emp_ids, a.employee_id)) AS ai,
           (da.id IS NOT NULL AND db.id IS NOT NULL) AS both_dummy
    FROM shift_assignments a
    JOIN shift_assignments b ON b.work_date = a.work_date AND b.employee_id <> a.employee_id AND b.start_time <> a.start_time
                            AND b.store_id = a.store_id
    LEFT JOIN public._dummy_seed da ON da.tbl = 'shift_assignments' AND da.id = a.id::text
    LEFT JOIN public._dummy_seed db ON db.tbl = 'shift_assignments' AND db.id = b.id::text
    WHERE a.work_date BETWEEN v_today + 1 AND v_today + 21
      AND a.employee_id = ANY (emp_ids) AND b.employee_id = ANY (emp_ids)
      AND NOT a.is_on_leave AND NOT b.is_on_leave
      AND NOT EXISTS (SELECT 1 FROM attendance_records x WHERE x.shift_assignment_id IN (a.id, b.id))
      AND NOT EXISTS (SELECT 1 FROM open_shifts o WHERE o.filled_assignment_id IN (a.id, b.id))
    -- iki tarafı da dummy olan çiftler sona: onaylı takaslara (son iki talep) kalsın
    ORDER BY (da.id IS NOT NULL AND db.id IS NOT NULL), md5(a.id::text || b.id::text)
  LOOP
    EXIT WHEN k >= array_length(v_kinds, 1);
    -- her vardiya yalnızca bir talepte
    CONTINUE WHEN EXISTS (SELECT 1 FROM shift_swap_requests s WHERE s.requester_shift_id IN (rec.a_id, rec.b_id) OR s.target_shift_id IN (rec.a_id, rec.b_id));
    v_status := v_kinds[k + 1];
    IF v_status = 'approved' AND NOT rec.both_dummy THEN EXIT; END IF;
    k := k + 1;
    INSERT INTO shift_swap_requests (requester_id, requester_shift_id, target_id, target_shift_id, status, requester_note, reviewer_note,
                                     reviewed_at, reviewed_by, target_accepted_at, created_at, updated_at)
    VALUES (rec.a_emp, rec.a_id, rec.b_emp, CASE WHEN k = 7 THEN NULL ELSE rec.b_id END, v_status::swap_status,
            (ARRAY['O gün akşam okulum var, sabah vardiyasına geçebilir miyim?', 'Hastane randevum çakışıyor.', 'Kardeşimin düğünü var, vardiyamı değişebilir miyiz?',
                   'Ulaşım sorunum var, saatleri değişelim mi?', 'Sınavım var, değişebilir miyiz?', 'Vazgeçtim, kendi vardiyamda kalacağım.',
                   'Bu vardiyayı devretmek istiyorum.', 'Çocuğumun okul gösterisi var.', 'Aile ziyareti.'])[k],
            CASE v_status WHEN 'rejected' THEN 'O gün iki tarafın da yetkinliği gereken bir sevkiyat var.' WHEN 'approved' THEN 'Uygun, onaylandı.' END,
            CASE WHEN v_status IN ('approved', 'rejected', 'cancelled') THEN v_now - make_interval(hours => pg_temp.rnd(2, 30)) END,
            CASE WHEN v_status IN ('approved', 'rejected') THEN reviewer END,
            CASE WHEN v_status IN ('approved', 'rejected') OR k IN (3, 4) THEN v_now - make_interval(hours => pg_temp.rnd(31, 50)) END,
            v_now - make_interval(hours => pg_temp.rnd(51, 90)),
            v_now - INTERVAL '1 hour')
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('shift_swap_requests', v_id);

    -- onaylı takas: vardiyalar gerçekten el değiştirir (tekil indeks için geçici tarih)
    IF v_status = 'approved' THEN
      UPDATE shift_assignments SET work_date = work_date + 3650 WHERE id = rec.b_id;
      UPDATE shift_assignments SET employee_id = rec.b_emp WHERE id = rec.a_id;
      UPDATE shift_assignments SET employee_id = rec.a_emp, work_date = rec.work_date WHERE id = rec.b_id;
    END IF;

    IF k <> 7 THEN
      PERFORM pg_temp.notify(rec.b_emp, 'shift_swap_submitted', 'Size bir vardiya takas teklifi var',
        emp_names[rec.ai] || ', ' || rec.work_date || ' tarihli vardiyası için sizinle takas yapmak istiyor. Kabul ederseniz yönetici onayına gönderilir.',
        v_id, v_now - INTERVAL '50 hours', v_status <> 'pending');
    END IF;
    IF v_status IN ('approved', 'rejected') THEN
      PERFORM pg_temp.notify(rec.a_emp, CASE WHEN v_status = 'approved' THEN 'shift_swap_approved' ELSE 'shift_swap_rejected' END,
        CASE WHEN v_status = 'approved' THEN 'Takas talebiniz onaylandı' ELSE 'Takas talebiniz reddedildi' END,
        rec.work_date || ' tarihli vardiya takas talebiniz ' || CASE WHEN v_status = 'approved' THEN 'onaylandı.' ELSE 'reddedildi.' END,
        v_id, v_now - INTERVAL '26 hours', TRUE);
    END IF;
  END LOOP;

  END IF;  -- açık vardiya + takas yalnızca full modda

  -- ============================================================
  -- 6) MÜSAİTLİK
  -- ============================================================
  FOR i IN 1..n_emp LOOP
    CONTINUE WHEN i % 3 = 0;
    IF emp_pt[i] THEN
      INSERT INTO employee_availability (employee_id, day_of_week, start_time, end_time, is_available, note)
      VALUES (emp_ids[i], (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[(i % 5) + 1]::day_of_week, '08:00', '13:00', FALSE, 'Üniversite dersleri.')
      RETURNING id INTO v_id;
      PERFORM pg_temp.trk('employee_availability', v_id);
      INSERT INTO employee_availability (employee_id, day_of_week, start_time, end_time, is_available, note)
      VALUES (emp_ids[i], 'saturday', '10:00', '22:00', TRUE, 'Hafta sonu tam gün çalışabilirim.')
      RETURNING id INTO v_id;
      PERFORM pg_temp.trk('employee_availability', v_id);
    ELSE
      INSERT INTO employee_availability (employee_id, day_of_week, start_time, end_time, is_available, note)
      VALUES (emp_ids[i], (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[(i % 7) + 1]::day_of_week,
              (ARRAY['17:00', '18:00', '08:00'])[(i % 3) + 1]::time, (ARRAY['23:59', '23:59', '12:00'])[(i % 3) + 1]::time, FALSE,
              (ARRAY['Akşam kursum var.', 'Çocuğumu kreşten alıyorum.', 'Sabahları annemi fizik tedaviye götürüyorum.'])[(i % 3) + 1])
      RETURNING id INTO v_id;
      PERFORM pg_temp.trk('employee_availability', v_id);
    END IF;
  END LOOP;

  -- ============================================================
  -- 7) DİĞER AUDIT KAYITLARI (izin kararları)
  -- ============================================================
  FOR rec IN
    SELECT lr.id, lr.status, lr.reviewed_at, lr.employee_id FROM leave_requests lr
    JOIN public._dummy_seed ds ON ds.tbl = 'leave_requests' AND ds.id = lr.id::text
    WHERE lr.leave_type <> 'weekly_rest' AND lr.status <> 'pending'
      AND lr.employee_id = ANY (emp_ids)
      AND NOT EXISTS (SELECT 1 FROM audit_logs al WHERE al.entity_id = lr.id::text AND al.action = 'leave.review')
  LOOP
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, created_at)
    VALUES (reviewer, 'leave.review', 'leave_request', rec.id::text, jsonb_build_object('status', 'pending'),
            jsonb_build_object('status', rec.status, 'employee_id', rec.employee_id), rec.reviewed_at)
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('audit_logs', v_id);
  END LOOP;

  IF v_mode = 'full' THEN
  -- ============================================================
  -- 8) KONTROL LİSTELERİ — şablonlar + 1 Eylül'den bugüne her günün uygulaması
  --    Açılışı o gün mağazaya ilk giren, kapanışı en geç çıkan çalışan işaretler. Geçmiş günlerin
  --    ~%88'i vaktinde, ~%7'si geç tamamlanmış, ~%5'i yarım kalmış (gecikme bildirimi yöneticilere).
  --    Bugün: açılış tamamlanmış, kapanış henüz başlanmamış.
  --    weekdays: 0 = Pazar … 6 = Cumartesi (lib/checklistRules)
  -- ============================================================
  FOR spec IN
    SELECT * FROM (VALUES
      ('Capitol', 'Açılış kontrolü', 'opening', ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[], TIME '10:15',
        ARRAY['Alarm sistemi devre dışı bırakıldı', 'Işıklar ve vitrin aydınlatması açıldı', 'Kasalar açıldı, açılış bakiyesi sayıldı',
              'POS cihazları ve barkod okuyucular test edildi', 'Satış alanı ve giriş temiz', 'Soyunma kabinleri kontrol edildi',
              'Kampanya etiketleri ve fiyatlar kontrol edildi', 'Günün sevkiyat listesi kontrol edildi']::text[],
        ARRAY[TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE]::boolean[]),
      ('Capitol', 'Kapanış kontrolü', 'closing', ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[], TIME '22:30',
        ARRAY['Son müşteri çıktıktan sonra giriş kapısı kilitlendi', 'Soyunma kabinlerinde ürün kalmadı', 'Askılar ve raflar düzenlendi',
              'Kasa sayımı yapıldı, Z raporu alındı', 'Günlük ciro ve kasa farkı sisteme girildi', 'Çöpler çıkarıldı',
              'Klimalar ve vitrin ışıkları kapatıldı', 'Alarm kuruldu'],
        ARRAY[TRUE, FALSE, FALSE, TRUE, TRUE, FALSE, TRUE, TRUE]),
      ('Capitol', 'Haftalık depo düzeni', 'custom', ARRAY[1]::smallint[], TIME '13:00',
        ARRAY['Depo rafları etiketlendi', 'İade ürünleri ayrıldı ve listelendi', 'Hasarlı ürünler için tutanak tutuldu',
              'Boş koliler atıldı', 'Yangın tüplerinin kontrol tarihi kontrol edildi'],
        ARRAY[TRUE, TRUE, FALSE, FALSE, TRUE]),
      ('Capitol', 'Hafta sonu kasa ara sayımı', 'custom', ARRAY[0, 6]::smallint[], TIME '16:00',
        ARRAY['Kasa 1 ara sayımı yapıldı', 'Kasa 2 ara sayımı yapıldı', 'Fazla nakit kasaya (çelik kasa) aktarıldı'],
        ARRAY[TRUE, TRUE, TRUE]),
      ('Canpark', 'Açılış kontrolü', 'opening', ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[], TIME '09:30',
        ARRAY['Alarm sistemi devre dışı bırakıldı', 'Işıklar açıldı', 'Kasa açıldı, açılış bakiyesi sayıldı',
              'POS cihazı test edildi', 'Satış alanı ve giriş temiz', 'Kampanya etiketleri kontrol edildi'],
        ARRAY[TRUE, TRUE, TRUE, TRUE, FALSE, FALSE]),
      ('Canpark', 'Kapanış kontrolü', 'closing', ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[], TIME '22:30',
        ARRAY['Giriş kapısı kilitlendi', 'Kasa sayımı yapıldı, Z raporu alındı', 'Raflar düzenlendi',
              'Işıklar kapatıldı', 'Alarm kuruldu'],
        ARRAY[TRUE, TRUE, FALSE, TRUE, TRUE])
    ) AS s(store_name, name, kind, weekdays, due, items, req)
  LOOP
    SELECT id INTO v_store FROM stores WHERE name = spec.store_name;
    CONTINUE WHEN v_store IS NULL;
    SELECT e.id INTO v_author FROM employees e JOIN roles ro ON ro.id = e.role_id
    WHERE e.active AND e.store_id = v_store AND ro.access_level IN ('store_manager', 'manager', 'admin')
    ORDER BY CASE ro.access_level WHEN 'store_manager' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, e.created_at LIMIT 1;

    INSERT INTO checklist_templates (store_id, name, kind, weekdays, due_time, active, created_by, created_at, updated_at)
    VALUES (v_store, spec.name, spec.kind, spec.weekdays, spec.due, TRUE, v_author,
            pg_temp.tr_ts(d_start - 3, '15:40'), pg_temp.tr_ts(d_start - 3, '15:40'))
    RETURNING id INTO v_tid;
    PERFORM pg_temp.trk('checklist_templates', v_tid);
    INSERT INTO checklist_template_items (template_id, position, text, required)
    SELECT v_tid, (o - 1)::int, x, spec.req[o] FROM unnest(spec.items) WITH ORDINALITY u(x, o);
    v_last_req := (SELECT max(o) FROM unnest(spec.req) WITH ORDINALITY u(x, o) WHERE x);

    d := d_start;
    WHILE d <= v_today LOOP
      IF EXTRACT(DOW FROM d)::int = ANY (spec.weekdays) THEN
        v_due := pg_temp.tr_ts(d, spec.due);
        -- işaretleyen: o gün bu mağazada okutma yapmış biri (açılış: ilk giren, kapanış: en geç çıkan)
        SELECT ar.employee_id INTO who FROM attendance_records ar
          JOIN shift_assignments sa ON sa.id = ar.shift_assignment_id
          JOIN employees e ON e.id = sa.employee_id
        WHERE e.store_id = v_store AND sa.work_date = d AND ar.clock_in_at <= v_now
        ORDER BY CASE WHEN spec.kind = 'closing' THEN -extract(epoch FROM COALESCE(ar.clock_out_at, pg_temp.tr_ts(d, sa.end_time))) ELSE extract(epoch FROM ar.clock_in_at) END
        LIMIT 1;
        v_alt := CASE WHEN FOUND THEN who.employee_id ELSE v_author END;
        -- ikinci kişi (bazı maddeleri o işaretler)
        SELECT ar.employee_id INTO v_aid FROM attendance_records ar
          JOIN shift_assignments sa ON sa.id = ar.shift_assignment_id
          JOIN employees e ON e.id = sa.employee_id
        WHERE e.store_id = v_store AND sa.work_date = d AND ar.employee_id <> v_alt AND ar.clock_in_at <= v_now
        ORDER BY md5(ar.id::text) LIMIT 1;

        r := random();
        IF d = v_today THEN
          v_outcome := CASE WHEN v_now > v_due THEN 'ok' ELSE 'none' END;
        ELSE
          v_outcome := CASE WHEN r < 0.88 THEN 'ok' WHEN r < 0.95 THEN 'late' ELSE 'open' END;
        END IF;
        v_cursor := CASE v_outcome WHEN 'late' THEN v_due + make_interval(mins => pg_temp.rnd(20, 70))
                                   ELSE v_due - make_interval(mins => pg_temp.rnd(25, 45)) END;
        v_stop := CASE v_outcome WHEN 'none' THEN 0 WHEN 'open' THEN pg_temp.rnd(1, v_last_req - 1) ELSE array_length(spec.items, 1) END;

        INSERT INTO checklist_runs (store_id, template_id, run_date, name, kind, due_time, created_at, note)
        VALUES (v_store, v_tid, d, spec.name, spec.kind, spec.due, LEAST(pg_temp.tr_ts(d, '06:00') + make_interval(mins => pg_temp.rnd(0, 180)), v_now),
                CASE WHEN v_outcome <> 'none' AND random() < 0.08 THEN
                  CASE spec.kind
                    WHEN 'closing' THEN (ARRAY['Kasa farkı yok.', 'Kasa 2''de 15 TL eksik, tutanak tutuldu.', 'Kabin 3 kapısı sıkışıyor, bakım talebi açıldı.',
                                               'Vitrin spotlarından biri yanmıyor.'])[pg_temp.rnd(1, 4)]
                    WHEN 'opening' THEN (ARRAY['Sevkiyat 1 saat gecikti.', 'POS 2 açılışta hata verdi, yeniden başlatınca düzeldi.',
                                               'Giriş paspası değiştirilmeli.'])[pg_temp.rnd(1, 3)]
                    ELSE 'Eksik yok.' END
                END)
        RETURNING id INTO v_rid;
        PERFORM pg_temp.trk('checklist_runs', v_rid);

        v_req_done := NULL;
        FOR k IN 1..array_length(spec.items, 1) LOOP
          IF k <= v_stop THEN
            v_cursor := v_cursor + make_interval(mins => pg_temp.rnd(1, 4), secs => pg_temp.rnd(0, 59));
            IF spec.req[k] THEN v_req_done := v_cursor; END IF;
          END IF;
          INSERT INTO checklist_run_items (run_id, position, text, required, done_at, done_by)
          VALUES (v_rid, k - 1, spec.items[k], spec.req[k],
                  CASE WHEN k <= v_stop THEN v_cursor END,
                  CASE WHEN k <= v_stop THEN CASE WHEN v_aid IS NOT NULL AND random() < 0.2 THEN v_aid ELSE v_alt END END);
        END LOOP;

        -- tamamlanma: tüm zorunlu maddeler işaretlendiği an (set_checklist_item ile aynı kural)
        v_completed := CASE WHEN v_stop >= v_last_req THEN v_req_done END;
        v_overdue := CASE WHEN (v_completed IS NULL OR v_completed > v_due + INTERVAL '15 minutes') AND v_now > v_due + INTERVAL '15 minutes'
                          THEN v_due + make_interval(mins => 15 + pg_temp.rnd(0, 4)) END;
        UPDATE checklist_runs SET completed_at = v_completed, completed_by = CASE WHEN v_completed IS NOT NULL THEN v_alt END,
               overdue_notified_at = v_overdue
        WHERE id = v_rid;

        IF v_overdue IS NOT NULL THEN
          PERFORM pg_temp.notify(m.id, 'checklist_overdue', 'Kontrol listesi gecikti',
            format('"%s" listesi son saati (%s) geçmesine rağmen tamamlanmadı.', spec.name, to_char(spec.due, 'HH24:MI')),
            v_rid, v_overdue, d < v_today - 1)
          FROM employees m JOIN roles ro ON ro.id = m.role_id
          WHERE m.active AND (ro.access_level = 'admin' OR (m.store_id = v_store AND ro.access_level IN ('store_manager', 'manager')));
        END IF;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  -- ============================================================
  -- 9) DUYURULAR — alıcı anlık görüntüsü (mağazanın aktif çalışanları, Kiosk ve yazar hariç),
  --    okunma / onay saatleri, bildirimler ve onay bekleyenlere hatırlatma
  --    ('*' = tüm mağazalar). Oluşturma saatleri Türkiye saatidir.
  -- ============================================================
  FOR spec IN
    SELECT * FROM (VALUES
      ('Capitol', 'Seyfullah Demir', '2026-09-01 09:10', 'Eylül çalışma düzeni ve mola saatleri',
       E'Merhaba arkadaşlar,\n\nEylül ayı boyunca mağaza 10:00–22:00 arası açık. Vardiyalar açılış (10–18), ara (12–20) ve kapanış (14–22) olarak haftalık dönüşümlü planlanıyor.\n\nMolalarınızı yoğun saatlerde (13:00–15:00 ve 18:00–20:00) mümkün olduğunca kısa tutalım, molaya çıkarken ve dönerken QR okutmayı unutmayalım.\n\nKolay gelsin.',
       FALSE, FALSE, 'all', NULL::text, 0.97, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-09-04 18:30', 'Kıyafet ve yaka kartı yönetmeliği',
       E'Mağaza içinde kurumsal tişört ve yaka kartı zorunludur. Ayakkabılar kapalı burunlu olmalı; takı ve aksesuarlarda sade tercih edilmeli.\n\nYönetmeliğin tamamı personel odasındaki panoda asılı. Okuduktan sonra lütfen bu duyuruyu onaylayın.',
       TRUE, TRUE, 'all', NULL, 0.98, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-09-11 16:05', 'Sonbahar koleksiyonu teslimatı — Pazartesi erken giriş',
       E'Pazartesi (14 Eylül) sabah 08:00''de sonbahar koleksiyonunun ilk sevkiyatı gelecek. Açılış vardiyasındaki arkadaşlar o gün 08:30''da mağazada olsun; ek süre puantaja işlenecek.',
       FALSE, FALSE, 'all', '2026-09-15 00:00', 0.95, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-09-19 11:20', 'İş sağlığı ve güvenliği eğitimi (zorunlu)',
       E'Yıllık İSG eğitimimiz 26 Eylül Cumartesi 09:00–10:30 arasında mağazada yapılacak. Katılım zorunludur, eğitim süresi çalışma süresinden sayılır.\n\nEğitime katılacağınızı bu duyuruyu onaylayarak bildirin.',
       FALSE, TRUE, 'all', '2026-09-27 00:00', 0.92, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-09-28 10:00', 'Yöneticiler için: Ekim norm saatleri',
       E'Ekim ayı için mağaza norm saatini 3.500 saat olarak belirledim. Haftalık planları yaparken norm göstergesini takip edelim; %90''ı geçen haftalarda bana haber verin.',
       FALSE, FALSE, 'managers', NULL, 1.0, FALSE),
      ('*', 'Ömer F Kutlay', '2026-10-01 09:00', 'QR ile giriş-çıkışta konum doğrulaması',
       E'Bugünden itibaren QR okuturken telefonunuzun konumu da doğrulanacak. Konum yalnızca okuttuğunuz anda, mağazada olduğunuzu kontrol etmek için alınır; sürekli takip edilmez.\n\nKonum izni sorulursa "İzin Ver" seçin. Sorun yaşarsanız mağaza müdürünüze haber verin.',
       FALSE, FALSE, 'all', NULL, 0.96, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-10-05 17:45', 'Ekim kampanyası: %30 indirim günleri',
       E'9–18 Ekim arasında tüm triko ve dış giyimde %30 indirim var. Kampanya etiketleri Perşembe akşamı kapanışta değiştirilecek; kapanış ekibi lütfen 15 dk erken başlasın.\n\nKampanya süresince kasa yoğunluğu nedeniyle hafta sonu molaları 30''ar dakikalık iki parça halinde kullanılacak.',
       FALSE, FALSE, 'all', '2026-10-19 00:00', 0.94, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-10-13 12:30', 'Mesai düzeltme talepleri hakkında',
       E'QR okutmayı unuttuğunuz günler için mesai düzeltme talebini en geç ertesi gün oluşturun. Bir haftadan eski talepler puantaj kapandığı için işleme alınamıyor.',
       FALSE, FALSE, 'all', NULL, 0.9, TRUE),
      ('Capitol', 'Seyfullah Demir', '2026-10-24 15:15', '29 Ekim Cumhuriyet Bayramı çalışma saatleri',
       E'29 Ekim Perşembe günü mağaza 12:00–22:00 arası açık olacak. O gün çalışan arkadaşların resmi tatil ücreti puantaja ayrıca işlenecek.\n\nHepimizin Cumhuriyet Bayramı kutlu olsun!',
       TRUE, FALSE, 'all', '2026-10-30 00:00', 0.93, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-10-28 18:10', 'Kasım vardiya planı yayınlandı',
       E'Kasım ayının ilk iki haftasının vardiya planı yayında. "Vardiyalarım" sayfasından kontrol edin; takas ihtiyacınız varsa en geç 1 Kasım''a kadar takas talebi oluşturun.',
       TRUE, FALSE, 'all', NULL, 0.75, FALSE),
      ('Capitol', 'Seyfullah Demir', '2026-10-29 19:40', 'Yıl sonu sayımı hazırlığı — 15 Kasım',
       E'15 Kasım Pazar günü yıl sonu envanter sayımı yapılacak. Mağaza o gün 08:00''de açılacak, sayım bitene kadar satış yapılmayacak.\n\nSayım ekibine kimlerin katılacağı bu hafta içinde planlanacak. Duyuruyu okuduğunuzu lütfen onaylayın.',
       FALSE, TRUE, 'all', NULL, 0.45, FALSE),
      ('Canpark', 'Çalışan bir', '2026-09-07 10:30', 'Canpark açılış saati değişti',
       E'AVM yönetiminin kararıyla 8 Eylül''den itibaren mağaza 09:30''da açılıyor. Açılış ekibi 09:15''te mağazada olsun.',
       FALSE, FALSE, 'all', NULL, 1.0, FALSE),
      ('Canpark', 'Çalışan bir', '2026-10-15 09:50', 'Kasa devri prosedürü',
       E'Vardiya değişiminde kasa devri artık iki kişi tarafından sayılarak yapılacak ve kapanış kontrol listesine not düşülecek. Lütfen okuyup onaylayın.',
       FALSE, TRUE, 'all', NULL, 1.0, FALSE)
    ) AS s(store_name, author, at_tr, title, body, pinned, needs_ack, target, expires_tr, read_ratio, edited)
  LOOP
    v_store := CASE WHEN spec.store_name = '*' THEN NULL ELSE (SELECT id FROM stores WHERE name = spec.store_name) END;
    CONTINUE WHEN spec.store_name <> '*' AND v_store IS NULL;
    SELECT e.id INTO v_author FROM employees e WHERE e.full_name = spec.author AND e.active;
    IF v_author IS NULL THEN v_author := reviewer; END IF;
    v_at := (spec.at_tr::timestamp) AT TIME ZONE 'Europe/Istanbul';
    CONTINUE WHEN v_at > v_now;

    INSERT INTO announcements (store_id, title, body, pinned, requires_ack, target_roles, expires_at, created_by, created_at, updated_at, edited_at)
    VALUES (v_store, spec.title, spec.body, spec.pinned, spec.needs_ack, spec.target,
            (spec.expires_tr::timestamp) AT TIME ZONE 'Europe/Istanbul', v_author, v_at,
            CASE WHEN spec.edited THEN v_at + INTERVAL '20 hours' ELSE v_at END,
            CASE WHEN spec.edited THEN v_at + INTERVAL '20 hours' END)
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('announcements', v_id);

    v_reminded := FALSE;
    FOR rec IN
      SELECT e.id FROM employees e LEFT JOIN roles ro ON ro.id = e.role_id
      WHERE e.active AND e.id <> v_author AND COALESCE(ro.access_level, 'employee') <> 'kiosk'
        AND (v_store IS NULL OR e.store_id = v_store)
        AND (spec.target = 'all' OR ro.access_level IN ('admin', 'store_manager', 'manager'))
      ORDER BY e.id
    LOOP
      v_read := CASE WHEN random() < spec.read_ratio
                     THEN LEAST(v_at + make_interval(mins => CASE WHEN random() < 0.7 THEN pg_temp.rnd(3, 240) ELSE pg_temp.rnd(240, 2400) END),
                                v_now - INTERVAL '10 minutes') END;
      v_ack := CASE WHEN spec.needs_ack AND v_read IS NOT NULL AND random() < 0.93
                    THEN LEAST(v_read + make_interval(mins => pg_temp.rnd(1, 20)), v_now - INTERVAL '5 minutes') END;
      INSERT INTO announcement_recipients (announcement_id, employee_id, read_at, ack_at, created_at)
      VALUES (v_id, rec.id, v_read, v_ack, v_at);
      PERFORM pg_temp.notify(rec.id, 'announcement', spec.title, pg_temp.preview(spec.body), v_id, v_at, v_read IS NOT NULL);
      -- onay bekleyenlere 2 gün sonra hatırlatma
      IF spec.needs_ack AND v_ack IS NULL AND v_at + INTERVAL '2 days' < v_now THEN
        PERFORM pg_temp.notify(rec.id, 'announcement', 'Hatırlatma: ' || spec.title, 'Duyuruyu okuyup onaylamanız bekleniyor.',
                               v_id, v_at + INTERVAL '2 days', v_read IS NOT NULL);
        v_reminded := TRUE;
      END IF;
    END LOOP;
    IF v_reminded THEN UPDATE announcements SET last_reminded_at = v_at + INTERVAL '2 days' WHERE id = v_id; END IF;
  END LOOP;
  END IF;  -- kontrol listesi + duyuru yalnızca full modda

  RAISE NOTICE 'Dummy seed tamam: %', (SELECT jsonb_object_agg(tbl, c) FROM (SELECT tbl, count(*) c FROM public._dummy_seed GROUP BY tbl) x);
END $seed$;

ALTER TABLE public.notifications ENABLE TRIGGER trg_notifications_push_fanout;

SELECT tbl, count(*) AS rows FROM public._dummy_seed GROUP BY tbl ORDER BY tbl;
