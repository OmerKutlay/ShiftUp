import type { Announcement } from '@/types/announcement'

const TZ = 'Europe/Istanbul'

/** "26 Eki 14:30" — Türkiye saatiyle */
export function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** "26 Eki 2026" */
export function fmtDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Bitiş günü (yyyy-MM-dd, Türkiye) → gün sonu ISO (Türkiye UTC+3, yaz saati yok) */
export function endOfDayIso(date: string): string {
  return `${date}T23:59:59+03:00`
}

/** Çalışan açısından duyuru bekleyen bir işlem içeriyor mu (okunmadı ya da onay bekliyor)? */
export function needsAttention(a: Announcement): boolean {
  if (!a.is_recipient) return false
  return !a.read_at || (a.requires_ack && !a.ack_at)
}
