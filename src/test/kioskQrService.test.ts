/**
 * kioskQrService — mağaza başına kiosk QR'ı (bellek içi fake Supabase ile).
 * Aktif kod arama, üretim, tüketim ve yayın mağaza kapsamındadır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import {
  getOrCreateActiveKioskQr,
  consumeKioskQr,
  rotateAndBroadcastKioskQr,
  kioskQrTopic,
} from '@/lib/kioskQrService'
import { QrTokenError } from '@/lib/qrTokenService'

const STORE_A = 'store-A'
const STORE_B = 'store-B'
const TOKEN_A = 'a'.repeat(32)
const TOKEN_B = 'b'.repeat(32)
const FUTURE = '2999-01-01T00:00:00Z'

const httpSend = vi.fn()
const channel = vi.fn(() => ({ httpSend }))

let db: FakeDb
const admin = () => db as unknown as SupabaseClient

function kioskRow(token: string, storeId: string, extra: Record<string, unknown> = {}) {
  return { id: `kq-${token[0]}`, token, store_id: storeId, employee_id: null, action_type: null, used_at: null, expires_at: FUTURE, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  httpSend.mockResolvedValue({ success: true })
  db = createFakeDb({ qr_tokens: [] })
  Object.assign(db, { channel, removeChannel: vi.fn().mockResolvedValue('ok') })
})

describe('kioskQrService — getOrCreateActiveKioskQr', () => {
  it('kod yoksa mağaza kimliğiyle oluşturur', async () => {
    const { qr_data } = await getOrCreateActiveKioskQr(admin(), STORE_A)
    expect(qr_data).toMatch(/^SU2\.[A-Za-z0-9_-]{32}$/)
    expect(db.tables.qr_tokens).toHaveLength(1)
    expect(db.tables.qr_tokens[0]).toMatchObject({ store_id: STORE_A, employee_id: null })
  })

  it('başka mağazanın aktif kodunu döndürmez; her mağazanın kendi kodu olur', async () => {
    db.tables.qr_tokens.push(kioskRow(TOKEN_B, STORE_B))
    const a = await getOrCreateActiveKioskQr(admin(), STORE_A)
    expect(a.qr_data).not.toBe(`SU2.${TOKEN_B}`)
    expect(db.tables.qr_tokens).toHaveLength(2)

    const b = await getOrCreateActiveKioskQr(admin(), STORE_B)
    expect(b.qr_data).toBe(`SU2.${TOKEN_B}`)
    expect(db.tables.qr_tokens).toHaveLength(2)
  })

  it('mağazanın aktif kodu varsa yenisi oluşturulmaz', async () => {
    db.tables.qr_tokens.push(kioskRow(TOKEN_A, STORE_A))
    const { qr_data } = await getOrCreateActiveKioskQr(admin(), STORE_A)
    expect(qr_data).toBe(`SU2.${TOKEN_A}`)
    expect(db.tables.qr_tokens).toHaveLength(1)
  })
})

describe('kioskQrService — consumeKioskQr', () => {
  it('kendi mağazasının kodunu tüketir', async () => {
    db.tables.qr_tokens.push(kioskRow(TOKEN_A, STORE_A))
    await consumeKioskQr(admin(), `SU2.${TOKEN_A}`, STORE_A)
    expect(db.tables.qr_tokens[0].used_at).toBeTruthy()
  })

  it('başka mağazanın kodu QR_WRONG_STORE ile reddedilir ve tüketilmez', async () => {
    db.tables.qr_tokens.push(kioskRow(TOKEN_A, STORE_A))
    await expect(consumeKioskQr(admin(), `SU2.${TOKEN_A}`, STORE_B)).rejects.toMatchObject({
      code: 'QR_WRONG_STORE',
      message: 'Bu QR kodu başka bir mağazaya ait.',
    })
    expect(db.tables.qr_tokens[0].used_at).toBeNull()
  })

  it('kendi mağazasında kullanılmış kod QR_USED, bilinmeyen kod QR_INVALID verir', async () => {
    db.tables.qr_tokens.push(kioskRow(TOKEN_A, STORE_A, { used_at: new Date().toISOString() }))
    await expect(consumeKioskQr(admin(), `SU2.${TOKEN_A}`, STORE_A)).rejects.toMatchObject({ code: 'QR_USED' })
    await expect(consumeKioskQr(admin(), `SU2.${'z'.repeat(32)}`, STORE_A)).rejects.toBeInstanceOf(QrTokenError)
  })
})

describe('kioskQrService — rotateAndBroadcastKioskQr', () => {
  it('yeni kodu mağazanın kanalına yayınlar', async () => {
    const next = await rotateAndBroadcastKioskQr(admin(), STORE_A)
    expect(channel).toHaveBeenCalledWith(kioskQrTopic(STORE_A), { config: { private: true } })
    expect(httpSend).toHaveBeenCalledWith('qr', next)
    expect(db.tables.qr_tokens[0].store_id).toBe(STORE_A)
  })

  it('diğer mağazanın kanalına yayın yapmaz', async () => {
    await rotateAndBroadcastKioskQr(admin(), STORE_B)
    expect(channel).toHaveBeenCalledTimes(1)
    expect(channel).not.toHaveBeenCalledWith(kioskQrTopic(STORE_A), expect.anything())
  })
})
