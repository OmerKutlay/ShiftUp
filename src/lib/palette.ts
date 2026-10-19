/**
 * palette — ShiftUp renk token'larının tek kaynağı (yeni açık, sıcak tonlu UI).
 *
 * Tailwind tarafındaki karşılıkları src/app/globals.css'te; bu dosya yalnızca dinamik
 * renk gereken satır içi style değerleri (vardiya türü, avatar, QR) için kullanılır.
 * Bileşenlerde ham hex / rgba yazılmaz.
 *
 * Adlandırma: <ton> = metin/ikon için okunaklı koyu ton, <ton>Fill = çubuk/nokta
 * gibi dolgu, <ton>Soft = rozet/hücre zemini.
 */

export const C = {
  // Yüzeyler
  canvas: '#F5EFE6',       // uygulama zemini (sidebar, mobil arka plan)
  surface: '#FFFDFA',      // kart / içerik paneli
  surfaceAlt: '#FAF5EE',   // ikincil yüzey (KPI kutusu, input)
  surfaceMuted: '#F2ECE3', // segment kontrol zemini
  sand: '#E6DCCD',         // hafta tatili (puantaj şeridi)
  border: '#ECE4D8',       // kart kenarlığı, ayraç

  // Metin
  ink: '#2B211B',
  inkSecondary: '#605853',
  inkMuted: '#8C827A',

  // Marka (kiremit)
  brand: '#C2532D',
  brandDark: '#A3441F',
  brandLight: '#E0814F',
  brandSoft: '#FBEDE5',

  // Durum tonları
  success: '#4E7A3B',
  successFill: '#B9D4A6',
  successSoft: '#E6F0DF',
  warning: '#946A1E',
  warningFill: '#E6A93E',
  warningSoft: '#FCEFD2',
  danger: '#B8412C',
  dangerFill: '#C8452F',
  dangerSoft: '#FBE4DF',
  info: '#356BA8',
  infoFill: '#3F7CC0',
  infoSoft: '#E4EDF7',
  plum: '#874F71',
  plumFill: '#A35A87',
  plumSoft: '#F2E1EB',
  peach: '#985032',
  peachFill: '#E0814F',
  peachSoft: '#FCE3D5',
  neutral: '#7A706A',
  neutralSoft: '#F2ECE3',

  white: '#FFFFFF',
} as const

export type ColorToken = keyof typeof C

/** Hex token'dan yarı saydam rgba üretir: tint(C.brand, 0.1) */
export function tint(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Vardiya türü renkleri (Açılış / Ortacı / Kapanış …) — hücre zemini, metin ve çubuk */
export const SHIFT_KIND_TONES = {
  opening: { soft: C.warningSoft, text: C.warning, fill: C.warningFill },
  mid: { soft: C.peachSoft, text: C.peach, fill: C.peachFill },
  closing: { soft: C.plumSoft, text: C.plum, fill: C.plumFill },
  full: { soft: C.infoSoft, text: C.info, fill: C.infoFill },
  custom: { soft: C.neutralSoft, text: C.neutral, fill: C.inkMuted },
} as const

/** Kişi avatarları için pastel zemin + koyu baş harf rengi (ada göre sabit seçilir) */
export const AVATAR_TONES = [
  { bg: C.peachSoft, fg: C.peach },
  { bg: C.warningSoft, fg: C.warning },
  { bg: C.successSoft, fg: C.success },
  { bg: C.plumSoft, fg: C.plum },
  { bg: C.neutralSoft, fg: C.neutral },
  { bg: C.dangerSoft, fg: C.danger },
  { bg: C.infoSoft, fg: C.info },
] as const

export function avatarTone(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length]
}
