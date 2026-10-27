/**
 * /api/qr/process — entegrasyon testleri (bellek içi fake Supabase ile).
 * Route + attendanceService + state machine + yuvarlama gerçek haliyle çalışır;
 * yalnızca QR token servisi, auth ve konum servisi mock'lanır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QrToken } from '@/types/qr'
import type { GeofenceResult } from '@/types/location'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

// vi.mock fabrikaları dosyanın başına taşındığı için sabitler de hoisted
const { STORE_A, STORE_B, KIOSK_A, KIOSK_B } = vi.hoisted(() => ({
  STORE_A: '00000000-0000-4000-8000-00000000000a',
  STORE_B: '00000000-0000-4000-8000-00000000000b',
  /** Mağazaların kiosk hesapları (kodu üreten oturum) */
  KIOSK_A: '00000000-0000-4000-8000-0000000000ca',
  KIOSK_B: '00000000-0000-4000-8000-0000000000cb',
}))

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
      role_id: null, access_level: 'employee', active: true,
      home_store_id: STORE_A, store_id: STORE_A,
    },
  }),
}))

vi.mock('@/lib/locationService', () => ({ validateLocationServerSide: vi.fn() }))

import * as qrTokenService from '@/lib/qrTokenService'
import { requireAuth } from '@/lib/auth'
import * as supabaseAdminModule from '@/lib/supabaseAdmin'
import * as locationServiceModule from '@/lib/locationService'
import { POST } from '@/app/api/qr/process/route'
import { issueKioskSeed } from '@/lib/kioskQrService'
import { computeKioskQr, KIOSK_QR_STEP_MS } from '@/lib/kioskQrCode'
import { NextRequest } from 'next/server'

process.env.KIOSK_QR_SECRET = 'test-kiosk-secret'

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
    store_id: STORE_A,
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

/** Kiosk ekranının şu an gösterdiği kod (anahtarı alan: varsayılan store-A kiosk hesabı) */
async function kioskQr(opts: { storeId?: string; issuerId?: string; atMs?: number; seedAtMs?: number } = {}) {
  const seed = await issueKioskSeed(opts.storeId ?? STORE_A, opts.issuerId ?? KIOSK_A, opts.seedAtMs ?? Date.now())
  return computeKioskQr(seed, opts.atMs ?? Date.now())
}

function kioskEmployee(id: string, storeId: string, extra: Record<string, unknown> = {}) {
  return { id, full_name: 'Kiosk', active: true, store_id: storeId, termination_date: null, roles: { access_level: 'kiosk' }, ...extra }
}

/** Türkiye saatiyle belirli bir an (UTC+3) */
function setTurkeyTime(isoLocal: string) {
  vi.setSystemTime(new Date(`${isoLocal}+03:00`))
}

let db: FakeDb

function setupDb(opts: {
  shifts?: Record<string, unknown>[]
  records?: Record<string, unknown>[]
  employeeActive?: boolean
  /** Çalışanın (ve vardiyasının) mağazası; varsayılan store-A */
  storeId?: string
  /** Kiosk hesapları (varsayılan: her mağazanın aktif kiosk hesabı) */
  kioskAccounts?: Record<string, unknown>[]
} = {}) {
  const storeId = opts.storeId ?? STORE_A
  db = createFakeDb(
    {
      employees: [
        { id: 'emp-001', full_name: 'Ahmet Kaya', active: opts.employeeActive ?? true, store_id: storeId },
        ...(opts.kioskAccounts ?? [kioskEmployee(KIOSK_A, STORE_A), kioskEmployee(KIOSK_B, STORE_B)]),
      ],
      shift_assignments: (opts.shifts ?? [
        { id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      ]).map((s) => ({ store_id: storeId, ...s })),
      attendance_records: opts.records ?? [],
      notifications: [],
      qr_tokens: [],
    },
    { unique: { attendance_records: [['shift_assignment_id']] } }
  )
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

  it.each([
    ['negatif doğruluk', { latitude: 41, longitude: 28, accuracy: -1 }],
    ['sıfır doğruluk', { latitude: 41, longitude: 28, accuracy: 0 }],
    ['gerçek dışı doğruluk', { latitude: 41, longitude: 28, accuracy: 1e9 }],
  ])('elle yazılmış konum (%s) doğruluk eşiğini atlatamaz — 400', async (_label, location) => {
    const { status, body } = await post({ location })
    expect(status).toBe(400)
    expect(body.code).toBe('LOCATION_VALIDATION_FAILED')
    expect(locationServiceModule.validateLocationServerSide).not.toHaveBeenCalled()
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
    const { status, body } = await post({ qr_data: await kioskQr(), intended_action: 'break_start' })
    expect(status).toBe(200)
    expect(body.new_status).toBe('on_break')
    expect(qrTokenService.validateAndConsumeToken).not.toHaveBeenCalled()
  })
})

// ============================================================
// Kiosk QR (ekranda dakikada bir yerelde üretilen, imzalı)
// ============================================================
describe('/api/qr/process — kiosk QR (yerel imzalı, dakikalık)', () => {
  it('geçerli kod kabul edilir; veritabanına kod yazılmaz', async () => {
    const { status, body } = await post({ qr_data: await kioskQr(), intended_action: 'clock_in' })
    expect(status).toBe(200)
    expect(body.new_status).toBe('working')
    expect(db.tables.qr_tokens).toHaveLength(0)
  })

  it('bir önceki dakikanın kodu kısa süre daha kabul edilir (okutma gecikmesi)', async () => {
    const qr = await kioskQr()
    vi.setSystemTime(new Date(Date.now() + KIOSK_QR_STEP_MS))
    const { status } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(200)
  })

  it('fotoğrafı çekilmiş eski kod ~1,5 dakika sonra 410 QR_EXPIRED', async () => {
    const qr = await kioskQr()
    vi.setSystemTime(new Date(Date.now() + 2 * KIOSK_QR_STEP_MS))
    const { status, body } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(410)
    expect(body.code).toBe('QR_EXPIRED')
    expect(db.tables.attendance_records).toHaveLength(0)
  })

  it('ileri tarihli (önceden üretilmiş) kod reddedilir', async () => {
    const qr = await kioskQr({ atMs: Date.now() + 10 * KIOSK_QR_STEP_MS })
    const { status, body } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('süresi dolmuş kiosk anahtarıyla üretilen kod reddedilir', async () => {
    // Anahtar 13 saat önce alındı (ömür 12 saat); kod şimdiki pencere için üretilmiş
    const qr = await kioskQr({ seedAtMs: Date.now() - 13 * 60 * 60 * 1000 })
    const { status, body } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(410)
    expect(body.code).toBe('QR_EXPIRED')
  })

  it('imzası değiştirilmiş / uydurma kod reddedilir', async () => {
    const qr = await kioskQr()
    const forged = qr.slice(0, -2) + (qr.endsWith('AA') ? 'BB' : 'AA')
    const { status, body } = await post({ qr_data: forged, intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('başka sırla imzalanmış kod reddedilir', async () => {
    process.env.KIOSK_QR_SECRET = 'baska-sir'
    const qr = await kioskQr()
    process.env.KIOSK_QR_SECRET = 'test-kiosk-secret'
    const { status } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(400)
  })

  it('biçimi bozuk kiosk kodu reddedilir', async () => {
    const { status } = await post({ qr_data: 'SU3.kisa', intended_action: 'clock_in' })
    expect(status).toBe(400)
  })

  it('eski tek kullanımlık (SU2) kod "ekranı yenileyin" ile reddedilir', async () => {
    const { status, body } = await post({ qr_data: `SU2.${'k'.repeat(32)}`, intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
    expect(String(body.error)).toContain('yenileyip')
  })

  it('kendi oturumunda açtığı kiosk ekranının kodunu okutamaz (evden giriş engeli) — 403', async () => {
    setupDb({ kioskAccounts: [{ ...kioskEmployee('00000000-0000-4000-8000-0000000000e1', STORE_A), roles: { access_level: 'manager' } }] })
    vi.mocked(requireAuth).mockResolvedValueOnce({
      employee: {
        id: '00000000-0000-4000-8000-0000000000e1', full_name: 'Yönetici', email: null,
        role_id: null, access_level: 'manager', active: true, home_store_id: STORE_A, store_id: STORE_A,
      },
    } as never)
    const qr = await kioskQr({ issuerId: '00000000-0000-4000-8000-0000000000e1' })
    const { status, body } = await post({ qr_data: qr, intended_action: 'clock_in' })
    expect(status).toBe(403)
    expect(body.code).toBe('QR_SELF_ISSUED')
    expect(db.tables.attendance_records).toHaveLength(0)
  })

  it('kodu üreten kiosk hesabı pasifleştirildiyse kod geçersizdir', async () => {
    setupDb({ kioskAccounts: [kioskEmployee(KIOSK_A, STORE_A, { active: false })] })
    const { status, body } = await post({ qr_data: await kioskQr(), intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('kodu üreten hesap artık kiosk/yönetici değilse kod geçersizdir', async () => {
    setupDb({ kioskAccounts: [kioskEmployee(KIOSK_A, STORE_A, { roles: { access_level: 'employee' } })] })
    const { status } = await post({ qr_data: await kioskQr(), intended_action: 'clock_in' })
    expect(status).toBe(400)
  })

  it('konum reddedilirse kayıt oluşmaz', async () => {
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(geofence(false, 900))
    const { status } = await post({ qr_data: await kioskQr(), intended_action: 'clock_in' })
    expect(status).toBe(403)
    expect(db.tables.attendance_records).toHaveLength(0)
  })

  it('geçersiz kodda konum servisine hiç gidilmez', async () => {
    await post({ qr_data: 'SU3.kisa', intended_action: 'clock_in' })
    expect(locationServiceModule.validateLocationServerSide).not.toHaveBeenCalled()
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
// Çoklu mağaza izolasyonu
// ============================================================
describe('/api/qr/process — mağaza izolasyonu', () => {
  /** Oturumdaki çalışan store-B'de kayıtlı */
  function asStoreBEmployee() {
    vi.mocked(requireAuth).mockResolvedValue({
      employee: {
        id: 'emp-001', full_name: 'Ahmet Kaya', email: null,
        role_id: null, access_level: 'employee', active: true,
        home_store_id: STORE_B, store_id: STORE_B,
      },
    } as never)
  }
  afterEach(() => {
    vi.mocked(requireAuth).mockResolvedValue({
      employee: {
        id: 'emp-001', full_name: 'Ahmet Kaya', email: null,
        role_id: null, access_level: 'employee', active: true,
        home_store_id: STORE_A, store_id: STORE_A,
      },
    } as never)
  })

  it('başka mağazanın kiosk kodu reddedilir; kayıt olmaz', async () => {
    asStoreBEmployee()
    setupDb({ storeId: STORE_B })

    const { status, body } = await post({ qr_data: await kioskQr({ storeId: STORE_A, issuerId: KIOSK_A }), intended_action: 'clock_in' })

    expect(status).toBe(403)
    expect(body.code).toBe('QR_WRONG_STORE')
    expect(body.error).toBe('Bu QR kodu başka bir mağazaya ait.')
    expect(db.tables.attendance_records).toHaveLength(0)
  })

  it('kendi mağazasının kodu kabul edilir', async () => {
    asStoreBEmployee()
    setupDb({ storeId: STORE_B })
    const { status } = await post({ qr_data: await kioskQr({ storeId: STORE_B, issuerId: KIOSK_B }), intended_action: 'clock_in' })
    expect(status).toBe(200)
  })

  it('başka mağazanın kiosk hesabıyla bu mağaza için üretilmiş kod reddedilir', async () => {
    asStoreBEmployee()
    setupDb({ storeId: STORE_B })
    // store-A'nın kiosk hesabı store-B'nin kodunu üretemez (anahtar alamaz); imzalı olsa da reddedilir
    const { status, body } = await post({ qr_data: await kioskQr({ storeId: STORE_B, issuerId: KIOSK_A }), intended_action: 'clock_in' })
    expect(status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('geofence çalışanın mağazasının konumuna göre doğrulanır', async () => {
    asStoreBEmployee()
    setupDb({ storeId: STORE_B })

    await post({ qr_data: await kioskQr({ storeId: STORE_B, issuerId: KIOSK_B }), intended_action: 'clock_in' })

    expect(locationServiceModule.validateLocationServerSide).toHaveBeenCalledWith(VALID_LOCATION, STORE_B)
  })

  it('başka mağazaya bağlı üretilmiş klasik QR reddedilir', async () => {
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: makeQrToken({ store_id: STORE_B }),
      payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    const { status, body } = await post({})
    expect(status).toBe(403)
    expect(body.code).toBe('QR_WRONG_STORE')
    expect(db.tables.attendance_records).toHaveLength(0)
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
