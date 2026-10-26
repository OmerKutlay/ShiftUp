// Location + Geofence domain types — FAZ 6

export interface StoreLocation {
  id: string
  store_id: string             // konumun ait olduğu mağaza (mağaza başına tek aktif konum)
  name: string
  latitude: number
  longitude: number
  allowed_radius_meters: number
  max_accuracy_meters: number  // GPS doğruluk eşiği
  active: boolean
  created_at: string
  updated_at: string
}

// Client'tan API'ye gönderilen konum bilgisi
export interface GpsCoordinates {
  latitude: number
  longitude: number
  accuracy: number   // metre cinsinden GPS doğruluğu
}

// Geofence kontrol sonucu
export interface GeofenceResult {
  allowed: boolean
  distance_meters: number
  accuracy_meters: number
  store_radius_meters: number
  message: string
}

// Location doğrulama hata kodları
export type LocationErrorCode =
  | 'LOCATION_PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_TIMEOUT'
  | 'LOCATION_LOW_ACCURACY'
  | 'LOCATION_OUT_OF_RANGE'
  | 'STORE_LOCATION_NOT_FOUND'
  | 'LOCATION_VALIDATION_FAILED'

export class LocationError extends Error {
  constructor(
    message: string,
    public readonly code: LocationErrorCode
  ) {
    super(message)
    this.name = 'LocationError'
  }
}

// /api/qr/process'e eklenen location alanı (FAZ 6)
export interface LocationPayload {
  latitude: number
  longitude: number
  accuracy: number
}
