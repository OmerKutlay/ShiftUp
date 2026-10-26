// Employee & Role domain types — FAZ 2 / FAZ AUTH
// attendance.ts'teki Employee tipi korunur; bu dosya genişletilmiş tipleri içerir.

import type { AccessLevel, PlanningGroup } from '@/lib/auth/roles'

/** Sistem rolü: yetki seviyesi + planlamadaki görev (kod rol adına bakmaz; ad yalnızca gösterim) */
export interface Role {
  id: string
  name: string
  description: string | null
  access_level: AccessLevel
  /** Vardiya planlayıcısındaki görev; null = planlanmaz */
  planning_group: PlanningGroup | null
  sort_order: number
  created_at?: string
}

/** Çalışma tipi — DB CHECK constraint ile senkron tutulur */
export type EmploymentType = 'full_time' | 'part_time'

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Tam zamanlı',
  part_time: 'Yarı zamanlı',
}

/** Part-time sabit kurallar — iş mantığı tek yerde */
export const PART_TIME_RULES = {
  maxWeeklyHours: 30,
  maxWeeklyDays: 4,
} as const

/**
 * İşten çıkış nedeni — DB CHECK ile senkron. SGK işten çıkış bildirgesi kodlarının sadeleştirilmiş karşılığı:
 * istifa (1/2/3), isveren_feshi (4/5/17-19), deneme_suresi (2), emeklilik (8/12-13), karsilikli_anlasma (10),
 * sozlesme_sonu (belirli süreli sözleşmenin bitişi), vefat (12), diger.
 */
export const TERMINATION_REASONS = [
  'istifa', 'isveren_feshi', 'deneme_suresi', 'emeklilik',
  'karsilikli_anlasma', 'sozlesme_sonu', 'vefat', 'diger',
] as const
export type TerminationReason = (typeof TERMINATION_REASONS)[number]

export const TERMINATION_REASON_LABELS: Record<TerminationReason, string> = {
  istifa: 'İstifa',
  isveren_feshi: 'İşveren feshi',
  deneme_suresi: 'Deneme süresinde fesih',
  emeklilik: 'Emeklilik',
  karsilikli_anlasma: 'Karşılıklı anlaşma',
  sozlesme_sonu: 'Sözleşme sonu',
  vefat: 'Vefat',
  diger: 'Diğer',
}

export function isTerminationReason(v: unknown): v is TerminationReason {
  return typeof v === 'string' && (TERMINATION_REASONS as readonly string[]).includes(v)
}

// Veritabanındaki employees satırı (tam form, join'siz)
export interface Employee {
  id: string
  full_name: string
  email: string | null      // FAZ AUTH: login email
  role_id: string | null
  active: boolean
  /** Çalışanın (ana) mağazası */
  store_id: string
  employment_type: EmploymentType  // 'full_time' | 'part_time'
  auth_user_id: string | null  // FAZ AUTH: Supabase auth.users.id bağlantısı
  /** İşe giriş — yıllık izin hakkı (İş K. Md. 53) */
  hire_date?: string | null
  /** Doğum tarihi — 18 altı / 50 üstü izin hakkı */
  birth_date?: string | null
  /** Fazla çalışma yazılı onay tarihi (İş K. Md. 41/8) */
  overtime_consent_at?: string | null
  /** İşten ayrılış: son çalışma günü (dahil) ve nedeni — bkz. src/lib/employment.ts */
  termination_date?: string | null
  termination_reason?: TerminationReason | null
  termination_note?: string | null
  terminated_by?: string | null
  terminated_at?: string | null
  /** Çıkış tarihindeki kullanılmamış yıllık izin (gün; İş K. Md. 59 — bordro) */
  termination_leave_balance?: number | null
  created_at: string
  updated_at: string
}

// Liste/kart görünümü için join edilmiş form
// Not: Supabase nested select 'roles' alanını tekil obje (to-one) olarak döndürür
export interface EmployeeWithRole extends Employee {
  roles: Role | null  // Supabase join: employees → roles (many-to-one, tekil obje)
}

// Yeni çalışan oluşturma payload
export interface CreateEmployeePayload {
  full_name: string
  /** Yalnızca Admin başka mağazaya çalışan ekleyebilir; verilmezse aktif mağaza */
  store_id?: string
  email: string | null      // FAZ AUTH: login email (benzersiz olmalı)
  role_id: string | null
  active: boolean
  employment_type: EmploymentType
  hire_date?: string | null
  birth_date?: string | null
  overtime_consent_at?: string | null
}

// Çalışan güncelleme payload
export interface UpdateEmployeePayload {
  full_name?: string
  /** Mağaza transferi — yalnızca Admin */
  store_id?: string
  email?: string | null
  role_id?: string | null
  active?: boolean
  employment_type?: EmploymentType
  hire_date?: string | null
  birth_date?: string | null
  overtime_consent_at?: string | null
}
