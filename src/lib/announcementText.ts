/**
 * announcementText — duyuru metni temizleme ve güvenli bağlantılaştırma (saf, client + server).
 *
 * Gövde düz metindir; HTML yorumlanmaz. Arayüz metni React düğümü olarak basar (otomatik
 * kaçışlı), URL'ler yalnızca http/https ise <a> olur — javascript:, data: vb. asla bağlantı olmaz.
 */

export const ANNOUNCEMENT_TITLE_MAX = 120
export const ANNOUNCEMENT_BODY_MAX = 4000

/** CR/LF → LF, kontrol karakterlerini (\n ve \t hariç) kaldırır, uçlardaki boşlukları atar */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
}

/** Başlık tek satırdır: satır sonları / sekmeler boşluğa çevrilir */
export function normalizeTitle(raw: string): string {
  return normalizeBody(raw).replace(/\s+/g, ' ').trim()
}

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string }

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_PUNCT = /[.,;:!?\]}'"»”’]/

/** Cümle sonu noktalamasını bağlantıdan ayırır; ")" yalnızca eşleşmemişse atılır */
function trimUrlEnd(url: string): string {
  let out = url
  for (;;) {
    const last = out[out.length - 1] ?? ''
    if (TRAILING_PUNCT.test(last)) out = out.slice(0, -1)
    else if (last === ')' && (out.match(/\)/g) ?? []).length > (out.match(/\(/g) ?? []).length) out = out.slice(0, -1)
    else return out
  }
}

/** http/https ise normalize edilmiş href, değilse null */
export function safeHref(candidate: string): string | null {
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u.href
  } catch {
    return null
  }
}

/** Metni düz metin ve güvenli bağlantı parçalarına böler (satır sonları metinde korunur) */
export function linkifyParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    const url = trimUrlEnd(m[0])
    const href = safeHref(url)
    if (!href) continue
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({ type: 'link', value: url, href })
    last = start + url.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

/** Bildirim / önizleme için tek satırlık kısa metin */
export function previewText(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
