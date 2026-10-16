import { format } from 'date-fns'

const TURKEY_TZ = 'Europe/Istanbul'

/**
 * Format a UTC ISO string to Turkey local time (HH:mm).
 * Falls back gracefully if the date is invalid.
 */
export function formatInTimeZone(isoString: string, fmt = 'HH:mm'): string {
  try {
    const date = new Date(isoString)
    // Use Intl.DateTimeFormat for timezone conversion (no extra dep needed)
    const formatter = new Intl.DateTimeFormat('tr-TR', {
      timeZone: TURKEY_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    if (fmt === 'HH:mm') {
      return formatter.format(date)
    }
    // For other formats, use basic approach
    return format(date, fmt)
  } catch {
    return '--:--'
  }
}

/**
 * Format a Date to 'dd MMMM yyyy' in Turkish locale.
 */
export function formatDateTurkish(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TURKEY_TZ,
  }).format(date)
}

/**
 * Verilen anın Türkiye saatine göre takvim tarihi (YYYY-MM-DD).
 * Sunucu UTC'de çalışsa bile 00:00–03:00 arasında doğru günü verir.
 */
export function turkeyDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TURKEY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/** Bugünün Türkiye tarihi (YYYY-MM-DD) */
export function turkeyToday(): string {
  return turkeyDateString(new Date())
}

/** 'YYYY-MM-DD' tarihine n gün ekler (saat diliminden bağımsız, UTC aritmetiği) */
export function addDaysToDateString(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' tarihinin haftanın günü (0=Pazar … 6=Cumartesi), saat diliminden bağımsız */
export function dayOfWeekFromDateString(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay()
}

/**
 * Format a Date to 'EEEE' (day name) in Turkish locale.
 */
export function formatDayNameTurkish(date: Date): string {
  const name = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    timeZone: TURKEY_TZ,
  }).format(date)
  // Intl küçük harf döndürür ("cuma") — başlıkta "Cuma" görünsün
  return name.charAt(0).toLocaleUpperCase('tr-TR') + name.slice(1)
}
