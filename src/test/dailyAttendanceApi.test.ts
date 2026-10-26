/**
 * dailyAttendanceApi.test.ts — GET /api/attendance/daily (Günlük operasyon).
 * Tüm çalışanlara açıktır; yönetici olmayanlar yalnızca bugünü görür. Oturum ve veri katmanı mock'lanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { turkeyToday } from '@/lib/dateUtils'

const state = vi.hoisted(() => ({ employee: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/attendanceRepository', () => ({ fetchDailyShifts: vi.fn(async () => []) }))

import { GET } from '@/app/api/attendance/daily/route'
import { fetchDailyShifts } from '@/lib/attendanceRepository'

const base = { email: null, role_id: null, role_name: null, active: true, home_store_id: 'store-A', store_id: 'store-A' }
const employee = { ...base, id: 'emp-1', full_name: 'Ahmet', access_level: ACCESS.EMPLOYEE }
const manager = { ...base, id: 'mgr-1', full_name: 'Ayşe', access_level: ACCESS.MANAGER }
const kiosk = { ...base, id: 'kiosk-1', full_name: 'Kiosk', access_level: ACCESS.KIOSK }

const get = (query = '') => GET(new NextRequest(`http://localhost/api/attendance/daily${query}`))

beforeEach(() => {
  state.employee = null
})

describe('GET /api/attendance/daily', () => {
  it('oturumsuz istek reddedilir', async () => {
    expect((await get()).status).toBe(401)
  })

  it('kiosk hesabı göremez', async () => {
    state.employee = kiosk
    expect((await get()).status).toBe(403)
  })

  it('çalışan bugünün operasyonunu görür', async () => {
    state.employee = employee
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ date: turkeyToday(), entries: [] })
    expect((await get(`?date=${turkeyToday()}`)).status).toBe(200)
  })

  it('liste yalnızca oturumun aktif mağazası için istenir', async () => {
    state.employee = { ...manager, home_store_id: 'store-A', store_id: 'store-B' } // admin başka mağazaya geçmiş gibi
    await get()
    expect(fetchDailyShifts).toHaveBeenLastCalledWith(turkeyToday(), 'store-B')
  })

  it('çalışan başka günü göremez, yönetici görebilir', async () => {
    state.employee = employee
    expect((await get('?date=2026-01-05')).status).toBe(403)
    state.employee = manager
    expect((await get('?date=2026-01-05')).status).toBe(200)
  })
})
