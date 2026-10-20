/**
 * attendanceOverride — yönetici düzeltmesi sonrası devam kaydının tutarlılık kontrolü (saf).
 */
import type { AttendanceStatus } from '@/types/attendance'

export interface OverrideState {
  status: AttendanceStatus
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
  completed_break_minutes: number
}

/** Kaydın son halinin tutarlılığını doğrular; hata mesajı ya da null döner */
export function validateOverrideState(s: OverrideState): string | null {
  const has = (v: string | null) => v !== null && v !== undefined
  switch (s.status) {
    case 'shift_waiting':
      if (has(s.clock_in_at) || has(s.clock_out_at)) return '"Vardiya bekleniyor" durumunda giriş/çıkış saati olamaz.'
      break
    case 'working':
      if (!has(s.clock_in_at)) return '"Çalışıyor" durumu için giriş saati gerekli.'
      if (has(s.clock_out_at)) return '"Çalışıyor" durumunda çıkış saati olamaz.'
      if (has(s.break_start_at) && !has(s.break_end_at)) return 'Açık mola varken durum "Molada" olmalı.'
      break
    case 'on_break':
      if (!has(s.clock_in_at) || !has(s.break_start_at)) return '"Molada" durumu için giriş ve mola başlangıcı gerekli.'
      if (has(s.break_end_at) || has(s.clock_out_at)) return '"Molada" durumunda mola bitişi/çıkış olamaz.'
      break
    case 'working_after_break':
      if (!has(s.clock_in_at) || !has(s.break_end_at)) return '"Moladan döndü" durumu için giriş ve mola bitişi gerekli.'
      if (has(s.clock_out_at)) return 'Bu durumda çıkış saati olamaz.'
      break
    case 'clocked_out':
      if (!has(s.clock_in_at) || !has(s.clock_out_at)) return '"Çıkış yaptı" durumu için giriş ve çıkış saati gerekli.'
      if (has(s.break_start_at) && !has(s.break_end_at)) return 'Çıkış yapılmış kayıtta açık mola olamaz.'
      break
  }

  if (has(s.break_end_at) && !has(s.break_start_at)) return 'Mola başlangıcı olmadan mola bitişi girilemez.'

  // Kronolojik sıra: giriş ≤ mola başı ≤ mola sonu ≤ çıkış
  const seq = [s.clock_in_at, s.break_start_at, s.break_end_at, s.clock_out_at]
    .filter((v): v is string => has(v))
    .map((v) => new Date(v).getTime())
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) return 'Saatler kronolojik sırada olmalı (giriş ≤ mola ≤ dönüş ≤ çıkış).'
  }
  if (has(s.clock_in_at) && has(s.clock_out_at)) {
    const span = new Date(s.clock_out_at!).getTime() - new Date(s.clock_in_at!).getTime()
    if (span > 24 * 3600_000) return 'Giriş ile çıkış arası 24 saati aşamaz.'
  }
  if (!Number.isInteger(s.completed_break_minutes) || s.completed_break_minutes < 0 || s.completed_break_minutes > 600) {
    return 'Önceki mola toplamı 0–600 dakika arasında olmalı.'
  }
  return null
}
