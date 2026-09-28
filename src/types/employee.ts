// Employee & Role domain types — FAZ 2
// attendance.ts'teki Employee tipi korunur; bu dosya genişletilmiş tipleri içerir.

export interface Role {
  id: string
  name: string
  description: string | null
  created_at: string
}

// Veritabanındaki employees satırı (tam form, join'siz)
export interface Employee {
  id: string
  full_name: string
  role: string        // serbest metin (geriye dönük uyumluluk + attendance sistemine destek)
  role_id: string | null
  active: boolean
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
  role: string       // pozisyon / unvan (serbest metin)
  role_id: string | null
  active: boolean
}

// Çalışan güncelleme payload
export interface UpdateEmployeePayload {
  full_name?: string
  role?: string
  role_id?: string | null
  active?: boolean
}
