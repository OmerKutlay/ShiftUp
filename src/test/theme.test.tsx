/**
 * Tema: kayıtlı tercih yoksa sistem ayarı izlenir; anahtar açık/koyu seçer, "Sistem" geri döner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ThemeSwitch } from '@/components/common/ThemeSwitch'
import { setThemePreference } from '@/hooks/useTheme'
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, resolveTheme } from '@/lib/theme'

let systemDark = false
let changeListeners: (() => void)[] = []

beforeEach(() => {
  systemDark = false
  changeListeners = []
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return systemDark
        },
        media: query,
        addEventListener: (_: string, l: () => void) => changeListeners.push(l),
        removeEventListener: (_: string, l: () => void) => {
          changeListeners = changeListeners.filter((x) => x !== l)
        },
      }) as unknown as MediaQueryList
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const isDark = () => document.documentElement.classList.contains('dark')

describe('resolveTheme', () => {
  it('sistem tercihinde cihaz ayarını izler, açık seçimde onu geçersiz kılar', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('THEME_INIT_SCRIPT', () => {
  it('kayıt yokken sistem koyuysa koyu başlatır', () => {
    systemDark = true
    new Function(THEME_INIT_SCRIPT)()
    expect(isDark()).toBe(true)
  })

  it('kayıtlı açık tercih sistem ayarından önce gelir', () => {
    systemDark = true
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    new Function(THEME_INIT_SCRIPT)()
    expect(isDark()).toBe(false)
  })
})

describe('ThemeSwitch', () => {
  it('anahtar koyu temayı açar, kaydeder ve kapatır', async () => {
    const user = userEvent.setup()
    render(<ThemeSwitch />)
    const sw = screen.getByRole('switch', { name: 'Koyu tema' })
    expect(sw).not.toBeChecked()

    await user.click(sw)
    expect(sw).toBeChecked()
    expect(isDark()).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await user.click(sw)
    expect(isDark()).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('sistem tercihinde cihaz ayarı değişince tema anında güncellenir', () => {
    render(<ThemeSwitch />)
    act(() => setThemePreference('system'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()

    systemDark = true
    act(() => changeListeners.forEach((l) => l()))
    expect(isDark()).toBe(true)
    expect(screen.getByRole('switch', { name: 'Koyu tema' })).toBeChecked()
  })
})
