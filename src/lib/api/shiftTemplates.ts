/**
 * Client tarafı vardiya şablonu API'si — /api/shift-templates
 */
import { apiFetch } from './http'
import type {
  ShiftTemplate,
  CreateShiftTemplatePayload,
  UpdateShiftTemplatePayload,
} from '@/types/shiftTemplate'

export async function fetchShiftTemplates(): Promise<ShiftTemplate[]> {
  const { templates } = await apiFetch<{ templates: ShiftTemplate[] }>('/api/shift-templates')
  return templates
}

export async function fetchActiveShiftTemplates(): Promise<ShiftTemplate[]> {
  const { templates } = await apiFetch<{ templates: ShiftTemplate[] }>('/api/shift-templates?active=true')
  return templates
}

export async function createShiftTemplate(payload: CreateShiftTemplatePayload): Promise<ShiftTemplate> {
  const { template } = await apiFetch<{ template: ShiftTemplate }>('/api/shift-templates', {
    method: 'POST',
    body: payload,
  })
  return template
}

export async function updateShiftTemplate(
  id: string,
  payload: UpdateShiftTemplatePayload
): Promise<ShiftTemplate> {
  const { template } = await apiFetch<{ template: ShiftTemplate }>(
    `/api/shift-templates/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: payload }
  )
  return template
}

export function deactivateShiftTemplate(id: string): Promise<ShiftTemplate> {
  return updateShiftTemplate(id, { active: false })
}

export function activateShiftTemplate(id: string): Promise<ShiftTemplate> {
  return updateShiftTemplate(id, { active: true })
}
