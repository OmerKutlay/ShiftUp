/**
 * theme — açık / koyu tema tercihi.
 *
 * Tercih `localStorage`'da tutulur: 'light' | 'dark' | 'system' (yoksa 'system'). 'system'de
 * tema cihazın `prefers-color-scheme` ayarını izler ve ayar değişince anında güncellenir.
 * Tema `<html>`'e eklenen `.dark` sınıfıyla uygulanır (globals.css'teki koyu palet).
 *
 * İlk boyamada yanlış temanın görünmemesi için `THEME_INIT_SCRIPT` root layout'ta hidrasyondan
 * önce çalışır; sonrasında `useTheme` (hooks/useTheme.ts) aynı kuralı izler ve değişiklikleri uygular.
 * Bu dosya sunucuda da içe aktarılır (layout): istemci API'si içermez.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'shiftup-theme'
export const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Üst bar zemini (--background) — tarayıcı / durum çubuğu rengi (theme-color) */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#FFFFFF',
  dark: '#0C0A09',
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

/** Hidrasyondan önce çalışır: kaydedilen tercih + sistem ayarı → `.dark` sınıfı */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=p==='dark'||(p!=='light'&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})()`
