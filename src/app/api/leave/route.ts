/**
 * GET    /api/leave          — İzin talepleri (employee join'li)
 *        ?status=&employee_id=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *        Yöneticiler tümünü görür. Standart çalışan kendi taleplerini + başkalarının
 *        yalnızca ONAYLI izinlerini (gerekçe/not gizli) görür.
 * POST   /api/leave          — Yeni izin talebi oluştur
 * DELETE /api/leave?id=...   — İzin talebini sil (yönetici; çalışan yalnızca kendi bekleyen talebini)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateLeaveRequestPayload, LeaveType } from '@/types/leave'
import { LEAVE_TYPE_LABELS } from '@/types/leave'
import { createNotification, notifyManagers } from '@/lib/notificationRepository'
import { requireAuth, canAccessEmployee, MANAGER_ROLES, requireMinRole, ACCESS, hasRole, forbidden } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidDate } from '@/lib/validation'
import { turkeyToday, addDaysToDateString } from '@/lib/dateUtils'
import { removePlannedShiftsInRange } from '@/lib/leaveService'
import { getAnnualLeaveBalance, requestedLeaveDays } from '@/lib/annualLeaveService'
import { logAudit } from '@/lib/auditLog'

const VALID_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other', 'weekly_rest']
/** Çalışanın kendi adına açabileceği tipler (weekly_rest sadece manager atayabilir) */
const EMPLOYEE_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other']
const VALID_STATUSES = ['pending', 'approved', 'rejected']
/** Geriye dönük hastalık izni en fazla bu kadar gün öncesine açılabilir */
const MAX_SICK_BACKDATE_DAYS = 30

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

    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) return badRequest('Geçersiz durum filtresi.')
    if (employeeId && !isUuid(employeeId)) return badRequest('Geçersiz çalışan ID.')
    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) return badRequest('Geçersiz tarih aralığı.')

    const admin = createAdminClient()

    let query = admin
      .from('leave_requests')
      .select(`
        id, employee_id, leave_type, start_date, end_date,
        reason, status, reviewer_note, reviewed_at, created_at, updated_at,
        employees!employee_id ( id, full_name, roles ( name ) )
      `)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (employeeId) query = query.eq('employee_id', employeeId)
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
        .map((r) => (r.employee_id === selfId ? r : { ...r, reason: null, reviewer_note: null }))
    }

    return NextResponse.json({ requests })
  } catch (err) {
    return serverError('GET /api/leave', err)
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await readJson<Partial<CreateLeaveRequestPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (!isUuid(body.employee_id)) return badRequest('employee_id zorunludur.')

    // Authorization: weekly_rest yalnızca manager+ atayabilir; diğerleri kendi adına veya manager+
    const isWeeklyRest = body.leave_type === 'weekly_rest'
    let actorId: string
    if (isWeeklyRest) {
      const managerAuth = await requireMinRole(req, ACCESS.MANAGER)
      if ('response' in managerAuth) return managerAuth.response
      actorId = managerAuth.employee.id
    } else {
      const accessCheck = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
      if ('response' in accessCheck) return accessCheck.response
      actorId = accessCheck.employee.id
    }

    if (!body.leave_type || !VALID_LEAVE_TYPES.includes(body.leave_type)) {
      return badRequest('Geçersiz izin tipi.')
    }
    if (!isWeeklyRest && !EMPLOYEE_LEAVE_TYPES.includes(body.leave_type)) {
      return forbidden('Bu izin tipini kendiniz oluşturamazsınız.')
    }
    if (!isValidDate(body.start_date)) return badRequest('start_date YYYY-MM-DD formatında olmalıdır.')
    if (!isValidDate(body.end_date)) return badRequest('end_date YYYY-MM-DD formatında olmalıdır.')
    if (body.start_date > body.end_date) return badRequest('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
    if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 500)) {
      return badRequest('Açıklama en fazla 500 karakter olabilir.')
    }

    // Geçmişe dönük talep — hastalık izni (sınırlı) ve haftalık tatil hariç (Türkiye tarihi)
    const today = turkeyToday()
    if (body.start_date < today) {
      if (body.leave_type === 'sick') {
        if (body.start_date < addDaysToDateString(today, -MAX_SICK_BACKDATE_DAYS)) {
          return badRequest(`Hastalık izni en fazla ${MAX_SICK_BACKDATE_DAYS} gün geriye dönük açılabilir.`)
        }
      } else if (body.leave_type !== 'weekly_rest') {
        return badRequest('Geçmiş tarih için izin talebi oluşturulamaz (hastalık izni hariç).')
      }
    }
    const diffDays = (Date.parse(body.end_date) - Date.parse(body.start_date)) / 86400000
    if (diffDays > 30) return badRequest('Tek talep en fazla 30 gün olabilir.')

    const admin = createAdminClient()

    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', body.employee_id)
      .maybeSingle()
    if (empErr) return serverError('POST /api/leave', empErr)
    if (!emp) return notFound('Çalışan bulunamadı.', 'EMPLOYEE_NOT_FOUND')
    if (!emp.active) {
      return NextResponse.json({ error: 'Pasif çalışan izin talebi oluşturamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    // Yıllık izin bakiyesi (Md. 53) — çalışan aşamaz; yönetici avans izin için açıkça onaylayabilir
    if (body.leave_type === 'annual') {
      const balance = await getAnnualLeaveBalance(admin, body.employee_id)
      if (balance.known) {
        const requested = await requestedLeaveDays(admin, body.start_date, body.end_date)
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
      .select('id')
      .eq('employee_id', body.employee_id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', body.end_date)
      .gte('end_date', body.start_date)
      .limit(1)
    if (ovErr) return serverError('POST /api/leave', ovErr)
    if (overlapping && overlapping.length > 0) {
      return conflict('Bu tarih aralığında zaten onaylı veya bekleyen bir izin talebi mevcut.', 'LEAVE_CONFLICT')
    }

    const { data, error } = await admin
      .from('leave_requests')
      .insert({
        employee_id: body.employee_id,
        leave_type: body.leave_type,
        start_date: body.start_date,
        end_date: body.end_date,
        reason: body.reason?.trim() || null,
        // weekly_rest manager tarafından atanır → doğrudan onaylı, onay akışına girmez
        status: isWeeklyRest ? 'approved' : 'pending',
        reviewed_at: isWeeklyRest ? new Date().toISOString() : null,
        reviewed_by: isWeeklyRest ? actorId : null,
      })
      .select()
      .single()

    if (error) {
      // 23P01: exclusion constraint (eşzamanlı çakışan talep)
      if (error.code === '23P01') {
        return conflict('Bu tarih aralığında zaten onaylı veya bekleyen bir izin talebi mevcut.', 'LEAVE_CONFLICT')
      }
      return serverError('POST /api/leave', error)
    }

    // weekly_rest: o günlerin planlanmış vardiyaları kaldırılır (çalışılmış olanlar korunur)
    let cleanup = { removed: 0, keptWorked: 0 }
    if (isWeeklyRest) {
      cleanup = await removePlannedShiftsInRange(admin, body.employee_id, body.start_date, body.end_date)
      await logAudit({
        actorId,
        action: 'leave.weekly_rest.assign',
        entityType: 'leave_request',
        entityId: data.id,
        after: { employee_id: body.employee_id, start_date: body.start_date, end_date: body.end_date, ...cleanup },
      })
    }

    try {
      if (isWeeklyRest) {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_approved',
          title: 'Haftalık tatil atandı',
          message: `${body.start_date} – ${body.end_date} tarihli haftalık tatil planınıza eklendi.`,
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
          {
            type: 'leave_submitted',
            title: 'Yeni izin talebi',
            message: `${emp.full_name} — ${LEAVE_TYPE_LABELS[body.leave_type]}: ${body.start_date} – ${body.end_date} tarihleri için onay bekliyor.`,
            related_id: data.id,
          },
          { excludeEmployeeId: actorId },
        )
      }
    } catch (notifErr) {
      console.error('[POST /api/leave] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: data, kept_worked_shifts: cleanup.keptWorked }, { status: 201 })
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

    const admin = createAdminClient()

    const { data: existing, error: exErr } = await admin
      .from('leave_requests')
      .select('id, employee_id, status, leave_type, start_date, end_date')
      .eq('id', id)
      .maybeSingle()
    if (exErr) return serverError('DELETE /api/leave', exErr)
    if (!existing) return notFound('İzin talebi bulunamadı.')

    // Çalışan yalnızca kendi bekleyen talebini geri çekebilir
    if (!isManager && !(existing.employee_id === auth.employee.id && existing.status === 'pending')) {
      return forbidden('Yalnızca kendi bekleyen talebinizi geri çekebilirsiniz.')
    }

    const { error } = await admin.from('leave_requests').delete().eq('id', id)
    if (error) return serverError('DELETE /api/leave', error)

    await logAudit({
      actorId: auth.employee.id,
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
