-- ============================================================
-- ShiftUp — test amaçlı DUMMY veri (employees tablosuna DOKUNMAZ)
-- Temizlik: scripts/dummy-data/cleanup.sql  (ayrıntı: DUMMY_DATA.md)
--
-- Eklenen her satırın id'si public._dummy_seed tablosuna yazılır;
-- temizlik yalnızca bu id'leri siler. Tekrar çalıştırılmaz (koruma var).
-- Geç giriş / gelmeme bildirimleri yalnızca son 21 gün için üretilir.
-- Aralık: 2026-08-03 (Pzt) → 2026-11-15 (Paz). Bugünden önceki vardiyalara
-- devam kaydı, bugünkü başlamış vardiyalara anlık durum yazılır.
--
-- Mod (SET LOCAL dummy.mode = '...'):
--   full     (varsayılan) tüm aktif çalışanlar (Kiosk hariç), _dummy_seed boş olmalı
--   yonetici yalnızca henüz dummy vardiyası olmayan Yönetici hesapları; açık vardiya
--            ve takas üretmez (ilk yükleme Yönetici'yi dışarıda bıraktığı için eklendi)
-- ============================================================

CREATE TABLE IF NOT EXISTS public._dummy_seed (
  tbl        TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tbl, id)
);
ALTER TABLE public._dummy_seed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._dummy_seed FROM anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.trk(p_tbl TEXT, p_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public._dummy_seed (tbl, id) VALUES (p_tbl, p_id::text) ON CONFLICT DO NOTHING;
END $$;

-- Türkiye saatiyle tarih+saat → timestamptz
CREATE OR REPLACE FUNCTION pg_temp.tr_ts(d DATE, t TIME) RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE AS $$
  SELECT (d + t) AT TIME ZONE 'Europe/Istanbul'
$$;

CREATE OR REPLACE FUNCTION pg_temp.rnd(lo INT, hi INT) RETURNS INT LANGUAGE sql VOLATILE AS $$
  SELECT lo + floor(random() * (hi - lo + 1))::int
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

DO $seed$
DECLARE
  d_start   CONSTANT DATE := DATE '2026-08-03';
  d_end     CONSTANT DATE := DATE '2026-11-15';
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

  i INT; k INT; w INT; t INT;
  v_rev UUID; v_late BOOLEAN;
  d DATE;
  v_id UUID; v_sid UUID; v_aid UUID;
  rest_dow INT; dow INT;
  s_time TIME; e_time TIME; v_tpl UUID;
  sched_in TIMESTAMPTZ; sched_out TIMESTAMPTZ;
  c_in TIMESTAMPTZ; b_s TIMESTAMPTZ; b_e TIMESTAMPTZ; c_out TIMESTAMPTZ;
  v_status TEXT; v_method TEXT; v_note TEXT; v_brk INT; r FLOAT;
  v_dist INT; v_acc INT;
  rec RECORD;
  spec RECORD;
  ls DATE; le DATE;
  v_cnt INT := 0;
  v_mode TEXT := COALESCE(NULLIF(current_setting('dummy.mode', true), ''), 'full');
BEGIN
  IF v_mode NOT IN ('full', 'yonetici') THEN RAISE EXCEPTION 'Geçersiz dummy.mode: %', v_mode; END IF;
  IF v_mode = 'full' AND EXISTS (SELECT 1 FROM public._dummy_seed) THEN
    RAISE EXCEPTION 'Dummy veri zaten yüklü (_dummy_seed dolu). Önce cleanup.sql çalıştırın.';
  END IF;
  PERFORM setseed(0.4242);

  -- ── Şablonlar: 6–10 saatlik, gece devretmeyen aktif şablonlar (en fazla 3) ──
  SELECT array_agg(id ORDER BY start_time), array_agg(start_time ORDER BY start_time), array_agg(end_time ORDER BY start_time)
    INTO tpl_ids, tpl_s, tpl_e
  FROM (
    SELECT id, start_time, end_time FROM shift_templates
    WHERE active AND end_time > start_time AND end_time - start_time BETWEEN INTERVAL '6 hours' AND INTERVAL '10 hours'
    ORDER BY start_time LIMIT 3
  ) x;
  IF tpl_ids IS NULL THEN
    tpl_ids := ARRAY[NULL, NULL, NULL]::uuid[];
    tpl_s   := ARRAY['08:00', '10:00', '14:00']::time[];
    tpl_e   := ARRAY['16:00', '18:00', '22:00']::time[];
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
    AND COALESCE(ro.name, e.role) <> 'Kiosk'
    AND (v_mode = 'full' OR (
      COALESCE(ro.name, e.role) = 'Yönetici'
      AND NOT EXISTS (SELECT 1 FROM shift_assignments sa JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
                      WHERE sa.employee_id = e.id)
    ));
  n_emp := COALESCE(array_length(emp_ids, 1), 0);
  IF n_emp < (CASE WHEN v_mode = 'full' THEN 4 ELSE 1 END) THEN RAISE EXCEPTION 'Yeterli çalışan yok (%).', n_emp; END IF;

  SELECT array_agg(e.id ORDER BY CASE COALESCE(ro.name, e.role) WHEN 'Mağaza Müdürü' THEN 1 WHEN 'Yönetici' THEN 2 ELSE 3 END, e.created_at)
    INTO mgr_ids
  FROM employees e LEFT JOIN roles ro ON ro.id = e.role_id
  WHERE e.active AND COALESCE(ro.name, e.role) IN ('Yönetici', 'Mağaza Müdürü', 'Müdür Yardımcısı');
  IF mgr_ids IS NULL THEN RAISE EXCEPTION 'Yönetici rolünde çalışan yok.'; END IF;
  reviewer := mgr_ids[1];

  -- ============================================================
  -- 1) İZİN TALEPLERİ (haftalık tatil hariç)
  -- ============================================================
  FOR spec IN
    SELECT * FROM (VALUES
      -- slot, gün ofseti (d_start'tan), süre, tür, durum, gerekçe, yönetici notu
      ( 0,   7, 5, 'annual',   'approved', 'Yaz tatili — ailece Bodrum''a gidiyoruz.', NULL),
      ( 1,  14, 4, 'annual',   'approved', 'Memlekete aile ziyareti (Trabzon).', 'İyi tatiller.'),
      ( 2,  21, 2, 'sick',     'approved', 'Doktor raporu — üst solunum yolu enfeksiyonu.', 'Geçmiş olsun, rapor sisteme işlendi.'),
      ( 3,  24, 1, 'personal', 'approved', 'Tapu dairesinde randevum var.', NULL),
      ( 4,  30, 3, 'annual',   'rejected', 'Kısa bir tatil planı.', 'Ay sonu sayımı nedeniyle bu tarihler uygun değil, farklı bir hafta seçebilir misin?'),
      ( 5,  36, 1, 'sick',     'approved', 'Diş tedavisi — kanal tedavisi sonrası istirahat.', NULL),
      ( 6,  38, 5, 'annual',   'approved', 'Düğün hazırlıkları.', 'Tebrikler! Mutluluklar dileriz.'),
      ( 7,  42, 1, 'other',    'approved', 'Ev taşıma.', NULL),
      ( 8,  45, 2, 'unpaid',   'approved', 'Ailevi bir mesele nedeniyle ücretsiz izin.', 'Ücretsiz izin olarak işlendi.'),
      ( 9,  49, 1, 'personal', 'rejected', 'Arkadaşımın nişanı.', 'O gün iki kişi zaten izinli, maalesef onaylayamıyorum.'),
      (10,  52, 3, 'sick',     'approved', 'Ayak bileği burkulması — 3 gün istirahat raporu.', 'Geçmiş olsun.'),
      (11,  56, 1, 'other',    'approved', 'Askerlik şubesi yoklaması.', NULL),
      (12,  59, 2, 'annual',   'approved', 'Kardeşimin mezuniyet töreni (İzmir).', NULL),
      (13,  63, 1, 'personal', 'approved', 'Çocuğumun veli toplantısı ve okul kaydı işlemleri.', NULL),
      (14,  66, 4, 'annual',   'rejected', 'Hafta sonuna bağlayarak tatil.', 'Kampanya haftasına denk geliyor, ekim sonu için tekrar talep oluştur.'),
      (15,  70, 1, 'sick',     'approved', 'Migren atağı, acil servis raporu.', NULL),
      (16,  73, 2, 'personal', 'approved', 'Vefat — amcamın cenazesi.', 'Başınız sağ olsun.'),
      -- bugünden sonrası: çoğu bekliyor
      (17,  76, 3, 'annual',   'pending',  'Cumhuriyet Bayramı''na bağlayarak memlekete gitmek istiyorum.', NULL),
      (18,  79, 1, 'personal', 'pending',  'Ehliyet sınavı.', NULL),
      (19,  84, 5, 'annual',   'pending',  'Kasım tatili — yurt dışı seyahati.', NULL),
      (20,  87, 2, 'other',    'pending',  'Üniversite vize sınavları.', NULL),
      (21,  91, 3, 'annual',   'approved', 'Balayı sonrası kalan izin günlerim.', 'Onaylandı.'),
      (22,  95, 1, 'unpaid',   'pending',  'Kişisel işler.', NULL),
      (23,  80, 2, 'sick',     'pending',  'Planlı küçük cerrahi operasyon (rapor ibraz edilecek).', NULL),
      (24, 100, 3, 'annual',   'rejected', 'Yıl sonu öncesi kısa tatil.', 'Kasım ortası envanter sayımı var.')
    ) AS s(slot, off, len, ltype, lstatus, reason, rnote)
  LOOP
    CONTINUE WHEN v_mode = 'yonetici' AND spec.slot NOT IN (1, 5, 12, 17, 19, 23);
    i  := CASE WHEN v_mode = 'full' THEN (spec.slot * 5) % n_emp ELSE spec.slot % n_emp END + 1;
    ls := d_start + spec.off;
    le := ls + spec.len - 1;
    v_rev := CASE WHEN emp_ids[i] = reviewer THEN COALESCE(mgr_ids[2], reviewer) ELSE reviewer END;
    IF spec.lstatus IN ('pending', 'approved') AND EXISTS (
      SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status IN ('pending', 'approved')
        AND lr.start_date <= le AND lr.end_date >= ls
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
  -- 2) HAFTALIK TATİL (weekly_rest) + VARDİYALAR + DEVAM KAYITLARI
  -- ============================================================
  FOR i IN 1..n_emp LOOP
    rest_dow := (i % 7) + 1;  -- ISO: 1=Pzt … 7=Paz

    -- haftalık tatil günleri (izin/vardiya ile çakışmayanlar)
    d := d_start + (rest_dow - 1);
    WHILE d <= d_end LOOP
      IF NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status IN ('pending','approved') AND d BETWEEN lr.start_date AND lr.end_date)
         AND NOT EXISTS (SELECT 1 FROM shift_assignments sa WHERE sa.employee_id = emp_ids[i] AND sa.work_date = d) THEN
        INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status, reviewed_at, reviewed_by, created_at, updated_at)
        VALUES (emp_ids[i], 'weekly_rest', d, d, 'approved',
                LEAST(pg_temp.tr_ts(d - 10, '17:00'), v_now - INTERVAL '3 hours'), reviewer,
                LEAST(pg_temp.tr_ts(d - 10, '17:00'), v_now - INTERVAL '3 hours'), LEAST(pg_temp.tr_ts(d - 10, '17:00'), v_now - INTERVAL '3 hours'))
        RETURNING id INTO v_id;
        PERFORM pg_temp.trk('leave_requests', v_id);
      END IF;
      d := d + 7;
    END LOOP;

    d := d_start;
    WHILE d <= d_end LOOP
      dow := EXTRACT(ISODOW FROM d)::int;
      w   := (d - d_start) / 7;

      -- tatil günü / yarı zamanlı ek boş günler / onaylı izin günleri atlanır
      IF dow = rest_dow
         OR (emp_pt[i] AND dow IN (((rest_dow + 1) % 7) + 1, ((rest_dow + 3) % 7) + 1))
         OR EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = emp_ids[i] AND lr.status = 'approved' AND d BETWEEN lr.start_date AND lr.end_date)
      THEN
        d := d + 1; CONTINUE;
      END IF;

      -- şablon haftalık döner (gün içinde dönüş 11 saat dinlenmeyi bozardı)
      t := ((w + i) % n_tpl) + 1;
      s_time := tpl_s[t];
      IF emp_pt[i] THEN
        e_time := s_time + INTERVAL '5 hours'; v_tpl := NULL;
      ELSE
        e_time := tpl_e[t]; v_tpl := tpl_ids[t];
      END IF;

      v_sid := NULL;
      INSERT INTO shift_assignments (employee_id, work_date, start_time, end_time, shift_template_id, created_at, updated_at)
      VALUES (emp_ids[i], d, s_time, e_time, v_tpl,
              LEAST(pg_temp.tr_ts(d - 7 - EXTRACT(ISODOW FROM d)::int, '16:00'), v_now - INTERVAL '4 hours'),
              LEAST(pg_temp.tr_ts(d - 7 - EXTRACT(ISODOW FROM d)::int, '16:00'), v_now - INTERVAL '4 hours'))
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_sid;
      IF v_sid IS NULL THEN d := d + 1; CONTINUE; END IF;
      PERFORM pg_temp.trk('shift_assignments', v_sid);

      sched_in  := pg_temp.tr_ts(d, s_time);
      sched_out := pg_temp.tr_ts(d, e_time);

      -- vardiya hatırlatması (son 2 hafta ve yarın)
      IF d BETWEEN v_today - 14 AND v_today + 1 THEN
        PERFORM pg_temp.notify(emp_ids[i], 'shift_reminder', 'Vardiya hatırlatması',
          to_char(d, 'DD.MM.YYYY') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI') || ' vardiyanız var.',
          v_sid, LEAST(sched_in - INTERVAL '12 hours', v_now - INTERVAL '5 minutes'), d < v_today - 2);
      END IF;

      IF sched_in > v_now THEN d := d + 1; CONTINUE; END IF;   -- henüz başlamamış

      r := random();
      IF d < v_today AND r < 0.03 THEN
        -- gelmedi: devam kaydı yok → mesai düzeltme / eksik giriş senaryoları için
        PERFORM pg_temp.notify(m, 'attendance_missed_clock_in', 'Giriş okutulmadı',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyası için henüz giriş QR''ı okutmadı.', v_sid, sched_in + INTERVAL '30 minutes', d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i] AND d >= v_today - 21;
        d := d + 1; CONTINUE;
      END IF;

      -- giriş
      v_note := NULL;
      v_late := random() < 0.09;
      IF v_late THEN
        c_in := sched_in + make_interval(mins => pg_temp.rnd(16, 52));
      ELSE
        c_in := sched_in + make_interval(mins => pg_temp.rnd(-12, 5));
      END IF;
      IF c_in > v_now THEN d := d + 1; CONTINUE; END IF;
      IF v_late THEN
        PERFORM pg_temp.notify(m, 'attendance_late_clock_in', 'Geç giriş',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyasına ' || round(extract(epoch FROM c_in - sched_in) / 60) || ' dk geç giriş okuttu (giriş: '
            || to_char(c_in AT TIME ZONE 'Europe/Istanbul', 'HH24:MI') || ').', v_sid, c_in, d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i] AND d >= v_today - 21;
      END IF;

      -- mola
      IF emp_pt[i] THEN v_brk := pg_temp.rnd(15, 20); ELSE v_brk := (ARRAY[30, 30, 45, 60, 60])[pg_temp.rnd(1, 5)]; END IF;
      b_s := sched_in + (sched_out - sched_in) / 2 + make_interval(mins => pg_temp.rnd(-50, 30));
      b_e := b_s + make_interval(mins => v_brk + pg_temp.rnd(-2, 6));

      -- çıkış: %12 fazla çalışma, %3 erken çıkış, kalan normal
      r := random();
      IF r < 0.12 THEN
        c_out := sched_out + make_interval(mins => (ARRAY[45, 60, 75, 90, 120, 150, 180])[pg_temp.rnd(1, 7)] + pg_temp.rnd(0, 8));
        v_note := (ARRAY['Sevkiyat kabulü nedeniyle mesaiye kalındı.', 'Akşam yoğunluğu — müdür onayıyla fazla çalışma.',
                         'Raf düzenlemesi ve kampanya hazırlığı.', 'Sayım çalışması.', NULL, NULL])[pg_temp.rnd(1, 6)];
      ELSIF r < 0.15 AND NOT emp_pt[i] THEN
        c_out := sched_out - make_interval(mins => pg_temp.rnd(30, 95));
        v_note := (ARRAY['Rahatsızlandığı için erken çıktı.', 'Müdür izniyle erken çıkış (hastane randevusu).', 'Çocuğunu okuldan alması gerekti.'])[pg_temp.rnd(1, 3)];
      ELSE
        c_out := sched_out + make_interval(mins => pg_temp.rnd(-3, 18));
      END IF;

      v_method := CASE WHEN random() < 0.85 THEN 'qr_location' ELSE 'qr' END;
      IF random() < 0.02 THEN
        v_method := 'manual_override';
        v_note := COALESCE(v_note, 'Kiosk tableti arızalıydı, giriş-çıkış müdür tarafından elle girildi.');
      END IF;
      v_dist := CASE WHEN v_method = 'qr_location' THEN pg_temp.rnd(3, 70) END;
      v_acc  := CASE WHEN v_method = 'qr_location' THEN pg_temp.rnd(5, 35) END;

      -- durum
      IF d < v_today AND random() < 0.015 THEN
        v_status := 'working_after_break'; c_out := NULL;   -- çıkış okutmayı unuttu
        PERFORM pg_temp.notify(m, 'attendance_missed_clock_out', 'Çıkış okutulmadı',
          emp_names[i] || ', ' || to_char(d, 'DD.MM') || ' ' || to_char(s_time, 'HH24:MI') || '–' || to_char(e_time, 'HH24:MI')
            || ' vardiyası bitti ancak çıkış QR''ı okutulmadı.', v_sid, sched_out + INTERVAL '45 minutes', d < v_today - 3)
        FROM unnest(mgr_ids) m WHERE m <> emp_ids[i];
      ELSIF v_now < b_s THEN
        v_status := 'working'; b_s := NULL; b_e := NULL; c_out := NULL;
      ELSIF v_now < b_e THEN
        v_status := 'on_break'; b_e := NULL; c_out := NULL;
      ELSIF c_out IS NULL OR v_now < c_out THEN
        v_status := 'working_after_break'; c_out := NULL;
      ELSE
        v_status := 'clocked_out';
      END IF;

      INSERT INTO attendance_records (employee_id, shift_assignment_id, status, clock_in_at, break_start_at, break_end_at, clock_out_at,
                                      completed_break_minutes, verification_method, exception_note, location_distance_m, location_accuracy_m,
                                      created_at, updated_at)
      VALUES (emp_ids[i], v_sid, v_status::attendance_status, c_in, b_s, b_e, c_out,
              CASE WHEN b_e IS NULL THEN 0 ELSE round(extract(epoch FROM b_e - b_s) / 60)::int END,
              v_method, v_note, v_dist, v_acc, c_in, COALESCE(c_out, b_e, b_s, c_in))
      RETURNING id INTO v_aid;
      PERFORM pg_temp.trk('attendance_records', v_aid);

      IF v_method = 'manual_override' THEN
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
  -- 3a) Gelmeyen (kaydı olmayan) geçmiş vardiyalar
  k := 0;
  FOR rec IN
    SELECT sa.id, sa.employee_id, sa.work_date, sa.start_time, sa.end_time,
           (SELECT array_position(emp_ids, sa.employee_id)) AS ei
    FROM shift_assignments sa
    JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
    WHERE sa.work_date < v_today
      AND sa.employee_id = ANY (emp_ids)
      AND NOT EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.shift_assignment_id = sa.id)
      AND NOT EXISTS (SELECT 1 FROM manual_time_correction_requests m WHERE m.employee_id = sa.employee_id AND m.date = sa.work_date)
    ORDER BY sa.work_date DESC
    LIMIT CASE WHEN v_mode = 'full' THEN 10 ELSE 4 END
  LOOP
    k := k + 1;
    v_status := (ARRAY['pending', 'approved', 'approved', 'rejected', 'pending', 'approved', 'direct', 'rejected', 'approved', 'pending'])[k];
    v_brk := (ARRAY[30, 45, 60])[pg_temp.rnd(1, 3)];
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

  -- 3b) Çıkış okutmayı unutanlar → bekleyen / onaylı düzeltme
  k := 0;
  FOR rec IN
    SELECT ar.id AS aid, sa.employee_id, sa.work_date, sa.start_time, sa.end_time, ar.completed_break_minutes,
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
    VALUES (rec.employee_id, rec.work_date, rec.start_time, rec.end_time, rec.completed_break_minutes,
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
      (12, 1, 'open',      'Çalışan',          'Cumhuriyet Bayramı arifesi yoğunluğu.'),
      (16, 2, 'open',      NULL,               'Kampanya haftası ek personel.'),
      (23, 3, 'open',      'Çalışan',          'Yıllık sayım hazırlığı.'),
      ( 6, 1, 'cancelled', 'Çalışan',          'Hafta sonu ek kasa (ihtiyaç kalmadı).'),
      (-9, 2, 'cancelled', 'Çalışan',          'Vitrin değişimi desteği — tedarikçi erteledi.'),
      (-25,3, 'cancelled', NULL,               'Etkinlik günü ek personel — etkinlik iptal edildi.')
    ) AS s(off, ti, ostatus, role_needed, descr)
  LOOP
    t := LEAST(spec.ti, n_tpl);
    INSERT INTO open_shifts (work_date, start_time, end_time, role_needed, description, status, created_at, updated_at)
    VALUES (v_today + spec.off, tpl_s[t], tpl_e[t], spec.role_needed, spec.descr, spec.ostatus::open_shift_status,
            LEAST(pg_temp.tr_ts(v_today + spec.off - 6, '15:00'), v_now - INTERVAL '3 hours'),
            LEAST(pg_temp.tr_ts(v_today + spec.off - 2, '15:00'), v_now - INTERVAL '1 hour'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('open_shifts', v_id);
    IF spec.ostatus = 'open' AND spec.off <= 4 THEN
      PERFORM pg_temp.notify(emp_ids[gs], 'open_shift_available', 'Yeni Açık Vardiya',
        to_char(v_today + spec.off, 'DD.MM.YYYY') || ' tarihinde ' || to_char(tpl_s[t], 'HH24:MI') || '–' || to_char(tpl_e[t], 'HH24:MI')
          || ' için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.',
        v_id, v_now - INTERVAL '20 hours', gs % 3 = 0)
      FROM generate_series(1, n_emp) gs;
    END IF;
  END LOOP;

  -- doldurulmuş açık vardiyalar: mevcut dummy vardiyaya bağlanır
  FOR rec IN
    SELECT sa.id, sa.employee_id, sa.work_date, sa.start_time, sa.end_time, (SELECT array_position(emp_ids, sa.employee_id)) AS ei
    FROM shift_assignments sa JOIN public._dummy_seed ds ON ds.tbl = 'shift_assignments' AND ds.id = sa.id::text
    WHERE sa.work_date BETWEEN v_today - 40 AND v_today + 10 AND EXTRACT(ISODOW FROM sa.work_date) IN (5, 6, 7)
    ORDER BY md5(sa.id::text) LIMIT 6
  LOOP
    INSERT INTO open_shifts (work_date, start_time, end_time, role_needed, description, status, filled_by, filled_assignment_id, created_at, updated_at)
    VALUES (rec.work_date, rec.start_time, rec.end_time, 'Çalışan',
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
  -- ============================================================
  k := 0;
  FOR rec IN
    SELECT a.id AS a_id, a.employee_id AS a_emp, b.id AS b_id, b.employee_id AS b_emp, a.work_date,
           (SELECT array_position(emp_ids, a.employee_id)) AS ai
    FROM shift_assignments a
    JOIN public._dummy_seed da ON da.tbl = 'shift_assignments' AND da.id = a.id::text
    JOIN shift_assignments b ON b.work_date = a.work_date AND b.employee_id <> a.employee_id AND b.start_time <> a.start_time
    JOIN public._dummy_seed db ON db.tbl = 'shift_assignments' AND db.id = b.id::text
    WHERE a.work_date BETWEEN v_today - 30 AND v_today + 25
      AND NOT EXISTS (SELECT 1 FROM attendance_records x WHERE x.shift_assignment_id IN (a.id, b.id))
      AND NOT EXISTS (SELECT 1 FROM open_shifts o WHERE o.filled_assignment_id IN (a.id, b.id))
    ORDER BY md5(a.id::text || b.id::text)
  LOOP
    -- her vardiya yalnızca bir talepte
    CONTINUE WHEN EXISTS (SELECT 1 FROM shift_swap_requests s WHERE s.requester_shift_id IN (rec.a_id, rec.b_id) OR s.target_shift_id IN (rec.a_id, rec.b_id));
    k := k + 1;
    EXIT WHEN k > 9;
    v_status := (ARRAY['pending', 'pending', 'pending', 'pending', 'approved', 'approved', 'rejected', 'cancelled', 'pending'])[k];
    INSERT INTO shift_swap_requests (requester_id, requester_shift_id, target_id, target_shift_id, status, requester_note, reviewer_note,
                                     reviewed_at, reviewed_by, target_accepted_at, created_at, updated_at)
    VALUES (rec.a_emp, rec.a_id, rec.b_emp, CASE WHEN k = 9 THEN NULL ELSE rec.b_id END, v_status::swap_status,
            (ARRAY['O gün akşam okulum var, sabah vardiyasına geçebilir miyim?', 'Hastane randevum çakışıyor.', 'Kardeşimin düğünü var, vardiyamı değişebilir miyiz?',
                   'Ulaşım sorunum var, saatleri değişelim mi?', 'Çocuğumun okul gösterisi var.', 'Sınavım var, değişebilir miyiz?',
                   'Aile ziyareti.', 'Vazgeçtim, kendi vardiyamda kalacağım.', 'Bu vardiyayı devretmek istiyorum.'])[k],
            CASE v_status WHEN 'rejected' THEN 'O gün iki tarafın da yetkinliği gereken bir sevkiyat var.' WHEN 'approved' THEN 'Uygun, onaylandı.' END,
            CASE WHEN v_status IN ('approved', 'rejected', 'cancelled') THEN LEAST(pg_temp.tr_ts(rec.work_date - 2, '13:00'), v_now - INTERVAL '1 hour') END,
            CASE WHEN v_status IN ('approved', 'rejected') THEN reviewer END,
            CASE WHEN v_status IN ('approved', 'rejected') OR k IN (3, 4) THEN LEAST(pg_temp.tr_ts(rec.work_date - 3, '18:00'), v_now - INTERVAL '2 hours') END,
            LEAST(pg_temp.tr_ts(rec.work_date - 4, '10:00'), v_now - INTERVAL '3 hours'),
            LEAST(pg_temp.tr_ts(rec.work_date - 2, '13:00'), v_now - INTERVAL '1 hour'))
    RETURNING id INTO v_id;
    PERFORM pg_temp.trk('shift_swap_requests', v_id);

    -- onaylı takas: vardiyalar gerçekten el değiştirir (tekil indeks için geçici tarih)
    IF v_status = 'approved' THEN
      UPDATE shift_assignments SET work_date = work_date + 3650 WHERE id = rec.b_id;
      UPDATE shift_assignments SET employee_id = rec.b_emp WHERE id = rec.a_id;
      UPDATE shift_assignments SET employee_id = rec.a_emp, work_date = rec.work_date WHERE id = rec.b_id;
    END IF;

    IF k <> 9 THEN
      PERFORM pg_temp.notify(rec.b_emp, 'shift_swap_submitted', 'Size bir vardiya takas teklifi var',
        emp_names[rec.ai] || ', ' || rec.work_date || ' tarihli vardiyası için sizinle takas yapmak istiyor. Kabul ederseniz yönetici onayına gönderilir.',
        v_id, LEAST(pg_temp.tr_ts(rec.work_date - 4, '10:00'), v_now - INTERVAL '3 hours'), v_status <> 'pending');
    END IF;
    IF v_status IN ('approved', 'rejected') THEN
      PERFORM pg_temp.notify(rec.a_emp, CASE WHEN v_status = 'approved' THEN 'shift_swap_approved' ELSE 'shift_swap_rejected' END,
        CASE WHEN v_status = 'approved' THEN 'Takas talebiniz onaylandı' ELSE 'Takas talebiniz reddedildi' END,
        rec.work_date || ' tarihli vardiya takas talebiniz ' || CASE WHEN v_status = 'approved' THEN 'onaylandı.' ELSE 'reddedildi.' END,
        v_id, LEAST(pg_temp.tr_ts(rec.work_date - 2, '13:00'), v_now - INTERVAL '1 hour'), FALSE);
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

  RAISE NOTICE 'Dummy seed tamam: %', (SELECT jsonb_object_agg(tbl, c) FROM (SELECT tbl, count(*) c FROM public._dummy_seed GROUP BY tbl) x);
END $seed$;

SELECT tbl, count(*) AS rows FROM public._dummy_seed GROUP BY tbl ORDER BY tbl;
