/**
 * kioskQrService / kioskQrCode — yerel üretilen, imzalı kiosk QR'ı.
 * Anahtar türetme, kod biçimi, zaman penceresi, mağaza ve "kendi kodu" kuralları.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeDb } from './helpers/fakeSupabase'
import { issueKioskSeed, verifyKioskQr, verifyKioskIssuer, KIOSK_SEED_TTL_MS } from '@/lib/kioskQrService'
import { computeKioskQr, parseKioskQr, kioskQrWindow, base64UrlDecode, base64UrlEncode, KIOSK_QR_STEP_MS } from '@/lib/kioskQrCode'

const STORE_A = '00000000-0000-4000-8000-00000000000a'
const STORE_B = '00000000-0000-4000-8000-00000000000b'
const KIOSK = '00000000-0000-4000-8000-0000000000c1'
const SCANNER = '00000000-0000-4000-8000-0000000000e1'
const T0 = Date.UTC(2026, 9, 27, 9, 0, 30)

beforeEach(() => {
  process.env.KIOSK_QR_SECRET = 'test-kiosk-secret'
})

describe('kioskQrCode', () => {
  it('base64url gidiş-dönüş', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255])
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
    expect(base64UrlEncode(bytes)).not.toMatch(/[+/=]/)
  })

  it('kod biçimi: SU3.<store>.<issuer>.<exp>.<pencere>.<mac>', async () => {
    const seed = await issueKioskSeed(STORE_A, KIOSK, T0)
    const qr = await computeKioskQr(seed, T0)
    expect(parseKioskQr(qr)).toMatchObject({ storeId: STORE_A, issuerId: KIOSK, window: kioskQrWindow(T0) })
    expect(qr.length).toBeLessThan(140)
  })

  it('kod dakika sınırında değişir, dakika içinde aynı kalır', async () => {
    const seed = await issueKioskSeed(STORE_A, KIOSK, T0)
    const start = kioskQrWindow(T0) * KIOSK_QR_STEP_MS
    expect(await computeKioskQr(seed, start)).toBe(await computeKioskQr(seed, start + KIOSK_QR_STEP_MS - 1))
    expect(await computeKioskQr(seed, start)).not.toBe(await computeKioskQr(seed, start + KIOSK_QR_STEP_MS))
  })

  it('bozuk biçimler ayrıştırılmaz', () => {
    expect(parseKioskQr('SU3.a.b.c.d.e')).toBeNull()
    expect(parseKioskQr(`SU2.${STORE_A}.${KIOSK}.1.1.${'a'.repeat(22)}`)).toBeNull()
    expect(parseKioskQr(`SU3.${STORE_A}.${KIOSK}.1.1.${'a'.repeat(22)}.fazla`)).toBeNull()
  })
})

describe('issueKioskSeed', () => {
  it('anahtar mağazaya, alan hesaba ve bitişe bağlıdır', async () => {
    const a = await issueKioskSeed(STORE_A, KIOSK, T0)
    expect(a.expires_at).toBe(Math.floor((T0 + KIOSK_SEED_TTL_MS) / 1000))
    expect((await issueKioskSeed(STORE_B, KIOSK, T0)).secret).not.toBe(a.secret)
    expect((await issueKioskSeed(STORE_A, SCANNER, T0)).secret).not.toBe(a.secret)
    expect((await issueKioskSeed(STORE_A, KIOSK, T0)).secret).toBe(a.secret)
  })

  it('sunucu sırrı değişince eski anahtarın kodları geçersizdir', async () => {
    const qr = await computeKioskQr(await issueKioskSeed(STORE_A, KIOSK, T0), T0)
    process.env.KIOSK_QR_SECRET = 'yeni-sir'
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: SCANNER, nowMs: T0 })).rejects.toMatchObject({ code: 'QR_INVALID' })
  })
})

describe('verifyKioskQr', () => {
  async function qrAt(atMs: number, storeId = STORE_A, issuerId = KIOSK, seedAt = T0) {
    return computeKioskQr(await issueKioskSeed(storeId, issuerId, seedAt), atMs)
  }

  it('geçerli kod: anahtarı alan hesap döner', async () => {
    await expect(verifyKioskQr(await qrAt(T0), { storeId: STORE_A, scannerId: SCANNER, nowMs: T0 })).resolves.toEqual({ issuerId: KIOSK })
  })

  it('pencere bittikten 30 sn sonrasına kadar kabul, sonrası QR_EXPIRED', async () => {
    const qr = await qrAt(T0)
    const windowEnd = (kioskQrWindow(T0) + 1) * KIOSK_QR_STEP_MS
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: SCANNER, nowMs: windowEnd + 29_000 })).resolves.toBeTruthy()
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: SCANNER, nowMs: windowEnd + 30_000 })).rejects.toMatchObject({ code: 'QR_EXPIRED' })
  })

  it('ileri tarihli kod reddedilir (önceden üretip saklama)', async () => {
    const qr = await qrAt(T0 + 5 * KIOSK_QR_STEP_MS)
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: SCANNER, nowMs: T0 })).rejects.toMatchObject({ code: 'QR_INVALID' })
  })

  it('anahtarın ömrü bittikten sonraki pencereler reddedilir', async () => {
    const after = T0 + KIOSK_SEED_TTL_MS + KIOSK_QR_STEP_MS
    const qr = await qrAt(after)
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: SCANNER, nowMs: after })).rejects.toMatchObject({ code: 'QR_EXPIRED' })
  })

  it('mağaza alanı değiştirilirse imza tutmaz', async () => {
    const qr = (await qrAt(T0)).replace(STORE_A, STORE_B)
    await expect(verifyKioskQr(qr, { storeId: STORE_B, scannerId: SCANNER, nowMs: T0 })).rejects.toMatchObject({ code: 'QR_INVALID' })
  })

  it('pencere alanı değiştirilirse imza tutmaz', async () => {
    const parsed = parseKioskQr(await qrAt(T0))!
    const forged = ['SU3', parsed.storeId, parsed.issuerId, parsed.expiresAt, parsed.window + 1, parsed.mac].join('.')
    await expect(verifyKioskQr(forged, { storeId: STORE_A, scannerId: SCANNER, nowMs: T0 + KIOSK_QR_STEP_MS })).rejects.toMatchObject({ code: 'QR_INVALID' })
  })

  it('başka mağazanın kodu QR_WRONG_STORE', async () => {
    await expect(verifyKioskQr(await qrAt(T0), { storeId: STORE_B, scannerId: SCANNER, nowMs: T0 })).rejects.toMatchObject({ code: 'QR_WRONG_STORE' })
  })

  it('kendi anahtarıyla üretilen kod QR_SELF_ISSUED', async () => {
    await expect(verifyKioskQr(await qrAt(T0), { storeId: STORE_A, scannerId: KIOSK, nowMs: T0 })).rejects.toMatchObject({ code: 'QR_SELF_ISSUED' })
  })
})

describe('verifyKioskIssuer', () => {
  const admin = (employees: Record<string, unknown>[]) => createFakeDb({ employees }) as unknown as SupabaseClient
  const row = (extra: Record<string, unknown> = {}) => ({
    id: KIOSK, active: true, store_id: STORE_A, termination_date: null, roles: { access_level: 'kiosk' }, ...extra,
  })

  it('aktif kiosk hesabı kendi mağazası için geçerli', async () => {
    await expect(verifyKioskIssuer(admin([row()]), KIOSK, STORE_A)).resolves.toBeUndefined()
  })

  it('admin her mağaza için geçerli', async () => {
    await expect(verifyKioskIssuer(admin([row({ roles: { access_level: 'admin' } })]), KIOSK, STORE_B)).resolves.toBeUndefined()
  })

  it.each([
    ['pasif hesap', row({ active: false })],
    ['işten çıkmış hesap', row({ termination_date: '2026-01-01' })],
    ['başka mağaza', row({ store_id: STORE_B })],
    ['çalışan seviyesine düşürülmüş', row({ roles: { access_level: 'employee' } })],
  ])('%s → QR_INVALID', async (_label, r) => {
    await expect(verifyKioskIssuer(admin([r]), KIOSK, STORE_A)).rejects.toMatchObject({ code: 'QR_INVALID' })
  })

  it('silinmiş hesap → QR_INVALID', async () => {
    await expect(verifyKioskIssuer(admin([]), KIOSK, STORE_A)).rejects.toMatchObject({ code: 'QR_INVALID' })
  })
})
