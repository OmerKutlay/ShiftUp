-- ============================================================
-- Çalışanın mağaza transferi
--
-- apply_employee_store_transfer(): transferin tüm yazma adımları TEK işlemde (transaction) yapılır;
-- herhangi bir adım hata verirse hiçbir şey değişmez.
--
--   - Eski mağazadaki BUGÜN ve sonrası vardiyalar silinir (haftalık plandan kalkar). Giriş/çıkış kaydı
--     olan vardiya ASLA silinmez (attendance_records → vardiya CASCADE): bugün çalışılmış vardiya,
--     geçmiş vardiyalar gibi eski mağazanın planında ve çalışanın özetinde kalır.
--   - Dün/bugün vardiyasında açık devam kaydı (giriş var, çıkış yok) varsa transfer reddedilir: vardiya eski
--     mağazaya bağlıdır ve yeni mağazanın kiosk'u ile kapatılamaz.
--   - Silinen vardiya açık vardiyadan üstlenildiyse açık vardiya tekrar "open" olur.
--   - Bekleyen takas talepleri iptal edilir (takaslar mağaza içidir); ayrıntı bildirim/denetim için döner.
--
-- Hata kodları (RAISE EXCEPTION mesajı): NOT_FOUND, TERMINATED, OPEN_ATTENDANCE
-- İdempotent: tekrar çalıştırılabilir.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_employee_store_transfer(
  p_employee_id UUID,
  p_actor_id    UUID,
  p_from_store  UUID,
  p_to_store    UUID,
  p_cancel_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   DATE := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_emp     public.employees%ROWTYPE;
  v_ids     UUID[];
  v_swaps   JSONB := '[]'::jsonb;
  v_reopen  INT := 0;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id AND store_id = p_from_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_emp.termination_date IS NOT NULL THEN RAISE EXCEPTION 'TERMINATED'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records ar
    JOIN public.shift_assignments sa ON sa.id = ar.shift_assignment_id
    WHERE sa.employee_id = p_employee_id AND sa.store_id = p_from_store AND sa.work_date >= v_today - 1
      AND ar.status <> 'clocked_out'
  ) THEN
    RAISE EXCEPTION 'OPEN_ATTENDANCE';
  END IF;

  SELECT array_agg(sa.id) INTO v_ids
  FROM public.shift_assignments sa
  WHERE sa.employee_id = p_employee_id AND sa.store_id = p_from_store AND sa.work_date >= v_today
    AND NOT EXISTS (SELECT 1 FROM public.attendance_records ar WHERE ar.shift_assignment_id = sa.id);
  v_ids := COALESCE(v_ids, '{}');

  -- Takaslar (silinen vardiyanın takası CASCADE ile gider; ayrıntı silmeden önce alınır)
  WITH u AS (
    UPDATE public.shift_swap_requests
       SET status = 'cancelled', reviewer_note = p_cancel_note, reviewed_by = p_actor_id, reviewed_at = now()
     WHERE status = 'pending' AND (requester_id = p_employee_id OR target_id = p_employee_id)
     RETURNING id, requester_id, target_id, requester_shift_id, target_shift_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id, 'requester_id', u.requester_id, 'target_id', u.target_id,
      'requester_shift_date', (SELECT work_date FROM public.shift_assignments WHERE id = u.requester_shift_id),
      'target_shift_date',    (SELECT work_date FROM public.shift_assignments WHERE id = u.target_shift_id))), '[]'::jsonb)
    INTO v_swaps FROM u;

  -- Üstlenilmiş açık vardiyalar mağazada tekrar açılır (FK SET NULL bağı silmeden önce koparır)
  WITH u AS (
    UPDATE public.open_shifts
       SET status = 'open', filled_by = NULL, filled_assignment_id = NULL, updated_at = now()
     WHERE filled_assignment_id = ANY (v_ids) RETURNING 1)
  SELECT count(*) INTO v_reopen FROM u;

  DELETE FROM public.shift_assignments WHERE id = ANY (v_ids);

  UPDATE public.employees SET store_id = p_to_store WHERE id = p_employee_id;

  RETURN jsonb_build_object(
    'shifts_deleted', COALESCE(array_length(v_ids, 1), 0),
    'open_shifts_reopened', v_reopen,
    'swaps', v_swaps);
END $$;

REVOKE ALL ON FUNCTION public.apply_employee_store_transfer(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
