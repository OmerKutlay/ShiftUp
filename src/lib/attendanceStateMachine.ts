import type { AttendanceStatus } from '@/types/attendance'
import { diffMinutes, type AttendanceTimes, type BreakSpan } from '@/lib/attendanceDurations'

// ============================================================
// Attendance State Machine
// ============================================================

export type AttendanceAction = 'clock_in' | 'start_break' | 'end_break' | 'clock_out'

/**
 * Returns which actions are valid for a given status.
 */
export function getAllowedActions(status: AttendanceStatus): AttendanceAction[] {
  switch (status) {
    case 'shift_waiting':
      return ['clock_in']
    case 'working':
      return ['start_break', 'clock_out']
    case 'on_break':
      return ['end_break']
    case 'working_after_break':
      return ['start_break', 'clock_out']
    case 'clocked_out':
      return []
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

/**
 * Returns the next status after performing an action.
 * Throws if the transition is invalid (business rule violation).
 */
export function applyAction(
  currentStatus: AttendanceStatus,
  action: AttendanceAction
): AttendanceStatus {
  const allowed = getAllowedActions(currentStatus)
  if (!allowed.includes(action)) {
    throw new AttendanceRuleError(getRuleViolationMessage(currentStatus, action))
  }

  switch (action) {
    case 'clock_in':
      return 'working'
    case 'start_break':
      return 'on_break'
    case 'end_break':
      return 'working_after_break'
    case 'clock_out':
      return 'clocked_out'
  }
}

// ============================================================
// Business rule violation messages (Turkish)
// ============================================================

function getRuleViolationMessage(status: AttendanceStatus, action: AttendanceAction): string {
  if (action === 'clock_in' && status === 'clocked_out') {
    return 'Çıkış yapıldıktan sonra tekrar giriş yapılamaz.'
  }
  if (action === 'start_break' && status === 'shift_waiting') {
    return 'Giriş yapılmadan mola başlatılamaz.'
  }
  if (action === 'start_break' && status === 'on_break') {
    return 'Zaten molada iken tekrar mola başlatılamaz.'
  }
  if (action === 'end_break' && status !== 'on_break') {
    return 'Mola başlamadan mola bitirilemez.'
  }
  if (action === 'clock_out' && status === 'on_break') {
    return 'Molada iken çıkış yapılamaz. Önce moladan dönün.'
  }
  if (action === 'clock_out' && status === 'shift_waiting') {
    return 'Giriş yapılmadan çıkış yapılamaz.'
  }
  if (action === 'clock_out' && status === 'clocked_out') {
    return 'Çıkış zaten yapılmış.'
  }
  return `Bu durumda (${status}) "${action}" işlemi yapılamaz.`
}

export class AttendanceRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttendanceRuleError'
  }
}

// ============================================================
// Field patch: which fields to set for each action
// ============================================================
export interface AttendanceFieldPatch {
  status: AttendanceStatus
  clock_in_at?: string
  break_start_at?: string
  break_end_at?: string | null
  clock_out_at?: string
  completed_break_minutes?: number
  previous_breaks?: BreakSpan[]
}

/** Yeni mola başlarken önceki molayı biriktirmek için gereken alanlar */
export type BreakFields = Pick<AttendanceTimes, 'break_start_at' | 'break_end_at' | 'completed_break_minutes' | 'previous_breaks'>

export function buildFieldPatch(
  currentStatus: AttendanceStatus,
  action: AttendanceAction,
  now: string,
  record?: BreakFields | null
): AttendanceFieldPatch {
  const nextStatus = applyAction(currentStatus, action)

  switch (action) {
    case 'clock_in':
      return { status: nextStatus, clock_in_at: now }
    case 'start_break': {
      // İkinci ve sonraki molalar: önceki molanın süresi biriktirilir,
      // break_start_at / break_end_at yeni molayı gösterir.
      const prevBreak = record ? diffMinutes(record.break_start_at, record.break_end_at) : null
      if (record && prevBreak !== null) {
        return {
          status: nextStatus,
          break_start_at: now,
          break_end_at: null,
          completed_break_minutes: (record.completed_break_minutes ?? 0) + prevBreak,
          // Biten molanın saatleri gösterim için saklanır (kolon yoksa — migration öncesi — yazılmaz)
          ...(Array.isArray(record.previous_breaks) && {
            previous_breaks: [...record.previous_breaks, { start_at: record.break_start_at!, end_at: record.break_end_at! }],
          }),
        }
      }
      return { status: nextStatus, break_start_at: now }
    }
    case 'end_break':
      return { status: nextStatus, break_end_at: now }
    case 'clock_out':
      return { status: nextStatus, clock_out_at: now }
  }
}
