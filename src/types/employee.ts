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
