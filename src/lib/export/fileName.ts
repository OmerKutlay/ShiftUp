/**
 * fileName — indirilen rapor dosyalarının adları için ortak yardımcılar.
 */

/** Dosya adı için ASCII-güvenli mağaza slug'ı ("Kadıköy Şube" → "kadikoy-sube") */
export function storeFileSlug(name: string): string {
  const map: Record<string, string> = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'İ': 'i', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' }
  const slug = name
    .replace(/[çğıöşüİÇĞÖŞÜ]/g, (c) => map[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'magaza'
}

/** "Oluşturma" damgası: Türkiye saatiyle "30.10.2026 14:05" */
export function generatedAtTr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short',
  }).format(date)
}
