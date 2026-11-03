/**
 * Client tarafı izin türleri API'si — /api/leave-types
 */
import { useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from './http'
import type { LeaveBaseType, LeaveTypeDefinition } from '@/types/leave'

export const LEAVE_TYPES_KEY = '/api/leave-types'

export async function fetchLeaveTypes(): Promise<LeaveTypeDefinition[]> {
  const { types } = await apiFetch<{ types: LeaveTypeDefinition[] }>(LEAVE_TYPES_KEY)
  return types
}

export async function createLeaveType(payload: {
  name: string
  base_type: LeaveBaseType
  employee_requestable: boolean
}): Promise<LeaveTypeDefinition> {
  const { type } = await apiFetch<{ type: LeaveTypeDefinition }>(LEAVE_TYPES_KEY, { method: 'POST', body: payload })
  return type
}

export async function updateLeaveType(
  id: string,
  patch: Partial<Pick<LeaveTypeDefinition, 'name' | 'employee_requestable' | 'active'>>
): Promise<LeaveTypeDefinition> {
  const { type } = await apiFetch<{ type: LeaveTypeDefinition }>(`${LEAVE_TYPES_KEY}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  })
  return type
}

/** Tüm türler (pasifler dahil; eski kayıtların adı için), aktifler ve id → tür haritası */
export function useLeaveTypes() {
  const q = useSWR(LEAVE_TYPES_KEY, fetchLeaveTypes)
  const all = q.data
  return useMemo(() => ({
    types: all ?? [],
    active: (all ?? []).filter((t) => t.active),
    byId: new Map((all ?? []).map((t) => [t.id, t])),
    isLoading: !all && !q.error,
    error: q.error as Error | undefined,
    mutate: q.mutate,
  }), [all, q.error, q.mutate])
}
