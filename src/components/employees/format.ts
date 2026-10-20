/**
 * Çalışanlar sayfası ve formu için ortak etiketler / biçimlendirme (yalnızca gösterim).
 */
import { differenceInMonths, format } from 'date-fns'
import { tr } from 'date-fns/locale'

import type { EmploymentType, Role } from '@/types/employee'
import { PART_TIME_RULES } from '@/types/employee'
import { ACCESS_LABELS, PLANNING_GROUP_LABELS } from '@/lib/auth/roles'

/** Cümle düzeninde çalışma tipi etiketleri (EMPLOYMENT_TYPE_LABELS ile aynı anlam) */
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Tam zamanlı',
  part_time: 'Yarı zamanlı',
}

export const EMPLOYMENT_HINTS: Record<EmploymentType, string> = {
  full_time: 'Haftada 45 saate kadar',
  part_time: `Haftada en fazla ${PART_TIME_RULES.maxWeeklyDays} gün ve ${PART_TIME_RULES.maxWeeklyHours} saat`,
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)

/** '2016-09-05' → '5 Eyl 2016' */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = day(iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'd MMM yyyy', { locale: tr })
}

/** İşe girişten bugüne kıdem: '9 yıl 1 ay', '4 ay', '1 aydan az' */
export function tenureLabel(hireDate: string | null | undefined, now = new Date()): string | null {
  if (!hireDate) return null
  const d = day(hireDate)
  if (Number.isNaN(d.getTime()) || d > now) return null
  const months = differenceInMonths(now, d)
  if (months < 1) return '1 aydan az'
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} ay`
  return m === 0 ? `${y} yıl` : `${y} yıl ${m} ay`
}

/** Rolün yetki ve planlama özeti: 'Çalışan yetkisi · Kasiyer olarak planlanır' */
export function roleSummary(role: Pick<Role, 'access_level' | 'planning_group'>): string {
  const access = `${ACCESS_LABELS[role.access_level]} yetkisi`
  const planning = role.planning_group
    ? `${PLANNING_GROUP_LABELS[role.planning_group]} olarak planlanır`
    : 'Vardiya planına girmez'
  return `${access} · ${planning}`
}
