// Leave Request domain types — FAZ 9

/**
 * Temel izin türü: puantaj / bordro / yıllık izin bakiyesinin anladığı tür (puantaj kodu).
 * Kullanıcının gördüğü adlar leave_type_definitions'tan gelir (LeaveTypeDefinition); bu etiketler
 * tanımı olmayan eski kayıtlar için yedektir.
 */
export type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid' | 'other' | 'public_holiday' | 'weekly_rest'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Yıllık izin',
  sick: 'Hastalık raporu',
  personal: 'Ücretli izin',
  unpaid: 'Ücretsiz izin',
  other: 'Diğer',
  public_holiday: 'Resmi tatil',
  weekly_rest: 'Haftalık tatil',
}

/** Tanıma bağlanabilen temel türler (haftalık tatil planın kendi türüdür, tanım taşımaz) */
export type LeaveBaseType = Exclude<LeaveType, 'weekly_rest'>
export const LEAVE_BASE_TYPES: LeaveBaseType[] = ['annual', 'sick', 'unpaid', 'personal', 'public_holiday', 'other']

/** Ayarlar › İzin türleri: temel türün puantaj kodu ve etkisi */
export const LEAVE_BASE_TYPE_INFO: Record<LeaveBaseType, { code: string; label: string; hint: string }> = {
  annual: { code: 'Yİ', label: 'Yıllık izin', hint: 'Yıllık izin bakiyesinden düşer' },
  sick: { code: 'Rİ', label: 'Rapor', hint: 'Raporlu gün (SGK eksik gün 01)' },
  unpaid: { code: 'Üİ', label: 'Ücretsiz izin', hint: 'Ücret ödenmez (SGK eksik gün 21)' },
  personal: { code: 'Mİ', label: 'Ücretli izin', hint: 'Ücretli mazeret izni' },
  other: { code: 'Mİ', label: 'Ücretli izin (diğer)', hint: 'Ücretli mazeret izni' },
  public_holiday: { code: 'RT', label: 'Resmi tatil', hint: 'Resmi tatil günü olarak işlenir' },
}

/** Şirket genelinde adlandırılmış izin türü (Admin yönetir) */
export interface LeaveTypeDefinition {
  id: string
  name: string
  base_type: LeaveBaseType
  /** Çalışan kendi adına talep edebilir */
  employee_requestable: boolean
  active: boolean
  sort_order: number
  /** Tohumlanan sistem türü (temel türün adı); yöneticinin eklediklerinde null */
  system_key: string | null
}

/** Kaydın görünen tür adı: tanım adı, yoksa temel tür etiketi */
export function leaveTypeName(
  r: { leave_type: string; leave_type_def_id?: string | null },
  defs: ReadonlyMap<string, LeaveTypeDefinition> | undefined
): string {
  const def = r.leave_type_def_id ? defs?.get(r.leave_type_def_id) : undefined
  return def?.name ?? (LEAVE_TYPE_LABELS as Record<string, string>)[r.leave_type] ?? r.leave_type
}

/** weekly_rest tipi manager tarafından doğrudan atanır, onay akışına girmez */
export const WEEKLY_REST_TYPE: LeaveType = 'weekly_rest'

/**
 * Otomatik plan aktarımında (/api/workforce/apply) atanan haftalık tatillerin reason değeri.
 * Elle atanan tatillerden ayırt etmek için kullanılır: plan yeniden oluşturulurken
 * yok sayılır, yeniden aktarılırken yenileriyle değiştirilir.
 */
export const AUTO_WEEKLY_REST_REASON = 'Haftalık tatil (otomatik plan)'

export function isAutoWeeklyRest(l: { leave_type: string; reason: string | null }): boolean {
  return l.leave_type === 'weekly_rest' && l.reason === AUTO_WEEKLY_REST_REASON
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
}

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string     // 'YYYY-MM-DD'
  end_date: string       // 'YYYY-MM-DD'
  reason: string | null
  status: LeaveStatus
  reviewer_note: string | null
  reviewed_at: string | null
  /** Tekrarlayan haftalık tatilin kuralı (recurring_weekly_rests); tek seferlik kayıtta null */
  recurrence_id?: string | null
  /** Adlandırılmış izin türü (leave_type_definitions); haftalık tatilde null */
  leave_type_def_id?: string | null
  created_at: string
  updated_at: string
}

// Joined: employee bilgisiyle birlikte
export interface LeaveRequestWithEmployee extends LeaveRequest {
  employees: {
    id: string
    full_name: string
    roles?: { name: string } | null
  } | null
}

// Yeni talep payload — çalışan tarafından
export interface CreateLeaveRequestPayload {
  employee_id: string
  /** Haftalık tatil için 'weekly_rest'; diğer türlerde leave_type_def_id verilirse tanımın temel türü kullanılır */
  leave_type?: LeaveType
  leave_type_def_id?: string
  start_date: string
  end_date: string
  reason?: string | null
}

// Manager incelemesi payload
export interface ReviewLeaveRequestPayload {
  status: 'approved' | 'rejected'
  reviewer_note?: string | null
}
