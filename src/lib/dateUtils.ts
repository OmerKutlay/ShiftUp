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

const TR_MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** 'YYYY-MM-DD' → '22 Eki 2026' (saat dilimi dönüşümü yok — takvim günü olduğu gibi) */
export function formatShortDateTr(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return dateStr
  return `${Number(m[3])} ${TR_MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`
}

/** İki takvim günü aralığı: aynı günse tek tarih, aynı yılsa yıl bir kez ('18 Eki – 20 Eki 2026') */
export function formatDateRangeTr(start: string, end: string): string {
  if (start === end) return formatShortDateTr(start)
  const s = formatShortDateTr(start)
  const e = formatShortDateTr(end)
  return start.slice(0, 4) === end.slice(0, 4) ? `${s.slice(0, -5)} – ${e}` : `${s} – ${e}`
}

/**
 * Serbest metindeki ham ISO tarihleri ('2026-10-22') okunur biçime çevirir.
 * Bildirim mesajları sunucuda bu biçimle üretilip saklandığından, gösterirken düzeltilir.
 */
export function humanizeIsoDates(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => formatShortDateTr(d))
}
