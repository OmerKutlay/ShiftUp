/**
 * Location Service — FAZ 6
 * Haversine mesafe hesabı + geofence doğrulaması.
 * Pure fonksiyonlar test edilebilir ve framework bağımsızdır.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { StoreLocation, GpsCoordinates, GeofenceResult } from '@/types/location'
import { LocationError } from '@/types/location'

// ============================================================
// Haversine mesafe hesabı
// Dünya yarıçapı: 6371 km
// ============================================================
const EARTH_RADIUS_M = 6_371_000

/**
 * İki GPS koordinatı arasındaki mesafeyi metre cinsinden hesaplar.
 * Haversine formülü kullanılır — küre üzerinde geodezik mesafe.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

// ============================================================
// Geofence kontrolü — saf fonksiyon
// ============================================================

/**
 * GPS koordinatlarının mağaza geofence'i içinde olup olmadığını kontrol eder.
 * Hem mesafe hem GPS doğruluğu değerlendirilir.
 */
export function checkGeofence(
  userCoords: GpsCoordinates,
  store: StoreLocation
): GeofenceResult {
  // 1. GPS doğruluğu kontrolü
  if (userCoords.accuracy > store.max_accuracy_meters) {
    return {
      allowed: false,
      distance_meters: -1,
      accuracy_meters: userCoords.accuracy,
      store_radius_meters: store.allowed_radius_meters,
      message: `GPS doğruluğu yetersiz (${Math.round(userCoords.accuracy)}m). Daha iyi sinyal bekleyin.`,
    }
  }

  // 2. Mesafe hesabı
  const distance = haversineDistance(
    userCoords.latitude,
    userCoords.longitude,
    store.latitude,
    store.longitude
  )

  const allowed = distance <= store.allowed_radius_meters

  return {
    allowed,
    distance_meters: Math.round(distance),
    accuracy_meters: Math.round(userCoords.accuracy),
    store_radius_meters: store.allowed_radius_meters,
    message: allowed
      ? `Konum doğrulandı (${Math.round(distance)}m mesafede).`
      : `Mağaza konumu dışındasınız (${Math.round(distance)}m uzakta, izin verilen: ${store.allowed_radius_meters}m).`,
  }
}

// ============================================================
// Aktif mağaza konumunu DB'den getir (server-side)
// ============================================================

export async function fetchActiveStoreLocation(storeId: string): Promise<StoreLocation> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('store_locations')
    .select('*')
    .eq('store_id', storeId)
    .eq('active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new LocationError(
      `Mağaza konumu alınamadı: ${error.message}`,
      'STORE_LOCATION_NOT_FOUND'
    )
  }

  if (!data) {
    throw new LocationError(
      'Aktif mağaza konumu tanımlanmamış.',
      'STORE_LOCATION_NOT_FOUND'
    )
  }

  return data as StoreLocation
}

// ============================================================
// Server-side combined validation
// ============================================================

/**
 * GPS koordinatlarını server tarafında verilen mağazanın aktif konumuyla doğrular.
 * Frontend'den gelen lat/lon/accuracy'ye güvenmez — koordinatları
 * DB'deki mağaza konumuyla karşılaştırır.
 */
export async function validateLocationServerSide(
  userCoords: GpsCoordinates,
  storeId: string
): Promise<GeofenceResult> {
  const store = await fetchActiveStoreLocation(storeId)
  return checkGeofence(userCoords, store)
}
