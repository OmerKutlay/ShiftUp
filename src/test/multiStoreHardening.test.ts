/**
 * multiStoreHardening.test.ts — çoklu mağaza denetiminde bulunan kenar durumları:
 *   - başka sekmede mağaza değişmişken gelen yazma isteği uygulanmaz (409 STORE_CHANGED)
 *   - mesai düzeltmesi başka mağazadaki vardiyanın devam kaydını değiştirmez
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { STORE_HEADER } from '@/lib/storeHeader'
import { createFakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'

const admin = {
  id: 'adm-001', full_name: 'Admin', email: null, role_id: null, role_name: null,
  access_level: ACCESS.ADMIN, active: true, home_store_id: STORE_A, store_id: STORE_B,
}

describe('requireAuth — sekmenin mağazası (X-Store-Id)', () => {
  beforeEach(() => vi.resetModules())

  async function call(header: string | null) {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(admin) }))
    const { requireAuth } = await import('@/lib/auth/authorization')
    const req = new NextRequest('http://localhost/api/open-shifts', {
      method: 'POST',
      headers: header ? { [STORE_HEADER]: header } : undefined,
    })
    return requireAuth(req)
  }

  it('başlık aktif mağazayla aynıysa geçer', async () => {
    expect('employee' in (await call(STORE_B))).toBe(true)
  })

  it('başlık yoksa geçer (okuma / eski istemci)', async () => {
    expect('employee' in (await call(null))).toBe(true)
  })

  it('sekme eski mağazayı gösteriyorsa 409 STORE_CHANGED', async () => {
    const result = await call(STORE_A)
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(409)
      expect(((await result.response.json()) as { code: string }).code).toBe('STORE_CHANGED')
    }
  })
})

describe('timeCorrectionService — başka mağazadaki vardiya', () => {
  const EMP = '00000000-0000-4000-8000-000000000001'
  const DATE = '2026-10-20'

  function db() {
    return createFakeDb({
      shift_assignments: [
        { id: 'sh-a', employee_id: EMP, store_id: STORE_A, work_date: DATE, start_time: '09:00', end_time: '18:00' },
      ],
      attendance_records: [],
      employees: [{ id: EMP, employment_type: 'full_time', store_id: STORE_B }],
    })
  }

  it('ihlal kontrolü başka mağazadaki vardiyayı bildirir', async () => {
    const { checkCorrectionViolations } = await import('@/lib/timeCorrectionService')
    const result = await checkCorrectionViolations({
      admin: db() as never, employeeId: EMP, storeId: STORE_B, date: DATE, startTime: '09:00', endTime: '18:00',
    })
    expect(result.otherStoreShift).toBe(true)
  })

  it('uygulama reddedilir; eski mağazanın devam kaydı oluşturulmaz', async () => {
    const fake = db()
    const { applyTimeCorrection, CrossStoreShiftError } = await import('@/lib/timeCorrectionService')
    await expect(
      applyTimeCorrection({
        admin: fake as never, employeeId: EMP, storeId: STORE_B, date: DATE, startTime: '09:00', endTime: '18:00',
      })
    ).rejects.toBeInstanceOf(CrossStoreShiftError)
    expect(fake.tables.attendance_records).toHaveLength(0)
  })

  it('aynı mağazadaki vardiya düzeltilir', async () => {
    const fake = db()
    const { checkCorrectionViolations } = await import('@/lib/timeCorrectionService')
    const result = await checkCorrectionViolations({
      admin: fake as never, employeeId: EMP, storeId: STORE_A, date: DATE, startTime: '09:00', endTime: '18:00',
    })
    expect(result.otherStoreShift).toBe(false)
  })
})
