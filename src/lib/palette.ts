/**
 * palette — satır içi `style` gereken yerler için tema renkleri (vardiya türü, grafik, avatar).
 *
 * Değerler globals.css'teki CSS değişkenlerine başvurur; tek kaynak globals.css'tir.
 * Sınıf yazılabilen her yerde Tailwind token'ı (`text-success`, `bg-success/10`) tercih edilir.
 * Canvas gibi CSS değişkeni okuyamayan yerler RAW değerlerini kullanır.
 */

const v = (name: string) => `var(--${name})`
/** Rengin yarı saydam hali (CSS color-mix) */
export function tint(color: string, a: number): string {
  return `color-mix(in oklch, ${color} ${Math.round(a * 100)}%, transparent)`
}

export const C = {
  canvas: v('muted'),
  surface: v('card'),
  surfaceAlt: v('muted'),
  surfaceMuted: v('secondary'),
  sand: v('sand'),
  border: v('border'),

  ink: v('foreground'),
  inkSecondary: v('muted-foreground'),
  inkMuted: v('ink-muted'),

  brand: v('primary'),
  brandDark: v('brand-dark'),
  brandLight: v('brand-light'),
  brandSoft: v('brand-soft'),

  success: v('success'),
  successFill: v('success-fill'),
  successSoft: v('success-soft'),
  warning: v('warning'),
  warningFill: v('warning-fill'),
  warningSoft: v('warning-soft'),
  danger: v('destructive'),
  dangerFill: v('danger-fill'),
  dangerSoft: v('danger-soft'),
  info: v('info'),
  infoFill: v('info-fill'),
  infoSoft: v('info-soft'),
  plum: v('plum'),
  plumFill: v('plum-fill'),
  plumSoft: v('plum-soft'),
  peach: v('peach'),
  peachFill: v('peach-fill'),
  peachSoft: v('peach-soft'),
  neutral: v('muted-foreground'),
  neutralSoft: v('secondary'),

  white: '#FFFFFF',
} as const

export type ColorToken = keyof typeof C

/** CSS değişkeni okuyamayan çizimler (QR canvas) için ham renkler */
export const RAW = {
  ink: '#1C1917',
  white: '#FFFFFF',
} as const

/** Vardiya türü renkleri (Açılış / Ortacı / Kapanış …) — hücre zemini, metin ve çubuk */
const kind = (name: string) => ({
  soft: `color-mix(in oklch, var(--${name}) 14%, var(--background))`,
  text: `color-mix(in oklch, var(--${name}) 70%, var(--foreground))`,
  fill: v(name),
})
export const SHIFT_KIND_TONES = {
  opening: kind('shift-open'),
  mid: kind('shift-mid'),
  closing: kind('shift-close'),
  full: kind('info'),
  custom: { soft: v('secondary'), text: v('muted-foreground'), fill: v('ink-muted') },
} as const

/** Kişi avatarları: nötr zemin + koyu baş harf (shadcn Avatar varsayılanı); renk ada göre sabit seçilir */
export const AVATAR_TONES = [
  { bg: 'color-mix(in oklch, var(--chart-1) 14%, var(--background))', fg: 'color-mix(in oklch, var(--chart-1) 75%, var(--foreground))' },
  { bg: 'color-mix(in oklch, var(--chart-2) 14%, var(--background))', fg: 'color-mix(in oklch, var(--chart-2) 75%, var(--foreground))' },
  { bg: 'color-mix(in oklch, var(--chart-3) 12%, var(--background))', fg: 'color-mix(in oklch, var(--chart-3) 75%, var(--foreground))' },
  { bg: 'color-mix(in oklch, var(--chart-4) 18%, var(--background))', fg: 'color-mix(in oklch, var(--chart-4) 60%, var(--foreground))' },
  { bg: 'color-mix(in oklch, var(--chart-5) 12%, var(--background))', fg: 'color-mix(in oklch, var(--chart-5) 75%, var(--foreground))' },
  { bg: v('secondary'), fg: v('secondary-foreground') },
] as const

export function avatarTone(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length]
}
