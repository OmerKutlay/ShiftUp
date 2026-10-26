/**
 * Kontrol listeleri — şablon, günlük uygulama ve API yanıt tipleri.
 */

export type ChecklistKind = 'opening' | 'closing' | 'custom'

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  opening: 'Açılış',
  closing: 'Kapanış',
  custom: 'Özel',
}

export interface ChecklistTemplateItem {
  id: string
  position: number
  text: string
  required: boolean
}

export interface ChecklistTemplate {
  id: string
  name: string
  kind: ChecklistKind
  /** 0 = Pazar … 6 = Cumartesi */
  weekdays: number[]
  /** 'HH:MM' ya da null */
  due_time: string | null
  active: boolean
  items: ChecklistTemplateItem[]
}

export interface ChecklistTemplateInput {
  name: string
  kind: ChecklistKind
  weekdays: number[]
  due_time: string | null
  active: boolean
  items: { text: string; required: boolean }[]
}

export interface ChecklistRunItem {
  id: string
  position: number
  text: string
  required: boolean
  done_at: string | null
  done_by: string | null
  done_by_name: string | null
}

export interface ChecklistRun {
  id: string
  template_id: string
  run_date: string
  name: string
  kind: ChecklistKind
  due_time: string | null
  completed_at: string | null
  completed_by_name: string | null
  note: string | null
  items: ChecklistRunItem[]
  /** Son saat + 15 dk geçti ve tamamlanmadı (sunucu hesaplar) */
  overdue: boolean
}

export interface TodayChecklistsResponse {
  date: string
  runs: ChecklistRun[]
  /** Oturumdaki kişi bugün madde işaretleyebilir mi (yönetici ya da bugün bu mağazada vardiyası var) */
  can_tick: boolean
  /** Yönetici: başkasının işaretini de geri alabilir */
  is_manager: boolean
  current_employee_id: string
}

export interface ChecklistHistoryRun {
  id: string
  template_id: string
  run_date: string
  name: string
  kind: ChecklistKind
  due_time: string | null
  completed_at: string | null
  completed_by_name: string | null
  done: number
  total: number
}

export interface ChecklistHistoryResponse {
  from: string
  to: string
  runs: ChecklistHistoryRun[]
}
