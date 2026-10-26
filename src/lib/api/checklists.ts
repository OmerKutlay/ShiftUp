/**
 * Client tarafı kontrol listesi API'si — /api/checklists/*
 */
import { apiFetch } from './http'
import type {
  ChecklistHistoryResponse,
  ChecklistTemplate,
  ChecklistTemplateInput,
  TodayChecklistsResponse,
} from '@/types/checklist'

/** SWR anahtarları */
export const CHECKLISTS_TODAY_KEY = 'checklists:today'
export const CHECKLISTS_TEMPLATES_KEY = 'checklists:templates'
export const CHECKLISTS_HISTORY_KEY = 'checklists:history'

export const fetchTodayChecklists = () => apiFetch<TodayChecklistsResponse>('/api/checklists/today')

export async function fetchChecklistTemplates(): Promise<ChecklistTemplate[]> {
  const { templates } = await apiFetch<{ templates: ChecklistTemplate[] }>('/api/checklists/templates')
  return templates
}

export const fetchChecklistHistory = () => apiFetch<ChecklistHistoryResponse>('/api/checklists/history')

export async function createChecklistTemplate(input: ChecklistTemplateInput): Promise<ChecklistTemplate> {
  const { template } = await apiFetch<{ template: ChecklistTemplate }>('/api/checklists/templates', {
    method: 'POST',
    body: input,
  })
  return template
}

export async function updateChecklistTemplate(
  id: string,
  patch: Partial<ChecklistTemplateInput>
): Promise<ChecklistTemplate> {
  const { template } = await apiFetch<{ template: ChecklistTemplate }>(
    `/api/checklists/templates/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: patch }
  )
  return template
}

export function setChecklistItemDone(runId: string, itemId: string, done: boolean) {
  return apiFetch<{
    item: { id: string; done_at: string | null; done_by: string | null }
    completed_at: string | null
    completed_by: string | null
  }>(`/api/checklists/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: { done },
  })
}

export function setChecklistRunNote(runId: string, note: string | null) {
  return apiFetch<{ note: string | null }>(`/api/checklists/runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    body: { note },
  })
}
