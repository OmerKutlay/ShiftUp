/**
 * workforcePlanPayload — otomatik haftalık plan: sunucunun topladığı veri paketi ve planın
 * TARAYICIDA üretimi (saf; sunucu ve istemcide çalışır).
 *
 * Planlayıcı (runPlanner) çok sayıda deneme yapar ve ~100+ ms CPU harcar; Workers ücretsiz
 * planında (istek başına 10 ms) 1102'ye yol açıyordu. Sunucu yalnızca aktif mağazanın verisini
 * toplar (GET /api/workforce/plan-input); plan ve ek uyarılar burada hesaplanır.
 * Taslağın onayı (POST /api/workforce/apply) her atamayı sunucuda yeniden doğrular.
 */
import { runPlanner } from './workforcePlanner'
import type { PlannerEmployee, PlannerInput, PlannerResult, PlannerShiftTemplate } from './workforcePlanner'
import type { PublicHoliday } from '@/types/holiday'

type DaySetKey = 'leaveDays' | 'paidLeaveDays' | 'pendingLeaveDays'

/** JSON'a uygun çalışan: gün kümeleri dizi olarak taşınır */
export type PlanPayloadEmployee = Omit<PlannerEmployee, DaySetKey> & {
  leaveDays: string[]
  paidLeaveDays: string[]
  pendingLeaveDays: string[]
}

export interface PlanPayload {
  weekStart: string
  weekEnd: string
  weekDays: string[]
  /** Bugünden önceki günler kapalıdır (yeni atama yapılmaz) */
  today: string
  employees: PlanPayloadEmployee[]
  templates: PlannerShiftTemplate[]
  fixedAssignments: NonNullable<PlannerInput['fixedAssignments']>
  /** Haftadaki resmi tatiller (ulusal + mağaza) — uyarılar için */
  holidays: Array<Pick<PublicHoliday, 'date' | 'name' | 'half_day'>>
}

export function toPayloadEmployee(e: PlannerEmployee): PlanPayloadEmployee {
  return {
    ...e,
    leaveDays: [...e.leaveDays],
    paidLeaveDays: [...(e.paidLeaveDays ?? e.leaveDays)],
    pendingLeaveDays: [...(e.pendingLeaveDays ?? [])],
  }
}

function fromPayloadEmployee(e: PlanPayloadEmployee): PlannerEmployee {
  return {
    ...e,
    leaveDays: new Set(e.leaveDays),
    paidLeaveDays: new Set(e.paidLeaveDays),
    pendingLeaveDays: new Set(e.pendingLeaveDays),
  }
}

/**
 * Veri paketinden taslak plan üretir. Her çağrı farklı bir varyasyon üretir; aynı planı
 * tekrar üretmek için seed verilebilir.
 *
 * Ek uyarılar (planlayıcının dışında):
 *   - (bilgi) Bekleyen izin talebi olan güne atama — planlayıcı yalnızca gerekirse yazar
 *   - Resmi tatil / arife (13:00 sonrası) günlerine atama — çalışan onayı ve 2 kat ücret (Md. 44, 47)
 */
export function buildPlan(payload: PlanPayload, seed = Math.floor(Math.random() * 2 ** 31)): PlannerResult {
  const employees = payload.employees.map(fromPayloadEmployee)
  const result = runPlanner({
    weekStart: payload.weekStart,
    weekEnd: payload.weekEnd,
    weekDays: payload.weekDays,
    employees,
    templates: payload.templates,
    fixedAssignments: payload.fixedAssignments,
    today: payload.today,
    seed,
  })

  // Planlayıcı bekleyen izin gününü yalnızca kapsama veya FT 45 saat için gerekirse doldurur
  const pendingOf = new Map(employees.map((e) => [e.id, e.pendingLeaveDays]))
  for (const a of result.assignments) {
    if (pendingOf.get(a.employee_id)?.has(a.work_date)) {
      result.warnings.push({
        level: 'info',
        message: `${a.employee_name}: ${a.work_date} için bekleyen izin talebi var; kapsama/45 saat için bu gün de planlandı. `
          + 'Talep onaylanırsa vardiya kaldırılır.',
      })
    }
  }

  // Resmi tatil: tam gün → tüm vardiyalar; arife → 13:00 sonrasına taşan vardiyalar
  for (const h of payload.holidays) {
    const names = result.assignments
      .filter((a) => a.work_date === h.date && (!h.half_day || a.end_time.slice(0, 5) > '13:00' || a.end_time.slice(0, 5) <= a.start_time.slice(0, 5)))
      .map((a) => a.employee_name)
    if (names.length === 0) continue
    result.warnings.push({
      level: 'warning',
      message: `${h.date} ${h.name}${h.half_day ? ' (arife, 13:00 sonrası)' : ''}: resmi tatilde ${names.length} çalışan planlandı (${names.join(', ')}). `
        + 'Sözleşmede hüküm yoksa çalışanın onayı gerekir; tatil çalışması 2 kat ücretlenir (İş Kanunu Md. 44, 47).',
    })
  }

  return result
}
