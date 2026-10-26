/**
 * GET /api/audit-logs?limit=50&before=<ISO>&entity_type=...&action=...
 * Denetim kaydı (salt okunur) — Mağaza Müdürü+. Yeniden eskiye, imleçli sayfalama.
 * Yalnızca aktif mağazanın kayıtları (audit_logs.store_id) döner.
 *
 * Kayıtlar ham id'ler içerir; son kullanıcıya isim gösterebilmek için yanıt şunlarla zenginleştirilir:
 *   - her log için `subject_ids`: işlemin ilgili olduğu çalışan(lar)
 *   - sayfa için `refs`: { employees: id → ad, roles: id → ad }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'

interface RawLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  [k: string]: unknown
}

type Admin = ReturnType<typeof createAdminClient>

/** id → satır sorgusu; boş listede DB'ye gitmez */
async function rowsById<T>(admin: Admin, table: string, cols: string, ids: Set<string>): Promise<T[]> {
  if (ids.size === 0) return []
  const { data, error } = await admin.from(table).select(cols).in('id', [...ids])
  if (error) throw error
  return (data ?? []) as T[]
}

const strId = (v: unknown): string | null => (typeof v === 'string' && isUuid(v) ? v : null)

async function enrich(admin: Admin, logs: RawLog[]) {
  // Her log'un ilgili çalışanı ya before/after.employee_id'de ya da kaydın kendisinde (entity) durur
  const byEntity: Record<string, Set<string>> = {
    attendance_record: new Set(), leave_request: new Set(), time_correction_request: new Set(), shift_swap_request: new Set(),
  }
  const empIds = new Set<string>()
  const roleIds = new Set<string>()
  for (const l of logs) {
    for (const side of [l.before, l.after]) {
      const e = strId(side?.employee_id); if (e) empIds.add(e)
      const r = strId(side?.role_id); if (r) roleIds.add(r)
    }
    const eid = strId(l.entity_id)
    if (!eid) continue
    if (l.entity_type === 'employee') empIds.add(eid)
    else if (byEntity[l.entity_type]) byEntity[l.entity_type].add(eid)
  }

  type EmpRef = { id: string; employee_id: string }
  const [att, leave, tcr, swaps] = await Promise.all([
    rowsById<EmpRef>(admin, 'attendance_records', 'id, employee_id', byEntity.attendance_record),
    rowsById<EmpRef>(admin, 'leave_requests', 'id, employee_id', byEntity.leave_request),
    rowsById<EmpRef>(admin, 'manual_time_correction_requests', 'id, employee_id', byEntity.time_correction_request),
    rowsById<{ id: string; requester_id: string; target_id: string | null }>(
      admin, 'shift_swap_requests', 'id, requester_id, target_id', byEntity.shift_swap_request),
  ])
  const entitySubjects = new Map<string, string[]>()
  for (const r of [...att, ...leave, ...tcr]) entitySubjects.set(r.id, [r.employee_id])
  for (const s of swaps) entitySubjects.set(s.id, [s.requester_id, ...(s.target_id ? [s.target_id] : [])])
  for (const ids of entitySubjects.values()) ids.forEach((id) => empIds.add(id))

  const [emps, roles] = await Promise.all([
    rowsById<{ id: string; full_name: string }>(admin, 'employees', 'id, full_name', empIds),
    rowsById<{ id: string; name: string }>(admin, 'roles', 'id, name', roleIds),
  ])

  const withSubjects = logs.map((l) => {
    const eid = strId(l.entity_id)
    const fromEntity = eid ? (l.entity_type === 'employee' ? [eid] : entitySubjects.get(eid) ?? []) : []
    const fromData = [strId(l.before?.employee_id), strId(l.after?.employee_id)].filter((x): x is string => !!x)
    return { ...l, subject_ids: [...new Set([...fromEntity, ...fromData])] }
  })

  return {
    logs: withSubjects,
    refs: {
      employees: Object.fromEntries(emps.map((e) => [e.id, e.full_name])),
      roles: Object.fromEntries(roles.map((r) => [r.id, r.name])),
    },
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200)
  const before = sp.get('before')
  const entityType = sp.get('entity_type')
  const action = sp.get('action')
  if (before && Number.isNaN(Date.parse(before))) return badRequest('Geçersiz before.')
  if (entityType && !/^[a-z_]{1,40}$/.test(entityType)) return badRequest('Geçersiz entity_type.')
  if (action && !/^[a-z_.]{1,60}$/.test(action)) return badRequest('Geçersiz action.')

  try {
    const admin = createAdminClient()
    let query = admin
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, before, after, note, created_at, actor:employees!actor_id ( id, full_name )')
      .eq('store_id', auth.employee.store_id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (before) query = query.lt('created_at', before)
    if (entityType) query = query.eq('entity_type', entityType)
    if (action) query = query.like('action', `${action}%`)

    const { data, error } = await query
    if (error) return serverError('GET /api/audit-logs', error)
    const raw = (data ?? []) as unknown as RawLog[]

    // İsim çözümlemesi başarısız olursa kayıtlar yine de (isimsiz) gösterilsin
    let enriched: Awaited<ReturnType<typeof enrich>>
    try {
      enriched = await enrich(admin, raw)
    } catch (err) {
      console.error('[GET /api/audit-logs] isim çözümlemesi başarısız:', err)
      enriched = { logs: raw.map((l) => ({ ...l, subject_ids: [] })), refs: { employees: {}, roles: {} } }
    }

    return NextResponse.json({
      ...enriched,
      next_before: raw.length === limit ? (raw[raw.length - 1].created_at as string) : null,
    })
  } catch (err) {
    return serverError('GET /api/audit-logs', err)
  }
}
