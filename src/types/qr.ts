// QR + Attendance domain types — FAZ 5

// QR aksiyon tipleri — DB ENUM ile birebir eşleşir
export type QrActionType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out'

export const QR_ACTION_LABELS: Record<QrActionType, string> = {
  clock_in: 'Giriş',
  break_start: 'Mola Başlangıcı',
  break_end: 'Mola Bitişi',
  clock_out: 'Çıkış',
}

// QR aksiyon → Attendance aksiyon mapping
export const QR_TO_ATTENDANCE_ACTION: Record<QrActionType, string> = {
  clock_in: 'clock_in',
  break_start: 'start_break',
  break_end: 'end_break',
  clock_out: 'clock_out',
}

// DB: qr_tokens satırı
export interface QrToken {
  id: string
  token: string
  action_type: QrActionType
  employee_id: string
  expires_at: string
  used_at: string | null
  created_at: string
}

// QR içeriği — QR koda encode edilen payload
export interface QrPayload {
  token: string
  action: QrActionType
  employee_id: string
  exp: number  // Unix timestamp (seconds)
}

// /api/qr/generate request
export interface GenerateQrRequest {
  employee_id: string
  action_type: QrActionType
  ttl_seconds?: number  // varsayılan 60
}

// /api/qr/generate response
export interface GenerateQrResponse {
  token: string
  action_type: QrActionType
  employee_id: string
  expires_at: string
  qr_data: string  // JSON.stringify(QrPayload) — QR'a encode edilir
}

// /api/qr/process request
export interface ProcessQrRequest {
  qr_data: string  // QR'dan okunan raw string
  employee_id: string  // kim taradı (no-auth fallback: kullanıcı seçer)
}

// /api/qr/process response
export interface ProcessQrResponse {
  success: boolean
  action_type: QrActionType
  new_status: string
  timestamp: string   // işlem zamanı (Türkiye TZ, HH:mm)
  message: string     // kullanıcıya gösterilecek mesaj
}

// Hata yanıtı
export interface ApiErrorResponse {
  error: string
  code: string
}

// QR Doğrulama hata kodları — type-safe
export type QrErrorCode =
  | 'QR_INVALID'
  | 'QR_EXPIRED'
  | 'QR_USED'
  | 'QR_WRONG_ACTION'
  | 'EMPLOYEE_NOT_FOUND'
  | 'EMPLOYEE_INACTIVE'
  | 'NO_SHIFT_TODAY'
  | 'ATTENDANCE_RULE_VIOLATION'
  | 'DB_ERROR'
  | 'UNKNOWN'
