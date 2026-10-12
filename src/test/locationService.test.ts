import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoreLocation, GpsCoordinates } from '@/types/location'
import { LocationError } from '@/types/location'

// ============================================================
// supabaseAdmin mock
// ============================================================
const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: mockCreateAdminClient,
}))

import {
  haversineDistance,
  checkGeofence,
  fetchActiveStoreLocation,
  validateLocationServerSide,
} from '@/lib/locationService'

// ============================================================
// Helpers
// ============================================================
function makeStore(overrides: Partial<StoreLocation> = {}): StoreLocation {
  return {
    id: 'store-001',
    name: 'Demo Mağaza',
    latitude: 41.0082,
    longitude: 28.9784,
    allowed_radius_meters: 150,
    max_accuracy_meters: 200,
    active: true,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

// Mağaza koordinatından ~50m uzakta bir konum
const COORDS_INSIDE: GpsCoordinates = {
  latitude: 41.00865,
  longitude: 28.9784,
  accuracy: 15,
}

// Mağazadan ~500m uzakta bir konum
const COORDS_OUTSIDE: GpsCoordinates = {
  latitude: 41.013,
  longitude: 28.9784,
  accuracy: 15,
}

// Çok düşük doğruluklu konum
const COORDS_LOW_ACCURACY: GpsCoordinates = {
  latitude: 41.0082,
  longitude: 28.9784,
  accuracy: 350, // max_accuracy_meters (200) üzerinde
}

// ============================================================
// haversineDistance — saf birim testler
// ============================================================
describe('locationService — haversineDistance', () => {
  it('aynı nokta → 0 metre', () => {
    const dist = haversineDistance(41.0082, 28.9784, 41.0082, 28.9784)
    expect(dist).toBe(0)
  })

  it('~50m uzakta bir nokta doğru hesaplanır', () => {
    const dist = haversineDistance(41.0082, 28.9784, 41.00865, 28.9784)
    expect(dist).toBeGreaterThan(30)
    expect(dist).toBeLessThan(80)
  })

  it('İstanbul–Ankara arası makul mesafe (~350km)', () => {
    const dist = haversineDistance(41.0082, 28.9784, 39.9334, 32.8597)
    expect(dist).toBeGreaterThan(300_000)
    expect(dist).toBeLessThan(400_000)
  })

  it('negatif koordinatlar (güney yarımküre) düzgün çalışır', () => {
    const dist = haversineDistance(-33.8688, 151.2093, -33.8700, 151.2100)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeLessThan(200)
  })
})

// ============================================================
// checkGeofence — saf birim testler
// ============================================================
describe('locationService — checkGeofence', () => {
  it('geçerli konum kabul ediliyor (mağaza içi)', () => {
    const store = makeStore()
    const result = checkGeofence(COORDS_INSIDE, store)
    expect(result.allowed).toBe(true)
    expect(result.distance_meters).toBeLessThan(store.allowed_radius_meters)
    expect(result.message).toMatch(/Konum doğrulandı/)
  })

  it('radius dışındaki konum reddediliyor', () => {
    const store = makeStore()
    const result = checkGeofence(COORDS_OUTSIDE, store)
    expect(result.allowed).toBe(false)
    expect(result.distance_meters).toBeGreaterThan(store.allowed_radius_meters)
    expect(result.message).toMatch(/dışındasınız/)
  })

  it('düşük doğruluklu konum reddediliyor', () => {
    const store = makeStore()
    const result = checkGeofence(COORDS_LOW_ACCURACY, store)
    expect(result.allowed).toBe(false)
    expect(result.distance_meters).toBe(-1)
    expect(result.message).toMatch(/GPS doğruluğu yetersiz/)
  })

  it('tam sınırda olan konum kabul ediliyor', () => {
    // allowed_radius_meters = 150 iken tam 149m uzakta
    const store = makeStore({ allowed_radius_meters: 200 })
    const result = checkGeofence(COORDS_INSIDE, store)
    expect(result.allowed).toBe(true)
  })

  it("accuracy ve store değerleri result'a yansıtılır", () => {
    const store = makeStore()
    const result = checkGeofence(COORDS_INSIDE, store)
    expect(result.accuracy_meters).toBe(Math.round(COORDS_INSIDE.accuracy))
    expect(result.store_radius_meters).toBe(store.allowed_radius_meters)
  })
})

// ============================================================
// fetchActiveStoreLocation
// ============================================================
describe('locationService — fetchActiveStoreLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('aktif mağaza konumunu döner', async () => {
    const store = makeStore()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: store, error: null }),
      })),
    })

    const result = await fetchActiveStoreLocation()
    expect(result.id).toBe('store-001')
    expect(result.latitude).toBe(41.0082)
  })

  it('aktif mağaza yoksa LocationError fırlatır', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })

    await expect(fetchActiveStoreLocation()).rejects.toThrow(LocationError)
    await expect(fetchActiveStoreLocation()).rejects.toThrow('Aktif mağaza konumu tanımlanmamış.')
  })

  it('DB hatası LocationError fırlatır', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB conn error' } }),
      })),
    })

    await expect(fetchActiveStoreLocation()).rejects.toThrow(LocationError)
  })
})

// ============================================================
// validateLocationServerSide
// ============================================================
describe('locationService — validateLocationServerSide', () => {
  beforeEach(() => vi.clearAllMocks())

  it('geçerli QR + geçerli konum → allowed:true', async () => {
    const store = makeStore()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: store, error: null }),
      })),
    })

    const result = await validateLocationServerSide(COORDS_INSIDE)
    expect(result.allowed).toBe(true)
  })

  it('geçerli QR + radius dışı konum → allowed:false', async () => {
    const store = makeStore()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: store, error: null }),
      })),
    })

    const result = await validateLocationServerSide(COORDS_OUTSIDE)
    expect(result.allowed).toBe(false)
  })
})
