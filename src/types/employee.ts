// Employee & Role domain types — FAZ 2 / FAZ AUTH
// attendance.ts'teki Employee tipi korunur; bu dosya genişletilmiş tipleri içerir.

export interface Role {
  id: string
  name: string
  description: string | null
  created_at: string
}

/** Çalışma tipi — DB CHECK constraint ile senkron tutulur */
export type EmploymentType = 'full_time' | 'part_time'

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Tam Zamanlı',
  part_time: 'Yarı Zamanlı',
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
  role: string              // serbest metin (geriye dönük uyumluluk + attendance sistemine destek)
  role_id: string | null
  active: boolean
  employment_type: EmploymentType  // 'full_time' | 'part_time'
  auth_user_id: string | null  // FAZ AUTH: Supabase auth.users.id bağlantısı
  created_at: string
  updated_at: string
}

// Liste/kart görünümü için join edilmiş form
// Not: Supabase nested select 'roles' alanını tekil obje (to-one) olarak döndürür
export interface EmployeeWithRole extends Employee {
  roles: Role | null  // Supabase join: employees → roles (many-to-one, tekil obje)
  /** roles tablosundan gelen yapılandırılmış rol adı — authorization için kullan */
  role_name?: string | null
}

// Yeni çalışan oluşturma payload
export interface CreateEmployeePayload {
  full_name: string
  email: string | null      // FAZ AUTH: login email (benzersiz olmalı)
  role: string              // pozisyon / unvan (serbest metin)
  role_id: string | null
  active: boolean
  employment_type: EmploymentType
}

// Çalışan güncelleme payload
export interface UpdateEmployeePayload {
  full_name?: string
  email?: string | null
  role?: string
  role_id?: string | null
  active?: boolean
  employment_type?: EmploymentType
}
