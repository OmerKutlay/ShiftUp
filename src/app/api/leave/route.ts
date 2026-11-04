/**
 * GET    /api/leave          — Aktif mağazanın çalışanlarının izin talepleri (employee join'li)
 *        ?status=&employee_id=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *        Yöneticiler tümünü görür. Standart çalışan kendi taleplerini + başkalarının
 *        yalnızca ONAYLI izinlerini (gerekçe/not gizli) görür.
 * POST   /api/leave          — Yeni izin talebi oluştur. Tür: leave_type_def_id (adlandırılmış tür) ya da
 *        leave_type ('weekly_rest' / eski istemcide temel tür). approve=true → yönetici planda doğrudan
 *        onaylı izin verir (kendine değil; onay akışıyla aynı yetki kuralları)
 *        weekly_rest + recurring=true → o gün her hafta tatil (tekrarlayan; bkz. lib/recurringRest);
 *        recurring_until=YYYY-MM-DD → tekrar o güne kadar (dahil; ör. 3 ay, 8 hafta), yoksa süresiz
 * DELETE /api/leave?id=...   — İzin talebini sil (yönetici; çalışan yalnızca kendi bekleyen talebini)
 *        &scope=following    — tekrarlayan tatilde bu ve sonraki haftaların tatilleri silinir
 *
 * Tekrarlayan tatil günü, çalışanın izin talebine engel olmaz: talep aralığındaki tekrarlar kaldırılır,
 * talep reddedilir ya da silinirse geri yazılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateLeaveRequestPayload, LeaveType, LeaveTypeDefinition } from '@/types/leave'
import { LEAVE_TYPE_LABELS } from '@/types/leave'
import { getLeaveType, systemLeaveType } from '@/lib/leaveTypeRepository'
import { createNotification, notifyManagers } from '@/lib/notificationRepository'
import {
  requireAuth,
  canAccessEmployee,
  MANAGER_ROLES,
  requireMinRole,
  ACCESS,
  hasRole,
  forbidden,
  forbidIfOutranked,
} from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimiter'
import { badRequest, conflict, notFound, readJson, serverError, tooManyRequests } from '@/lib/apiErrors'
import { isUuid, isValidDate } from '@/lib/validation'
import { turkeyToday, addDaysToDateString, mondayOfDateString } from '@/lib/dateUtils'
import { removePlannedShiftsInRange } from '@/lib/leaveService'
import { getAnnualLeaveBalance, requestedLeaveDays } from '@/lib/annualLeaveService'
import { logAudit } from '@/lib/auditLog'
import { isEmployeeInStore, storeEmployeeIds } from '@/lib/storeScope'
import {
  endRecurringRest, everyWeekdayLabel, materializeRecurringRest, restoreRecurringRests, weekdayOf, WEEKDAY_NAMES_TR,
} from '@/lib/recurringRest'
import { MAX_REPEAT_DAYS } from '@/lib/restRepeat'

const VALID_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other', 'public_holiday', 'weekly_rest']
const VALID_STATUSES = ['pending', 'approved', 'rejected']
/** Geriye dönük hastalık izni en fazla bu kadar gün öncesine açılabilir */
const MAX_SICK_BACKDATE_DAYS = 30
/** Kişi başına saatlik izin talebi sınırı (haftalık tatil hariç) */
const CREATE_RATE_LIMIT = 20
const CREATE_RATE_WINDOW_MS = 60 * 60 * 1000

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const isManager = hasRole(auth.employee.access_level, MANAGER_ROLES)

  try {
    const sp = req.nextUrl.searchParams
    const statusFilter = sp.get('status')
    const employeeId = sp.get('employee_id')
    const from = sp.get('from')
    const to = sp.get('to')
    // ?exclude_type=weekly_rest → İzinler sayfası haftalık tatilleri listelemez (planla birlikte
    // her hafta birikirler; hafta tatilleri Haftalık plan'da yönetilir)
    const excludeType = sp.get('exclude_type')

    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) return badRequest('Geçersiz durum filtresi.')
    if (employeeId && !isUuid(employeeId)) return badRequest('Geçersiz çalışan ID.')
    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) return badRequest('Geçersiz tarih aralığı.')
    if (excludeType && !VALID_LEAVE_TYPES.includes(excludeType as LeaveType)) return badRequest('Geçersiz izin tipi.')

    const admin = createAdminClient()

    // Mağaza kapsamı: yalnızca aktif mağazanın çalışanlarının talepleri
    const storeIds = await storeEmployeeIds(auth.employee.store_id)
    if (storeIds.length === 0) return NextResponse.json({ requests: [] })

    let query = admin
      .from('leave_requests')
      .select(`
        id, employee_id, leave_type, leave_type_def_id, start_date, end_date, recurrence_id,
        reason, status, reviewer_note, reviewed_at, created_at, updated_at,
        employees!employee_id ( id, full_name, roles ( name ) )
      `)
      .in('employee_id', storeIds)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (employeeId) query = query.eq('employee_id', employeeId)
    // Standart çalışanda tür filtresi maskelemeden SONRA uygulanır (aşağıda); sorguda uygulansaydı
    // filtreli/filtresiz iki cevabın farkı başkasının maskelenmiş hastalık iznini ele verirdi
    if (excludeType && isManager) query = query.neq('leave_type', excludeType)
    // Aralıkla kesişen izinler
    if (to) query = query.lte('start_date', to)
    if (from) query = query.gte('end_date', from)

    const { data, error } = await query
    if (error) return serverError('GET /api/leave', error)

    let requests = (data ?? []) as Array<Record<string, unknown>>
    if (!isManager) {
      const selfId = auth.employee.id
      requests = requests
        .filter((r) => r.employee_id === selfId || r.status === 'approved')
        // Başkasının hastalık izni sağlık verisidir (KVKK özel nitelikli) — tür "diğer" olarak gösterilir,
        // türün adı da (tanım) gizlenir
        .map((r) =>
          r.employee_id === selfId
            ? r
            : r.leave_type === 'sick'
              ? { ...r, reason: null, reviewer_note: null, leave_type: 'other', leave_type_def_id: null }
              : { ...r, reason: null, reviewer_note: null }
        )
      if (excludeType) requests = requests.filter((r) => r.leave_type !== excludeType)
    }

    return NextResponse.json({ requests })
  } catch (err) {
    return serverError('GET /api/leave', err)
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await readJson<Partial<CreateLeaveRequestPayload> & { recurring?: unknown; recurring_until?: unknown; approve?: unknown }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (!isUuid(body.employee_id)) return badRequest('employee_id zorunludur.')

    // Authorization: weekly_rest ve planda doğrudan onaylı izin (approve=true) yalnızca manager+;
    // diğer talepler kendi adına veya manager+
    const isWeeklyRest = body.leave_type === 'weekly_rest'
    const direct = !isWeeklyRest && body.approve === true
    let actorId: string
    let activeStoreId: string
    let actorIsAdmin = false
    if (isWeeklyRest || direct) {
      const managerAuth = await requireMinRole(req, ACCESS.MANAGER)
      if ('response' in managerAuth) return managerAuth.response
      actorId = managerAuth.employee.id
      activeStoreId = managerAuth.employee.store_id
      actorIsAdmin = managerAuth.employee.access_level === ACCESS.ADMIN
      // Doğrudan onaylı izin, onay akışıyla aynı kural: yönetici kendi iznini onaylayamaz
      if (direct && body.employee_id === actorId) {
        return forbidden('Kendi izninizi onaylayamazsınız; İzinler sayfasından talep oluşturun.')
      }
      // Haftalık tatil / doğrudan izin onaylıdır ve o günün vardiyasını siler: izin onayıyla aynı kural,
      // kendinden yüksek yetkili birine atanamaz
      if (body.employee_id !== actorId) {
        const denied = await forbidIfOutranked(managerAuth.employee, body.employee_id)
        if (denied) return denied
      }
    } else {
      const accessCheck = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
      if ('response' in accessCheck) return accessCheck.response
      actorId = accessCheck.employee.id
      activeStoreId = accessCheck.employee.store_id
    }

    const admin = createAdminClient()

    // Tür: haftalık tatil ya da adlandırılmış tür (leave_type_def_id); eski istemcinin temel türü sistem
    // tanımına bağlanır. Kaydın leave_type'ı her zaman tanımın temel türüdür (puantaj kodu).
    let leaveType: LeaveType
    let def: LeaveTypeDefinition | null = null
    if (isWeeklyRest) {
      leaveType = 'weekly_rest'
    } else if (body.leave_type_def_id !== undefined) {
      if (!isUuid(body.leave_type_def_id)) return badRequest('Geçersiz izin türü.')
      def = await getLeaveType(admin, body.leave_type_def_id)
      if (!def || !def.active) return badRequest('Geçersiz izin türü.')
      leaveType = def.base_type
    } else {
      if (!body.leave_type || !VALID_LEAVE_TYPES.includes(body.leave_type)) return badRequest('Geçersiz izin tipi.')
      def = await systemLeaveType(admin, body.leave_type)
      if (def && !def.active) return badRequest('Bu izin türü artık kullanılmıyor.')
      leaveType = body.leave_type
    }
    // Çalışanın kendi talebi: tür çalışan talebine açık olmalı (resmi tatili yalnızca yönetici atar)
    if (!isWeeklyRest && body.employee_id === actorId) {
      const requestable = def ? def.employee_requestable : leaveType !== 'public_holiday'
      if (!requestable) return forbidden('Bu izin türünü kendiniz talep edemezsiniz.')
    }
    const typeName = def?.name ?? LEAVE_TYPE_LABELS[leaveType]

    // Her talep yöneticilere (push) bildirim gönderir: aç-sil döngüsüyle bildirim yağdırılmasın.
    // Haftalık tatil ve doğrudan izin hariç — yönetici haftalık planda toplu atar.
    if (!isWeeklyRest && !direct) {
      const rate = await checkRateLimit(`leave_create:${actorId}`, CREATE_RATE_LIMIT, CREATE_RATE_WINDOW_MS)
      if (!rate.allowed) return tooManyRequests()
    }
    if (!isValidDate(body.start_date)) return badRequest('start_date YYYY-MM-DD formatında olmalıdır.')
    if (!isValidDate(body.end_date)) return badRequest('end_date YYYY-MM-DD formatında olmalıdır.')
    if (body.start_date > body.end_date) return badRequest('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
    const recurring = body.recurring === true
    if (recurring && (!isWeeklyRest || body.start_date !== body.end_date)) {
      return badRequest('Yalnızca tek günlük haftalık tatil her hafta tekrarlanabilir.')
    }
    // Tekrarın son günü (dahil); yoksa süresiz
    let recurringUntil: string | null = null
    if (body.recurring_until !== undefined && body.recurring_until !== null) {
      if (!recurring) return badRequest('recurring_until yalnızca tekrarlayan tatilde kullanılabilir.')
      if (!isValidDate(body.recurring_until)) return badRequest('recurring_until YYYY-MM-DD formatında olmalıdır.')
      if (body.recurring_until < body.start_date) return badRequest('Tekrarın bitişi başlangıçtan önce olamaz.')
      if (body.recurring_until > addDaysToDateString(body.start_date, MAX_REPEAT_DAYS)) {
        return badRequest('Tekrar en fazla 2 yıl sürebilir.')
      }
      recurringUntil = body.recurring_until
    }
    if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 500)) {
      return badRequest('Açıklama en fazla 500 karakter olabilir.')
    }

    // Geçmişe dönük talep — hastalık izni (sınırlı), haftalık tatil ve planda verilen izin hariç (Türkiye tarihi)
    const today = turkeyToday()
    if (body.start_date < today) {
      const sickInWindow = leaveType === 'sick' && body.start_date >= addDaysToDateString(today, -MAX_SICK_BACKDATE_DAYS)
      if (isWeeklyRest || direct) {
        if (!actorIsAdmin && !sickInWindow) {
          // Geçmiş güne tatil / izin, gelinmemiş bir vardiyayı onaysız izne çevirir.
          // Planlayıcı bu haftanın günlerini düzeltebilir; kendine ve geçmiş haftalara atanamaz.
          if (body.employee_id === actorId) {
            return forbidden('Kendinize geçmiş tarihli haftalık tatil atayamazsınız.')
          }
          if (body.start_date < mondayOfDateString(today)) {
            return badRequest(isWeeklyRest ? 'Haftalık tatil geçmiş haftalara atanamaz.' : 'İzin geçmiş haftalara atanamaz.')
          }
        }
      } else if (leaveType === 'sick') {
        if (!sickInWindow) {
          return badRequest(`Hastalık izni en fazla ${MAX_SICK_BACKDATE_DAYS} gün geriye dönük açılabilir.`)
        }
      } else {
        return badRequest('Geçmiş tarih için izin talebi oluşturulamaz (hastalık izni hariç).')
      }
    }
    const diffDays = (Date.parse(body.end_date) - Date.parse(body.start_date)) / 86400000
    if (diffDays > 30) return badRequest('Tek talep en fazla 30 gün olabilir.')

    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, active, store_id')
      .eq('id', body.employee_id)
      .maybeSingle()
    if (empErr) return serverError('POST /api/leave', empErr)
    // Başkası adına talep yalnızca aktif mağazanın çalışanı için (başka mağaza → 404)
    if (!emp || (emp.id !== actorId && emp.store_id !== activeStoreId)) {
      return notFound('Çalışan bulunamadı.', 'EMPLOYEE_NOT_FOUND')
    }
    if (!emp.active) {
      return NextResponse.json({ error: 'Pasif çalışan izin talebi oluşturamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    // Yıllık izin bakiyesi (Md. 53) — çalışan aşamaz; yönetici avans izin için açıkça onaylayabilir
    if (leaveType === 'annual') {
      const balance = await getAnnualLeaveBalance(admin, body.employee_id)
      if (balance.known) {
        const requested = await requestedLeaveDays(emp.store_id, body.start_date, body.end_date)
        if (requested > balance.remainingDays) {
          const isManagerActor = actorId !== body.employee_id
          const allowExceed = (body as { allow_exceed?: boolean }).allow_exceed === true
          if (!isManagerActor || !allowExceed) {
            return NextResponse.json(
              {
                error: `Yıllık izin bakiyesi yetersiz: talep ${requested} gün, kalan ${Math.max(0, balance.remainingDays)} gün.`,
                code: 'ANNUAL_LEAVE_EXCEEDED',
                balance,
                requested_days: requested,
              },
              { status: 422 }
            )
          }
        }
      }
    }

    // Aynı tarih aralığında çakışan pending/approved talep var mı? (DB'de ayrıca EXCLUDE kısıtı var)
    const { data: overlapping, error: ovErr } = await admin
      .from('leave_requests')
      .select('id, leave_type, recurrence_id')
      .eq('employee_id', body.employee_id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', body.end_date)
      .gte('end_date', body.start_date)
    if (ovErr) return serverError('POST /api/leave', ovErr)
    // İzin talebi tekrarlayan tatil gününe denk gelebilir: o tekrarlar talebe yer açar (aşağıda)
    const yieldingRestIds = isWeeklyRest
      ? []
      : (overlapping ?? []).filter((l) => l.leave_type === 'weekly_rest' && l.recurrence_id).map((l) => l.id as string)
    if ((overlapping ?? []).length > yieldingRestIds.length) {
      return conflict('Bu tarih aralığında zaten onaylı veya bekleyen bir izin talebi mevcut.', 'LEAVE_CONFLICT')
    }

    const { employee_id: employeeId, start_date: startDate, end_date: endDate } = body

    // Tekrarlayan tatil: aynı gün için dönemi çakışan bir kural varsa ikincisi açılmaz
    let ruleId: string | null = null
    if (recurring) {
      const weekday = weekdayOf(startDate)
      const exists = () =>
        conflict(`Bu çalışanın ${WEEKDAY_NAMES_TR[weekday]} günleri bu dönemde zaten her hafta tatil.`, 'RECURRING_REST_EXISTS')
      const { data: rules, error: ruleErr } = await admin
        .from('recurring_weekly_rests')
        .select('id, start_date, end_date')
        .eq('employee_id', employeeId)
        .eq('weekday', weekday)
      if (ruleErr) return serverError('POST /api/leave', ruleErr)
      const overlaps = (r: { start_date: string; end_date: string | null }) =>
        (r.end_date === null || r.end_date >= startDate) && (recurringUntil === null || r.start_date <= recurringUntil)
      if ((rules ?? []).some((r) => overlaps(r as { start_date: string; end_date: string | null }))) return exists()
      const { data: rule, error: insRuleErr } = await admin
        .from('recurring_weekly_rests')
        .insert({
          store_id: emp.store_id,
          employee_id: employeeId,
          weekday,
          start_date: startDate,
          end_date: recurringUntil,
          materialized_until: startDate,   // ilk gün aşağıda bu istekle yazılır
          created_by: actorId,
        })
        .select('id')
        .single()
      if (insRuleErr) return insRuleErr.code === '23505' ? exists() : serverError('POST /api/leave', insRuleErr)
      ruleId = rule.id as string
    }

    if (yieldingRestIds.length > 0) {
      const { error: yieldErr } = await admin.from('leave_requests').delete().in('id', yieldingRestIds)
      if (yieldErr) {
        if (ruleId) await admin.from('recurring_weekly_rests').delete().eq('id', ruleId)
        return serverError('POST /api/leave', yieldErr)
      }
    }
    /** Kayıt başarısızsa açılan kural geri alınır, yer açan tatiller geri yazılır */
    const undo = async () => {
      if (ruleId) await admin.from('recurring_weekly_rests').delete().eq('id', ruleId)
      if (yieldingRestIds.length > 0) await restoreRecurringRests(admin, employeeId, startDate, endDate)
    }

    const { data, error } = await admin
      .from('leave_requests')
      .insert({
        employee_id: body.employee_id,
        leave_type: leaveType,
        leave_type_def_id: def?.id ?? null,
        start_date: body.start_date,
        end_date: body.end_date,
        reason: body.reason?.trim() || null,
        // weekly_rest ve planda verilen izin manager tarafından atanır → doğrudan onaylı, onay akışına girmez
        status: isWeeklyRest || direct ? 'approved' : 'pending',
        reviewed_at: isWeeklyRest || direct ? new Date().toISOString() : null,
        reviewed_by: isWeeklyRest || direct ? actorId : null,
        ...(ruleId ? { recurrence_id: ruleId } : {}),
      })
      .select()
      .single()

    if (error) {
      await undo()
      // 23P01: exclusion constraint (eşzamanlı çakışan talep)
      if (error.code === '23P01') {
        return conflict('Bu tarih aralığında zaten onaylı veya bekleyen bir izin talebi mevcut.', 'LEAVE_CONFLICT')
      }
      return serverError('POST /api/leave', error)
    }

    // weekly_rest: o günlerin planlanmış vardiyaları kaldırılır (çalışılmış olanlar korunur)
    let cleanup = { removed: 0, keptWorked: 0 }
    let repeat: { created: number; skipped: number } | null = null
    if (isWeeklyRest) {
      cleanup = await removePlannedShiftsInRange(admin, body.employee_id, body.start_date, body.end_date)
      // Sonraki haftalar: vardiyası ya da izni olan günler atlanır (yapılmış plan korunur)
      if (ruleId) repeat = await materializeRecurringRest(admin, ruleId)
      await logAudit({
        actorId,
        storeId: emp.store_id,
        action: ruleId ? 'leave.weekly_rest.recurring' : 'leave.weekly_rest.assign',
        entityType: 'leave_request',
        entityId: data.id,
        after: {
          employee_id: body.employee_id, start_date: body.start_date, end_date: body.end_date, ...cleanup,
          ...(ruleId && repeat
            ? { recurrence_id: ruleId, until: recurringUntil, next_weeks: repeat.created, skipped_weeks: repeat.skipped }
            : {}),
        },
      })
    } else if (direct) {
      // Planda verilen izin onaylı izin gibi: aralığın planlanmış vardiyaları kalkar
      cleanup = await removePlannedShiftsInRange(admin, body.employee_id, body.start_date, body.end_date)
      await logAudit({
        actorId,
        storeId: emp.store_id,
        action: 'leave.assign',
        entityType: 'leave_request',
        entityId: data.id,
        after: {
          employee_id: body.employee_id, leave_type: leaveType, leave_type_name: typeName,
          start_date: body.start_date, end_date: body.end_date, ...cleanup,
        },
      })
    }

    try {
      if (direct) {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_approved',
          title: 'İzin atandı',
          message: `${typeName}: ${body.start_date} – ${body.end_date} tarihleri planınıza eklendi.`,
          related_id: data.id,
        })
      } else if (isWeeklyRest) {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_approved',
          title: 'Haftalık tatil atandı',
          message: ruleId
            ? `${everyWeekdayLabel(body.start_date)} haftalık tatiliniz planınıza eklendi (${body.start_date} itibarıyla).`
            : `${body.start_date} – ${body.end_date} tarihli haftalık tatil planınıza eklendi.`,
          related_id: data.id,
        })
      } else {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_submitted',
          title: 'İzin talebiniz alındı',
          message: `${body.start_date} – ${body.end_date} tarihli izin talebiniz incelemeye alındı.`,
          related_id: data.id,
        })
        await notifyManagers(
          admin,
          emp.store_id,
          {
            type: 'leave_submitted',
            title: 'Yeni izin talebi',
            message: `${emp.full_name} — ${typeName}: ${body.start_date} – ${body.end_date} tarihleri için onay bekliyor.`,
            related_id: data.id,
          },
          // Talep sahibi yöneticiyse kendi talebi için yalnızca "talebiniz alındı" bildirimini alır
          { excludeEmployeeId: [actorId, body.employee_id] },
        )
      }
    } catch (notifErr) {
      console.error('[POST /api/leave] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json(
      { request: data, kept_worked_shifts: cleanup.keptWorked, ...(repeat ? { recurring: repeat } : {}) },
      { status: 201 }
    )
  } catch (err) {
    return serverError('POST /api/leave', err)
  }
}

// ─── DELETE ─────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const isManager = hasRole(auth.employee.access_level, MANAGER_ROLES)

  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!isUuid(id)) return badRequest('id parametresi zorunludur.')
    const scope = req.nextUrl.searchParams.get('scope') ?? 'single'
    if (scope !== 'single' && scope !== 'following') return badRequest('Geçersiz kapsam.')

    const admin = createAdminClient()

    const { data: existing, error: exErr } = await admin
      .from('leave_requests')
      .select('id, employee_id, status, leave_type, start_date, end_date, recurrence_id')
      .eq('id', id)
      .maybeSingle()
    if (exErr) return serverError('DELETE /api/leave', exErr)
    if (!existing) return notFound('İzin talebi bulunamadı.')

    // Başka mağazanın çalışanının talebi görünmez (kendi talebi hariç)
    if (
      existing.employee_id !== auth.employee.id &&
      !(await isEmployeeInStore(existing.employee_id, auth.employee.store_id))
    ) {
      return notFound('İzin talebi bulunamadı.')
    }

    // Çalışan yalnızca kendi bekleyen talebini geri çekebilir
    if (!isManager && !(existing.employee_id === auth.employee.id && existing.status === 'pending')) {
      return forbidden('Yalnızca kendi bekleyen talebinizi geri çekebilirsiniz.')
    }
    if (existing.employee_id !== auth.employee.id) {
      const outranked = await forbidIfOutranked(auth.employee, existing.employee_id)
      if (outranked) return outranked
    }

    // Tekrarlayan tatil — "bu ve sonraki haftalar": kural bu günden önce biter
    if (scope === 'following' && existing.leave_type === 'weekly_rest' && existing.recurrence_id) {
      if (!isManager) return forbidden('Yalnızca yönetici tekrarlayan tatili kaldırabilir.')
      const removed = await endRecurringRest(admin, existing.recurrence_id, existing.start_date)
      await logAudit({
        actorId: auth.employee.id,
        storeId: auth.employee.store_id,
        action: 'leave.weekly_rest.recurring_end',
        entityType: 'leave_request',
        entityId: id,
        before: existing,
        after: { removed_days: removed },
      })
      return NextResponse.json({ success: true, removed })
    }

    const { error } = await admin.from('leave_requests').delete().eq('id', id)
    if (error) return serverError('DELETE /api/leave', error)

    // Talebe yer açmak için kaldırılan tekrarlayan tatiller geri gelir
    if (existing.leave_type !== 'weekly_rest' && existing.status !== 'rejected') {
      await restoreRecurringRests(admin, existing.employee_id, existing.start_date, existing.end_date)
    }

    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'leave.delete',
      entityType: 'leave_request',
      entityId: id,
      before: existing,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/leave', err)
  }
}
