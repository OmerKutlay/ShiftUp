/**
 * /api/qr/process — entegrasyon testleri (bellek içi fake Supabase ile).
 * Route + attendanceService + state machine + yuvarlama gerçek haliyle çalışır;
 * yalnızca QR token servisi, auth ve konum servisi mock'lanır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QrToken } from '@/types/qr'
import type { GeofenceResult } from '@/types/location'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

vi.mock('@/lib/qrTokenService', () => ({
  validateAndConsumeToken: vi.fn(),
  QrTokenError: class QrTokenError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message)
      this.name = 'QrTokenError'
    }
  },
}))

vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    employee: {
      id: 'emp-001', full_name: 'Ahmet Kaya', email: null,
      role: 'Kasiyer', role_id: null, role_name: 'Çalışan', active: true,
    },
  }),
}))

vi.mock('@/lib/locationService', () => ({ validateLocationServerSide: vi.fn() }))

import * as qrTokenService from '@/lib/qrTokenService'
import * as supabaseAdminModule from '@/lib/supabaseAdmin'
import * as locationServiceModule from '@/lib/locationService'
import { POST } from '@/app/api/qr/process/route'
import { NextRequest } from 'next/server'

// ============================================================
// Helpers
// ============================================================
const VALID_LOCATION = { latitude: 41.00865, longitude: 28.9784, accuracy: 15 }

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/qr/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeQrToken(overrides: Partial<QrToken> = {}): QrToken {
  return {
    id: 'tok-001',
    token: 'abc123',
    action_type: 'clock_in',
    employee_id: 'emp-001',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    used_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function geofence(allowed: boolean, distance = 50): GeofenceResult {
  return {
    allowed,
    distance_meters: distance,
    accuracy_meters: 15,
    store_radius_meters: 150,
    message: allowed ? 'Konum doğrulandı.' : `Mağaza konumu dışındasınız (${distance}m uzakta).`,
  }
}

function mockToken(action: NonNullable<QrToken['action_type']> = 'clock_in') {
  vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
    token: makeQrToken({ action_type: action }),
    payload: { token: 'abc123', action, employee_id: 'emp-001', exp: 9999999999 },
  })
}

/** Kiosk ekranında gösterilen aktif tek kullanımlık kod */
const KIOSK_TOKEN = 'k'.repeat(32)
const KIOSK_QR = `SU2.${KIOSK_TOKEN}`

const httpSend = vi.fn()
const channel = vi.fn(() => ({ httpSend }))

/** Aktif (kullanılmamış) kiosk kodları */
function activeKioskTokens() {
  return db.tables.qr_tokens.filter((t) => t.employee_id == null && t.used_at == null)
}

/** Türkiye saatiyle belirli bir an (UTC+3) */
function setTurkeyTime(isoLocal: string) {
  vi.setSystemTime(new Date(`${isoLocal}+03:00`))
}

let db: FakeDb

function setupDb(opts: { shifts?: Record<string, unknown>[]; records?: Record<string, unknown>[]; employeeActive?: boolean } = {}) {
  db = createFakeDb(
    {
      employees: [{ id: 'emp-001', full_name: 'Ahmet Kaya', active: opts.employeeActive ?? true }],
      shift_assignments: opts.shifts ?? [
        { id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      ],
      attendance_records: opts.records ?? [],
      notifications: [],
      qr_tokens: [{
        id: 'kq-1', token: KIOSK_TOKEN, employee_id: null, action_type: null, used_at: null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }],
    },
    { unique: { attendance_records: [['shift_assignment_id']] } }
  )
  // Realtime Broadcast (REST) — sunucu yeni kodu "kiosk-qr" kanalına yayınlar
  httpSend.mockResolvedValue({ success: true })
  Object.assign(db, {
    channel,
    removeChannel: vi.fn().mockResolvedValue('ok'),
  })
  vi.mocked(supabaseAdminModule.createAdminClient).mockReturnValue(db as never)
}

async function post(body: Record<string, unknown>) {
  const res = await POST(makeRequest({ qr_data: '{}', location: VALID_LOCATION, ...body }))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  setTurkeyTime('2026-09-28T09:05:00')
  vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(geofence(true))
  setupDb()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// Girdi doğrulama
// ============================================================
describe('/api/qr/process — input validation', () => {
  it('qr_data eksikse 400 döner', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('konum gönderilmezse 400 LOCATION_REQUIRED (geofence atlanamaz)', async () => {
    mockToken('clock_in')
    const res = await POST(makeRequest({ qr_data: '{}' }))
    const body = (await res.json()) as { code: string }
    expect(res.status).toBe(400)
    expect(body.code).toBe('LOCATION_REQUIRED')
    expect(qrTokenService.validateAndConsumeToken).not.toHaveBeenCalled()
  })

  it('hatalı konum verisi 400 döner', async () => {
    const { status, body } = await post({ location: { latitude: 'x', longitude: 28, accuracy: 10 } })
    expect(status).toBe(400)
    expect(body.code).toBe('LOCATION_VALIDATION_FAILED')
  })

  it('mağaza dışı konum 403 döner ve QR tüketilmez', async () => {
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(geofence(false, 520))
    const { status, body } = await post({})
    expect(status).toBe(403)
    expect(body.code).toBe('LOCATION_OUT_OF_RANGE')
    expect(qrTokenService.validateAndConsumeToken).not.toHaveBeenCalled()
  })
})

// ============================================================
// Token doğrulama
// ============================================================
describe('/api/qr/process — QR token doğrulama', () => {
  it('geçersiz QR token 400 döner', async () => {
    const { QrTokenError } = await import('@/lib/qrTokenService')
    vi.mocked(qrTokenService.validateAndConsumeToken).mockRejectedValue(new QrTokenError('QR kod geçersiz format.', 'QR_INVALID'))
    const { status, body } = await post({})
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('süresi geçmiş QR 410 döner', async () => {
    const { QrTokenError } = await import('@/lib/qrTokenService')
    vi.mocked(qrTokenService.validateAndConsumeToken).mockRejectedValue(new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED'))
    const { status, body } = await post({})
    expect(status).toBe(410)
    expect(body.code).toBe('QR_EXPIRED')
  })

  it('başkasına ait klasik QR 403 döner', async () => {
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: makeQrToken({ employee_id: 'emp-999' }),
      payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-999', exp: 9999999999 },
    })
    const { status } = await post({})
    expect(status).toBe(403)
  })
})

// ============================================================
// Çalışan & vardiya
// ============================================================
describe('/api/qr/process — çalışan ve vardiya', () => {
  it('pasif çalışan 403 döner', async () => {
    setupDb({ employeeActive: false })
    mockToken('clock_in')
    const { status, body } = await post({})
    expect(status).toBe(403)
    expect(body.code).toBe('EMPLOYEE_INACTIVE')
  })

  it('çalışan kaydı yoksa 404 döner', async () => {
    setupDb()
    db.tables.employees = []
    mockToken('clock_in')
    const { status } = await post({})
    expect(status).toBe(404)
  })

  it('vardiyası olmayan çalışan 404 NO_SHIFT_TODAY döner', async () => {
    setupDb({ shifts: [] })
    mockToken('clock_in')
    const { status, body } = await post({})
    expect(status).toBe(404)
    expect(body.code).toBe('NO_SHIFT_TODAY')
  })

  it('izinli işaretli vardiyada işlem yapılamaz', async () => {
    setupDb({
      shifts: [{ id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00', is_on_leave: true }],
    })
    mockToken('clock_in')
    const { status } = await post({})
    expect(status).toBe(404)
  })
})

// ============================================================
// Devam akışı
// ============================================================
describe('/api/qr/process — attendance akışı', () => {
  it('QR + konum ile giriş: kayıt oluşur, doğrulama yöntemi ve mesafe yazılır', async () => {
    mockToken('clock_in')
    const { status, body } = await post({})
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.new_status).toBe('working')

    const rec = db.tables.attendance_records[0]
    expect(rec.verification_method).toBe('qr_location')
    expect(rec.location_distance_m).toBe(50)
    expect(rec.location_accuracy_m).toBe(15)
  })

  it('giriş yapmadan mola başlatılamaz — 422', async () => {
    mockToken('break_start')
    const { status, body } = await post({})
    expect(status).toBe(422)
    expect(body.code).toBe('ATTENDANCE_RULE_VIOLATION')
  })

  it('giriş yapmadan çıkış yapılamaz — 422', async () => {
    mockToken('clock_out')
    const { status } = await post({})
    expect(status).toBe(422)
  })

  it('molada iken tekrar mola başlatılamaz — 422', async () => {
    setupDb({
      records: [{ id: 'rec-001', employee_id: 'emp-001', shift_assignment_id: 'shift-001', status: 'on_break',
        clock_in_at: '2026-09-28T06:00:00Z', break_start_at: '2026-09-28T08:00:00Z', break_end_at: null, completed_break_minutes: 0 }],
    })
    mockToken('break_start')
    const { status } = await post({})
    expect(status).toBe(422)
  })

  it('çıkış yapıldıktan sonra tekrar giriş yapılamaz (ikinci kayıt oluşmaz)', async () => {
    setTurkeyTime('2026-09-28T19:00:00')
    setupDb({
      records: [{ id: 'rec-001', employee_id: 'emp-001', shift_assignment_id: 'shift-001', status: 'clocked_out',
        clock_in_at: '2026-09-28T06:00:00Z', clock_out_at: '2026-09-28T15:00:00Z', completed_break_minutes: 0 }],
    })
    mockToken('clock_in')
    const { status } = await post({})
    expect(status).toBe(422)
    expect(db.tables.attendance_records).toHaveLength(1)
  })

  it('klasik QR\'da intended_action token aksiyonunu ezemez', async () => {
    mockToken('clock_in')
    const { status, body } = await post({ intended_action: 'clock_out' })
    expect(status).toBe(200)
    expect(body.action_type).toBe('clock_in')
  })

  it('kiosk QR\'da intended_action kullanılır', async () => {
    setupDb({
      records: [{ id: 'rec-001', employee_id: 'emp-001', shift_assignment_id: 'shift-001', status: 'working',
        clock_in_at: '2026-09-28T06:00:00Z', completed_break_minutes: 0 }],
    })
    const { status, body } = await post({ qr_data: KIOSK_QR, intended_action: 'break_start' })
    expect(status).toBe(200)
    expect(body.new_status).toBe('on_break')
    expect(qrTokenService.validateAndConsumeToken).not.toHaveBeenCalled()
  })
})

// ============================================================
// Kiosk QR (yerelde imzalanan, TOTP benzeri)
// ============================================================
describe('/api/qr/process — kiosk QR (tek kullanımlık + Broadcast)', () => {
  it('okutma onaylanınca kod tüketilir, yeni kod üretilip kanala yayınlanır', async () => {
    const { status, body } = await post({ qr_data: KIOSK_QR, intended_action: 'clock_in' })
    expect(status).toBe(200)
    expect(body.new_status).toBe('working')

    expect(db.tables.qr_tokens.find((t) => t.token === KIOSK_TOKEN)?.used_at).toBeTruthy()
    const active = activeKioskTokens()
    expect(active).toHaveLength(1)
    expect(active[0].token).not.toBe(KIOSK_TOKEN)

    expect(channel).toHaveBeenCalledWith('kiosk-qr', { config: { private: true } })
    expect(httpSend).toHaveBeenCalledWith('qr', { qr_data: `SU2.${active[0].token}` })
  })

  it('aynı anda okutanlardan yalnızca ilki kabul edilir, diğeri 409 alır', async () => {
    setupDb({
      shifts: [
        { id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      ],
    })
    const results = await Promise.all([
      post({ qr_data: KIOSK_QR, intended_action: 'clock_in' }),
      post({ qr_data: KIOSK_QR, intended_action: 'clock_in' }),
    ])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 409])
    expect(results.find((r) => r.status === 409)?.body.code).toBe('QR_USED')
    expect(db.tables.attendance_records).toHaveLength(1)
    expect(activeKioskTokens()).toHaveLength(1)
    expect(httpSend).toHaveBeenCalledTimes(1)
  })

  it('kullanılmış kod tekrar okutulamaz', async () => {
    expect((await post({ qr_data: KIOSK_QR, intended_action: 'clock_in' })).status).toBe(200)
    const again = await post({ qr_data: KIOSK_QR, intended_action: 'break_start' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('QR_USED')
  })

  it('bilinmeyen / uydurma kiosk kodu reddedilir', async () => {
    const { status, body } = await post({ qr_data: `SU2.${'x'.repeat(32)}`, intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
    expect(httpSend).not.toHaveBeenCalled()
  })

  it('biçimi bozuk kiosk kodu reddedilir', async () => {
    const { status } = await post({ qr_data: 'SU2.kisa', intended_action: 'clock_in' })
    expect(status).toBe(400)
  })

  it('yayın hatası okutmayı bozmaz', async () => {
    httpSend.mockRejectedValue(new Error('realtime down'))
    const { status } = await post({ qr_data: KIOSK_QR, intended_action: 'clock_in' })
    expect(status).toBe(200)
    expect(activeKioskTokens()).toHaveLength(1)
  })

  it('konum reddedilirse kod tüketilmez ve değişmez', async () => {
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(geofence(false, 900))
    const { status } = await post({ qr_data: KIOSK_QR, intended_action: 'clock_in' })
    expect(status).toBe(403)
    expect(activeKioskTokens()[0].token).toBe(KIOSK_TOKEN)
    expect(httpSend).not.toHaveBeenCalled()
  })

  it('vardiyası olmayan çalışanın okutması kodu tüketmez', async () => {
    setupDb({ shifts: [] })
    const { status } = await post({ qr_data: KIOSK_QR, intended_action: 'clock_in' })
    expect(status).toBe(404)
    expect(activeKioskTokens()[0].token).toBe(KIOSK_TOKEN)
  })

  it('geç girişte ileri yuvarlanan saatten önce mola başlatılamaz', async () => {
    // 09:00 vardiya, 09:50'de okutuldu → 10:00 olarak işlendi; 09:55'te mola denemesi
    setTurkeyTime('2026-09-28T09:50:00')
    mockToken('clock_in')
    await post({})
    expect(db.tables.attendance_records[0].clock_in_at).toBe('2026-09-28T07:00:00.000Z')

    setTurkeyTime('2026-09-28T09:55:00')
    mockToken('break_start')
    const { status, body } = await post({})
    expect(status).toBe(422)
    expect(String(body.error)).toContain('önce başlatılamaz')
  })
})

// ============================================================
// Saat dilimi & gece vardiyası
// ============================================================
describe('/api/qr/process — Türkiye saati ve gece vardiyası', () => {
  it('Türkiye saatiyle 01:30\'da (UTC dün) bugünün vardiyası bulunur', async () => {
    setTurkeyTime('2026-09-29T01:30:00')
    setupDb({
      shifts: [{ id: 'shift-early', employee_id: 'emp-001', work_date: '2026-09-29', start_time: '01:00', end_time: '09:00', is_on_leave: false }],
    })
    mockToken('clock_in')
    const { status } = await post({})
    expect(status).toBe(200)
    expect(db.tables.attendance_records[0].shift_assignment_id).toBe('shift-early')
  })

  it('gece vardiyasında gece yarısından sonra çıkış yapılabilir', async () => {
    setTurkeyTime('2026-09-29T06:02:00')
    setupDb({
      shifts: [{ id: 'shift-night', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '22:00', end_time: '06:00', is_on_leave: false }],
      records: [{ id: 'rec-n', employee_id: 'emp-001', shift_assignment_id: 'shift-night', status: 'working',
        clock_in_at: '2026-09-28T19:00:00Z', completed_break_minutes: 0 }],
    })
    mockToken('clock_out')
    const { status, body } = await post({})
    expect(status).toBe(200)
    expect(body.new_status).toBe('clocked_out')
  })
})
