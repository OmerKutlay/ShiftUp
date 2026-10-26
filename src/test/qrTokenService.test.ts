import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QrToken } from '@/types/qr'

// ============================================================
// Mock supabaseAdmin — vi.hoisted ile hoist sorunu çözülür
// ============================================================
const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: mockCreateAdminClient,
}))

// Node crypto mock
vi.mock('crypto', () => {
  const randomBytes = vi.fn((_size: number) => Buffer.alloc(32, 'a'))
  return { default: { randomBytes }, randomBytes }
})

import {
  generateQrToken,
  validateAndConsumeToken,
  QrTokenError,
} from '@/lib/qrTokenService'
import { createFakeDb } from './helpers/fakeSupabase'

// ============================================================
// Helpers
// ============================================================
function makeTokenRecord(overrides: Partial<QrToken> = {}): QrToken {
  const now = new Date()
  const expires = new Date(now.getTime() + 60_000)
  return {
    id: 'tok-001',
    token: 'a'.repeat(64),
    action_type: 'clock_in',
    employee_id: 'emp-001',
    store_id: 'store-A',
    expires_at: expires.toISOString(),
    used_at: null,
    created_at: now.toISOString(),
    ...overrides,
  }
}

function makeQrData(overrides: Partial<{
  token: string
  action: string
  employee_id: string
  exp: number
}> = {}): string {
  const exp = Math.floor((Date.now() + 60_000) / 1000)
  return JSON.stringify({
    token: 'a'.repeat(64),
    action: 'clock_in',
    employee_id: 'emp-001',
    exp,
    ...overrides,
  })
}

function mockAdminFrom(responses: Array<Record<string, unknown>>) {
  let idx = 0
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => {
      const r = responses[Math.min(idx, responses.length - 1)]
      idx++
      return r
    }),
  })
}

// ============================================================
// generateQrToken
// ============================================================
describe('qrTokenService — generateQrToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('QR token başarıyla oluşturulur', async () => {
    const record = makeTokenRecord()
    mockAdminFrom([{
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: record, error: null }),
    }])

    const result = await generateQrToken('emp-001', 'clock_in', 60)

    expect(result.token).toBe(record.token)
    expect(result.action_type).toBe('clock_in')
    expect(result.employee_id).toBe('emp-001')
    expect(result.qr_data).toBeTruthy()
    const parsed = JSON.parse(result.qr_data) as { token: string; action: string }
    expect(parsed.token).toBe(record.token)
    expect(parsed.action).toBe('clock_in')
  })

  it('token mağaza kimliğiyle kaydedilir', async () => {
    const insert = vi.fn().mockReturnThis()
    mockAdminFrom([{
      insert,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: makeTokenRecord(), error: null }),
    }])

    await generateQrToken('emp-001', 'clock_in', 60, 'store-A')

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ employee_id: 'emp-001', store_id: 'store-A' }))
  })

  it('DB hatası QrTokenError fırlatır', async () => {
    mockAdminFrom([{
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'unique violation' } }),
    }])

    await expect(generateQrToken('emp-001', 'clock_in')).rejects.toThrow('QR token oluşturulamadı')
  })
})

// ============================================================
// validateAndConsumeToken
// ============================================================
describe('qrTokenService — validateAndConsumeToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('geçerli QR token kabul ediliyor', async () => {
    const record = makeTokenRecord()
    const qrData = makeQrData()
    const db = createFakeDb({ qr_tokens: [record] })
    mockCreateAdminClient.mockReturnValue(db)

    const result = await validateAndConsumeToken(qrData)
    expect(result.token.token).toBe(record.token)
    expect(result.payload.action).toBe('clock_in')
    expect(db.tables.qr_tokens[0].used_at).toBeTruthy()
  })

  it('eşzamanlı iki okutmadan yalnızca biri token\'ı tüketir', async () => {
    const db = createFakeDb({ qr_tokens: [makeTokenRecord()] })
    mockCreateAdminClient.mockReturnValue(db)

    const results = await Promise.allSettled([
      validateAndConsumeToken(makeQrData()),
      validateAndConsumeToken(makeQrData()),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(QrTokenError)
  })

  it('süresi geçmiş QR reddediliyor (client-side exp check)', async () => {
    const expiredQrData = makeQrData({
      exp: Math.floor(Date.now() / 1000) - 10,
    })

    await expect(validateAndConsumeToken(expiredQrData)).rejects.toThrow(QrTokenError)
    await expect(validateAndConsumeToken(expiredQrData)).rejects.toThrow('QR kodun süresi dolmuş.')
  })

  it('geçersiz JSON reddediliyor', async () => {
    await expect(validateAndConsumeToken('not-json')).rejects.toThrow(QrTokenError)
    await expect(validateAndConsumeToken('not-json')).rejects.toThrow('QR kod geçersiz format.')
  })

  it('eksik alan içeren QR reddediliyor', async () => {
    const incomplete = JSON.stringify({ token: 'abc', exp: 9999999999 })
    await expect(validateAndConsumeToken(incomplete)).rejects.toThrow('eksik alan')
  })

  it("DB'de bulunamayan token reddediliyor", async () => {
    const qrData = makeQrData()

    mockAdminFrom([{
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }])

    await expect(validateAndConsumeToken(qrData)).rejects.toThrow('QR kod bulunamadı')
  })

  it('kullanılmış token reddediliyor', async () => {
    const usedRecord = makeTokenRecord({ used_at: new Date().toISOString() })
    const qrData = makeQrData()

    mockAdminFrom([{
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: usedRecord, error: null }),
    }])

    await expect(validateAndConsumeToken(qrData)).rejects.toThrow(QrTokenError)
    await expect(validateAndConsumeToken(qrData)).rejects.toThrow('daha önce kullanılmış')
  })

  it('süresi dolmuş DB kaydı reddediliyor (server-side check)', async () => {
    const expiredRecord = makeTokenRecord({
      expires_at: new Date(Date.now() - 5000).toISOString(),
    })
    // Client tarafı hâlâ geçerli gibi görünen token
    const qrData = makeQrData({
      exp: Math.floor((Date.now() + 5000) / 1000),
    })

    mockAdminFrom([{
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: expiredRecord, error: null }),
    }])

    await expect(validateAndConsumeToken(qrData)).rejects.toThrow('QR kodun süresi dolmuş.')
  })

  it('yanlış action_type reddediliyor', async () => {
    // DB'de clock_out, payload'da clock_in
    const record = makeTokenRecord({ action_type: 'clock_out' })
    const qrData = makeQrData({ action: 'clock_in' })

    mockAdminFrom([{
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: record, error: null }),
    }])

    await expect(validateAndConsumeToken(qrData)).rejects.toThrow('QR aksiyon tipi uyumsuz.')
  })

  it('kiosk kodu (employee_id yok) klasik yoldan tüketilemez', async () => {
    const db = createFakeDb({ qr_tokens: [makeTokenRecord({ employee_id: null, action_type: null })] })
    mockCreateAdminClient.mockReturnValue(db)

    await expect(validateAndConsumeToken(makeQrData())).rejects.toThrow('QR kod bulunamadı')
    expect(db.tables.qr_tokens[0].used_at).toBeNull()
  })

  it('başkasının kodu okutulduğunda token tüketilmez', async () => {
    const db = createFakeDb({ qr_tokens: [makeTokenRecord()] })
    mockCreateAdminClient.mockReturnValue(db)

    await expect(
      validateAndConsumeToken(makeQrData(), { employeeId: 'emp-999', storeId: 'store-A' })
    ).rejects.toMatchObject({ code: 'QR_NOT_OWNER' })
    expect(db.tables.qr_tokens[0].used_at).toBeNull()
  })

  it('başka mağazada okutulan kod tüketilmez', async () => {
    const db = createFakeDb({ qr_tokens: [makeTokenRecord()] })
    mockCreateAdminClient.mockReturnValue(db)

    await expect(
      validateAndConsumeToken(makeQrData(), { employeeId: 'emp-001', storeId: 'store-B' })
    ).rejects.toMatchObject({ code: 'QR_WRONG_STORE' })
    expect(db.tables.qr_tokens[0].used_at).toBeNull()
  })
})
