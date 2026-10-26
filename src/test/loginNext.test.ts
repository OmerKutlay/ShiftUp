/**
 * loginNext.test.ts — girişten sonra ?next= hedefine dönüş (LoginForm.safeNextPath).
 * Oturumu düşmüş kullanıcı bildirime tıklayınca middleware /login?next=/leave'e yönlendirir;
 * giriş sonrası aynı sayfaya dönülmeli, ama başka origin'e asla.
 */
import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/components/auth/LoginForm'

describe('safeNextPath', () => {
  it('uygulama içi hedefe döner', () => {
    expect(safeNextPath('?next=%2Fleave')).toBe('/leave')
    expect(safeNextPath('?next=/workforce')).toBe('/workforce')
  })

  it('hedef yoksa ana sayfa', () => {
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath('?next=')).toBe('/')
  })

  it('başka origin, protokol-göreli ve ters eğik çizgili yollar reddedilir', () => {
    expect(safeNextPath('?next=https://evil.example')).toBe('/')
    expect(safeNextPath('?next=//evil.example')).toBe('/')
    expect(safeNextPath('?next=/%5Cevil.example')).toBe('/')
    // Tarayıcı sekme / satır sonunu siler: '/\t/evil' → '//evil'
    expect(safeNextPath('?next=/%09/evil.example')).toBe('/')
    expect(safeNextPath('?next=/%0A/evil.example')).toBe('/')
  })

  it('sorgu parametreleri korunur', () => {
    expect(safeNextPath('?next=%2Fworkforce%3Ftab%3Dswap')).toBe('/workforce?tab=swap')
  })

  it('/login ve /api hedefleri yok sayılır', () => {
    expect(safeNextPath('?next=/login')).toBe('/')
    expect(safeNextPath('?next=/api/auth/logout')).toBe('/')
  })
})
