import { C } from '@/lib/palette'
/**
 * Manuel Mesai Düzeltme Talebi domain types
 */

export type TimeCorrectionStatus = 'pending' | 'approved' | 'rejected' | 'direct'

export const TIME_CORRECTION_STATUS_LABELS: Record<TimeCorrectionStatus, string> = {
  pending:  'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  direct:   'Yönetici Girişi',
}

export const TIME_CORRECTION_STATUS_COLORS: Record<TimeCorrectionStatus, string> = {
  pending:  C.warning,
  approved: C.success,
  rejected: C.danger,
  direct:   C.plum,
}

export interface TimeCorrectionRequest {
  id: string
  employee_id: string
  date: string                  // 'YYYY-MM-DD'
  requested_start_time: string  // 'HH:MM'
  requested_end_time: string    // 'HH:MM'
  reason: string
  status: TimeCorrectionStatus
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_note: string | null
  created_at: string
  updated_at: string
  // join
  employee?: { id: string; full_name: string; role: string } | null
  reviewer?: { id: string; full_name: string } | null
}

export interface CreateTimeCorrectionPayload {
  date: string
  requested_start_time: string
  requested_end_time: string
  reason: string
}

export interface ReviewTimeCorrectionPayload {
  request_id: string
  status: 'approved' | 'rejected'
  reviewer_note?: string | null
}

export interface DirectTimeCorrectionPayload {
  employee_id: string
  date: string
  requested_start_time: string
  requested_end_time: string
  reason: string
}
