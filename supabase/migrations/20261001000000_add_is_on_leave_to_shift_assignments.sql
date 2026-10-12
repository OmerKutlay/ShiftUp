-- FAZ 12: shift_assignments'a is_on_leave kolonu ekle
-- İzin onaylandığında vardiya silinmez, is_on_leave = true işaretlenir.
ALTER TABLE shift_assignments
  ADD COLUMN IF NOT EXISTS is_on_leave BOOLEAN NOT NULL DEFAULT FALSE;
