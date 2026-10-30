/**
 * csv — rapor CSV'lerinin ortak biçimi: UTF-8 BOM, `;` ayraç, CRLF satır sonu.
 * Türkçe Excel `;` ayraç bekler (`,` ondalık ayracıdır); BOM Türkçe karakterlerin doğru okunmasını sağlar.
 */

export type CsvValue = string | number | null | undefined

/** Türkçe Excel için ondalık virgül (binlik ayraç yok: sayı olarak okunur) */
export const csvNum = (n: number) => String(n).replace('.', ',')

/**
 * Tek hücre: formül enjeksiyonuna karşı kaçış (= + - @ tab CR ile başlayan metin) ve ayraç/tırnak/satır
 * sonu içeren hücrelerde tırnaklama. Sayılar kaçışsız yazılır (negatif sayı formül değildir).
 */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return csvNum(v)
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[;,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))]
  return '﻿' + lines.join('\r\n') + '\r\n'
}
