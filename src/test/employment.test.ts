// @vitest-environment node
/**
 * employment.test.ts — isEmployedOn / isEffectivelyActive: son çalışma günü dahil, Europe/Istanbul sınırları;
 * ayrılış tarihi geçen çalışanın oturumu, girişi ve QR işlemi reddedilir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { isEmployedOn, isEffectivelyActive, isTerminatedAsOf, isTerminationPending } from '@/lib/employment'
import { validateLastDay } from '@/lib/employeeOffboarding'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

describe('isEmployedOn', () => {
  const e = { hire_date: '2026-03-01', termination_date: '2026-10-31' }
  it('işe giriş ve son çalışma günü dahil', () => {
    expect(isEmployedOn(e, '2026-02-28')).toBe(false)
    expect(isEmployedOn(e, '2026-03-01')).toBe(true)
    expect(isEmployedOn(e, '2026-10-31')).toBe(true)
    expect(isEmployedOn(e, '2026-11-01')).toBe(false)
  })
  it('tarih yoksa sınırsız', () => {
    expect(isEmployedOn({}, '2000-01-01')).toBe(true)
    expect(isEmployedOn({ hire_date: null, termination_date: null }, '2099-01-01')).toBe(true)
  })
})

describe('isEffectivelyActive', () => {
  it('gelecek tarihli ayrılışta son güne kadar aktif, ertesi gün pasif', () => {
    const e = { active: true, termination_date: '2026-10-31' }
    expect(isEffectivelyActive(e, '2026-10-26')).toBe(true)
    expect(isEffectivelyActive(e, '2026-10-31')).toBe(true)
    expect(isEffectivelyActive(e, '2026-11-01')).toBe(false)
    expect(isTerminationPending(e, '2026-10-31')).toBe(true)
    expect(isTerminatedAsOf(e, '2026-11-01')).toBe(true)
  })
  it('active=false her zaman pasif; ayrılışsız aktif çalışan aktif', () => {
    expect(isEffectivelyActive({ active: false, termination_date: null }, '2026-10-26')).toBe(false)
    expect(isEffectivelyActive({ active: true, termination_date: null }, '2026-10-26')).toBe(true)
  })

  describe('Europe/Istanbul gün sınırı', () => {
    afterEach(() => vi.useRealTimers())
    const e = { active: true, termination_date: '2026-10-30' }

    it('30 Ekim 23:59 (İstanbul) hâlâ son gün → aktif', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-30T20:59:00Z')) // 23:59 TRT
      expect(isEffectivelyActive(e)).toBe(true)
    })
    it('31 Ekim 00:00 (İstanbul) = 30 Ekim 21:00 UTC → pasif (UTC tarihi hâlâ 30 olsa da)', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-30T21:00:00Z')) // 00:00 TRT
      expect(isEffectivelyActive(e)).toBe(false)
    })
  })
})

describe('validateLastDay', () => {
  const today = '2026-10-26'
  it('kabul: bugün, gelecek, 30 gün öncesi sınırı', () => {
    expect(validateLastDay('2026-10-26', null, today)).toBeNull()
    expect(validateLastDay('2026-12-31', '2022-01-01', today)).toBeNull()
    expect(validateLastDay('2026-09-26', null, today)).toBeNull()
  })
  it('ret: 31 gün öncesi, işe girişten önce, geçersiz', () => {
    expect(validateLastDay('2026-09-25', null, today)).toMatch(/30 gün/)
    expect(validateLastDay('2026-10-01', '2026-10-10', today)).toMatch(/işe giriş/)
    expect(validateLastDay('abc', null, today)).toBeTruthy()
    expect(validateLastDay(undefined, null, today)).toBeTruthy()
  })
})

describe('oturum / giriş / QR ayrılıştan sonra reddedilir', () => {
  let db: FakeDb
  const EMP = '00000000-0000-4000-8000-000000000042'
  beforeEach(() => {
    db = createFakeDb({
      employees: [{
        id: EMP, full_name: 'Ayşe', email: 'a@x.com', role_id: null, active: true, store_id: 's1',
        termination_date: '2026-10-31', roles: { name: 'Kasiyer', access_level: 'employee' }, auth_user_id: null,
      }],
      stores: [{ id: 's1', name: 'M', active: true }],
    })
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  async function session() {
    vi.resetModules()
    vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
    vi.doMock('@/lib/authConfig', () => ({ IS_DEV_AUTH: true, DEV_SESSION_COOKIE: 'dev' }))
    vi.doMock('@/lib/auth/devSession', () => ({ verifyDevSession: () => ({ employeeId: EMP }) }))
    return import('@/lib/auth/session')
  }
  const reqLike = { cookies: { get: () => ({ value: 'x' }) } }

  it('son gün: oturum geçerli; ertesi gün: null (cron çalışmamış olsa bile)', async () => {
    const { getCurrentEmployee } = await session()
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    expect((await getCurrentEmployee(reqLike))?.id).toBe(EMP)
    vi.setSystemTime(new Date('2026-10-31T21:00:00Z')) // 1 Kasım 00:00 TRT
    expect(await getCurrentEmployee(reqLike)).toBeNull()
  })

  it('QR üretimi: son günden sonra 403 EMPLOYEE_INACTIVE', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
    vi.doMock('@/lib/db', () => ({ db }))
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'mgr', full_name: 'M', email: null, role_id: null, role_name: null, access_level: 'store_manager',
        active: true, home_store_id: 's1', store_id: 's1',
      }),
    }))
    const { POST } = await import('@/app/api/qr/generate/route')
    const call = () => POST(new NextRequest('http://localhost/api/qr/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employee_id: EMP, action_type: 'clock_in' }),
    }))
    vi.setSystemTime(new Date('2026-11-01T09:00:00Z'))
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('EMPLOYEE_INACTIVE')
  })
})
