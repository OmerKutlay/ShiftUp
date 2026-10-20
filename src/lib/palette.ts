/**
 * palette — satır içi `style` gereken yerler için tema renkleri (vardiya türü, grafik, avatar).
 *
 * Değerler globals.css'teki CSS değişkenlerine başvurur; tek kaynak globals.css'tir.
 * Sınıf yazılabilen her yerde Tailwind token'ı (`text-success`, `bg-success/10`) tercih edilir.
 * Canvas gibi CSS değişkeni okuyamayan yerler RAW değerlerini kullanır.
 */

const v = (name: string) => `var(--${name})`
/** Token'ın zemine karışmış açık tonu (rozet / hücre zemini) */
const soft = (name: string, pct: number) => `color-mix(in oklch, var(--${name}) ${pct}%, var(--background))`
/** Rengin yarı saydam hali (CSS color-mix) */
export function tint(color: string, a: number): string {
  return `color-mix(in oklch, ${color} ${Math.round(a * 100)}%, transparent)`
}

export const C = {
  canvas: v('muted'),
  surface: v('card'),
  surfaceAlt: v('muted'),
  surfaceMuted: v('secondary'),
  sand: 'oklch(0.869 0.005 56.366)',
  border: v('border'),

  ink: v('foreground'),
  inkSecondary: v('muted-foreground'),
  inkMuted: 'oklch(0.709 0.01 56.259)',

  brand: v('primary'),
  brandDark: 'oklch(0.508 0.135 40.2)',
  brandLight: 'oklch(0.697 0.134 47.3)',
  brandSoft: soft('primary', 10),

  success: v('success'),
  successFill: soft('success', 55),
  successSoft: soft('success', 10),
  warning: v('warning'),
  warningFill: soft('warning', 70),
  warningSoft: soft('warning', 12),
  danger: v('destructive'),
  dangerFill: v('destructive'),
  dangerSoft: soft('destructive', 10),
  info: v('info'),
  infoFill: soft('info', 70),
  infoSoft: soft('info', 10),
  plum: v('plum'),
  plumFill: soft('plum', 60),
  plumSoft: soft('plum', 10),
  peach: v('shift-mid'),
  peachFill: soft('shift-mid', 70),
  peachSoft: soft('shift-mid', 12),
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
  custom: { soft: v('secondary'), text: v('muted-foreground'), fill: 'oklch(0.709 0.01 56.259)' },
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
