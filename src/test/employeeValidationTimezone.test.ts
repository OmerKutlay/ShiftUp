import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateEmployeeInput } from '@/lib/employeeValidation'
import { turkeyToday } from '@/lib/dateUtils'

// 26 Ekim 22:30 UTC = 27 Ekim 01:30 Türkiye
describe('employeeValidation — Türkiye tarihi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T22:30:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('turkeyToday gece yarısından sonra Türkiye gününü verir', () => {
    expect(turkeyToday()).toBe('2026-10-27')
  })

  it('doğum tarihi "bugün" (Türkiye) ise reddedilir', async () => {
    const r = await validateEmployeeInput({ birth_date: '2026-10-27' }, null, true)
    expect(r).toEqual({ error: 'Doğum tarihi geçmişte olmalıdır.' })
  })

  it('doğum tarihi dün (Türkiye) ise kabul edilir', async () => {
    const r = await validateEmployeeInput({ birth_date: '2026-10-26' }, null, true)
    expect(r).toEqual({ payload: { birth_date: '2026-10-26' } })
  })
})
