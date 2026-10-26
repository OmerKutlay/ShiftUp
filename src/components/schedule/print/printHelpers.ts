/**
 * printHelpers — haftalık plan çıktısının saf yardımcıları (tarih aralığı, basım zamanı, hafta parametresi).
 */
const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, day: Number(d.slice(8, 10)) })

/**
 * "27 Ekim – 2 Kasım 2026" · aynı ay "19 – 25 Ekim 2026" · yıl geçişi "28 Aralık 2026 – 3 Ocak 2027".
 * Girdiler 'YYYY-MM-DD'; saat diliminden bağımsız (yalnızca metin ayrıştırılır).
 */
export function formatWeekRangeTr(from: string, to: string): string {
  const a = parts(from)
  const b = parts(to)
  if (a.y !== b.y) return `${a.day} ${MONTHS_TR[a.m]} ${a.y} – ${b.day} ${MONTHS_TR[b.m]} ${b.y}`
  if (a.m !== b.m) return `${a.day} ${MONTHS_TR[a.m]} – ${b.day} ${MONTHS_TR[b.m]} ${b.y}`
  return `${a.day} – ${b.day} ${MONTHS_TR[b.m]} ${b.y}`
}

/** "Basım" damgası: Türkiye saatiyle "26 Ekim 2026 14:05" */
export function formatPrintedAt(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

/** ?week= değeri geçerli bir 'YYYY-MM-DD' ise Date (yerel öğlen), değilse null */
export function parseWeekParam(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  // 2026-02-31 gibi taşan tarihler reddedilir
  return d.getMonth() + 1 === Number(value.slice(5, 7)) ? d : null
}

/** Dakikayı '38,5' (Türkçe ondalık, birimsiz) yazar */
export function hoursNumTr(mins: number): string {
  return (Math.round(mins / 6) / 10).toLocaleString('tr-TR')
}
