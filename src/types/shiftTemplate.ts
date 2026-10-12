// ShiftTemplate domain types — FAZ 3

export interface ShiftTemplate {
  id: string
  name: string
  start_time: string  // 'HH:MM:SS' (DB TIME type) — UI'da 'HH:MM' gösterilir
  end_time: string
  description: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface CreateShiftTemplatePayload {
  name: string
  start_time: string  // 'HH:MM'
  end_time: string    // 'HH:MM'
  description?: string | null
  active?: boolean
}

export interface UpdateShiftTemplatePayload {
  name?: string
  start_time?: string
  end_time?: string
  description?: string | null
  active?: boolean
}

// Validation hataları
export interface ShiftTemplateValidationErrors {
  name?: string
  start_time?: string
  end_time?: string
}

/** 'HH:MM:SS' veya 'HH:MM' formatını 'HH:MM' olarak döner */
export function formatTime(time: string): string {
  return time.slice(0, 5)
}
