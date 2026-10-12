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
 * Format a Date to 'EEEE' (day name) in Turkish locale.
 */
export function formatDayNameTurkish(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    timeZone: TURKEY_TZ,
  }).format(date)
}
