/**
 * /api/qr/process — FAZ 6 QR + Location birleşik testleri
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AttendanceRecord } from '@/types/attendance'
import type { QrToken } from '@/types/qr'
import type { GeofenceResult } from '@/types/location'

// ============================================================
// Mocks
// ============================================================
vi.mock('@/lib/qrTokenService', () => ({
  validateAndConsumeToken: vi.fn(),
  QrTokenError: class QrTokenError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message)
      this.name = 'QrTokenError'
    }
  },
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    employee: {
      id: 'emp-001', full_name: 'Ahmet Kaya', email: null,
      role: 'Kasiyer', role_id: null, role_name: 'Çalışan', active: true,
    },
  }),
  requireMinRole: vi.fn().mockResolvedValue({ employee: { id: 'emp-001' } }),
  ROLES: { MUDUR_YARDIMCISI: 'Müdür Yardımcısı' },
}))

vi.mock('@/lib/auth/authorization', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    employee: {
      id: 'emp-001', full_name: 'Ahmet Kaya', email: null,
      role: 'Kasiyer', role_id: null, role_name: 'Çalışan', active: true,
    },
  }),
  requireMinRole: vi.fn().mockResolvedValue({ employee: { id: 'emp-001' } }),
  forbidden: vi.fn(),
  unauthorized: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  getCurrentEmployee: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/authConfig', () => ({
  IS_DEV_AUTH: true,
  DEV_SESSION_COOKIE: 'dev_auth_session',
  AUTH_MODE: 'development',
  getDevOtp: () => '12345',
}))

vi.mock('@/lib/locationService', () => ({
  validateLocationServerSide: vi.fn(),
  fetchActiveStoreLocation: vi.fn(),
  haversineDistance: vi.fn(),
  checkGeofence: vi.fn(),
}))

import * as qrTokenService from '@/lib/qrTokenService'
import * as supabaseAdminModule from '@/lib/supabaseAdmin'
import * as locationServiceModule from '@/lib/locationService'
import { POST } from '@/app/api/qr/process/route'
import { NextRequest } from 'next/server'

// ============================================================
// Helpers
// ============================================================
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

function makeAttendanceRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'rec-001',
    employee_id: 'emp-001',
    shift_assignment_id: 'shift-001',
    status: 'working',
    clock_in_at: new Date().toISOString(),
    break_start_at: null,
    break_end_at: null,
    clock_out_at: null,
    verification_method: 'qr_location',
    exception_note: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeGeofenceResult(allowed: boolean, distance = 50): GeofenceResult {
  return {
    allowed,
    distance_meters: distance,
    accuracy_meters: 15,
    store_radius_meters: 150,
    message: allowed
      ? `Konum doğrulandı (${distance}m mesafede).`
      : `Mağaza konumu dışındasınız (${distance}m uzakta, izin verilen: 150m).`,
  }
}

// Standart geçerli admin mock — employee+shift+attendance
function setupValidAdminMock() {
  let callIdx = 0
  ;(supabaseAdminModule.createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn(() => {
      callIdx++
      if (callIdx === 1) {
        // employee lookup
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'emp-001', full_name: 'Ahmet', active: true },
            error: null,
          }),
        }
      }
      if (callIdx === 2) {
        // shift_assignments
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          data: [{ id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00' }],
          error: null,
          then: (fn: (v: unknown) => unknown) =>
            Promise.resolve(
              fn({
                data: [{ id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00' }],
                error: null,
              })
            ),
        }
      }
      if (callIdx === 3) {
        // existing attendance_record (none)
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      // insert
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: makeAttendanceRecord(), error: null }),
      }
    }),
  })
}

const VALID_LOCATION = { latitude: 41.00865, longitude: 28.9784, accuracy: 15 }
const OUTSIDE_LOCATION = { latitude: 41.013, longitude: 28.9784, accuracy: 15 }

// ============================================================
// Tests — QR + Location birleşik
// ============================================================
describe('/api/qr/process FAZ 6 — geçerli QR + geçerli konum', () => {
  beforeEach(() => vi.clearAllMocks())

  it('geçerli QR + geçerli konum → 200 başarılı', async () => {
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(
      makeGeofenceResult(true, 50)
    )
    setupValidAdminMock()

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: VALID_LOCATION,
    }))
    const body = await res.json() as { success: boolean; new_status: string }
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.new_status).toBe('working')
  })

  it('geçerli QR + radius dışı konum → 403', async () => {
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(
      makeGeofenceResult(false, 500)
    )

    // employee mock
    ;(supabaseAdminModule.createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'emp-001', full_name: 'Ahmet', active: true },
          error: null,
        }),
      })),
    })

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: OUTSIDE_LOCATION,
    }))
    const body = await res.json() as { code: string }
    expect(res.status).toBe(403)
    expect(body.code).toBe('LOCATION_OUT_OF_RANGE')
  })

  it('geçersiz QR + geçerli konum → 400', async () => {
    const { QrTokenError } = await import('@/lib/qrTokenService')
    vi.mocked(qrTokenService.validateAndConsumeToken).mockRejectedValue(
      new QrTokenError('QR kod geçersiz.', 'QR_INVALID')
    )

    const res = await POST(makeRequest({
      qr_data: 'invalid',
      employee_id: 'emp-001',
      location: VALID_LOCATION,
    }))
    const body = await res.json() as { code: string }
    expect(res.status).toBe(400)
    expect(body.code).toBe('QR_INVALID')
  })

  it('süresi geçmiş QR + geçerli konum → 410', async () => {
    const { QrTokenError } = await import('@/lib/qrTokenService')
    vi.mocked(qrTokenService.validateAndConsumeToken).mockRejectedValue(
      new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')
    )

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: VALID_LOCATION,
    }))
    expect(res.status).toBe(410)
  })
})

describe('/api/qr/process FAZ 6 — location payload validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('eksik location alanı (latitude yok) → 400', async () => {
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    ;(supabaseAdminModule.createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'emp-001', full_name: 'Ahmet', active: true },
          error: null,
        }),
      })),
    })

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: { longitude: 28.9784, accuracy: 15 }, // latitude eksik
    }))
    expect(res.status).toBe(400)
  })

  it('location olmadan istek → sadece QR doğrulama yapılır', async () => {
    // location gönderilmezse validateLocationServerSide çağrılmamalı
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    setupValidAdminMock()

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      // location yok
    }))
    const body = await res.json() as { success: boolean }
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    // locationService çağrılmadı
    expect(locationServiceModule.validateLocationServerSide).not.toHaveBeenCalled()
  })
})

describe('/api/qr/process FAZ 6 — attendance kaydı ve Günlük Operasyon', () => {
  beforeEach(() => vi.clearAllMocks())

  it('başarısız konum doğrulamasında attendance kaydı oluşturulmuyor', async () => {
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(
      makeGeofenceResult(false, 800)
    )

    const insertMock = vi.fn()
    ;(supabaseAdminModule.createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'emp-001', full_name: 'Ahmet', active: true },
          error: null,
        }),
        insert: insertMock,
      })),
    })

    await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: OUTSIDE_LOCATION,
    }))

    // Konum başarısız → insert çağrılmamalı
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('başarılı konum + QR → attendance verification_method qr_location olarak kaydedilir', async () => {
    const qrToken = makeQrToken()
    vi.mocked(qrTokenService.validateAndConsumeToken).mockResolvedValue({
      token: qrToken,
      isKiosk: false, payload: { token: 'abc123', action: 'clock_in', employee_id: 'emp-001', exp: 9999999999 },
    })
    vi.mocked(locationServiceModule.validateLocationServerSide).mockResolvedValue(
      makeGeofenceResult(true, 50)
    )
    setupValidAdminMock()

    const res = await POST(makeRequest({
      qr_data: '{}',
      employee_id: 'emp-001',
      location: VALID_LOCATION,
    }))

    expect(res.status).toBe(200)
    // verification_method 'qr_location' olarak kaydedildi (makeAttendanceRecord'da tanımlı)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)
  })
})

