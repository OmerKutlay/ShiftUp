/**
 * GET   /api/open-shifts?status=open|filled|cancelled&date=YYYY-MM-DD
 * POST  /api/open-shifts   — yönetimsel: open shift oluştur
 * PATCH /api/open-shifts   — yönetimsel: open shift güncelle / iptal et / yeniden aç
 *
 * Hepsi aktif mağaza kapsamındadır (open_shifts.store_id); bildirim hedefleri de yalnızca o mağazanın çalışanlarıdır.
 *
 * GET:   requireAuth (tüm authenticated kullanıcılar görebilir)
 * POST:  requireMinRole(Müdür Yardımcısı) → mağazanın aktif 'Çalışan' rolündekilerine toplu bildirim
 * PATCH: requireMinRole(Müdür Yardımcısı) — yalnızca open ↔ cancelled geçişi;
 *        doldurulmuş (filled) vardiya değiştirilemez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateOpenShiftPayload } from '@/types/workforce'
import { requireAuth, requireMinRole, ACCESS } from '@/lib/auth'
import { accessLevelOf } from '@/lib/auth/roles'
import { createNotifications } from '@/lib/notificationRepository'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidDate, isValidTime } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { matchesRoleNeeded } from '@/lib/openShiftEligibility'
import { roleNameOf } from '@/lib/roleJoin'

const STATUSES = ['open', 'filled', 'cancelled']

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const status = req.nextUrl.searchParams.get('status')
    const date = req.nextUrl.searchParams.get('date')
    if (status && !STATUSES.includes(status)) return badRequest('Geçersiz durum filtresi.')
    if (date && !isValidDate(date)) return badRequest('Geçersiz tarih.')

    const admin = createAdminClient()
    let query = admin
      .from('open_shifts')
      .select(`*, filled_by_employee:employees!filled_by(id, full_name)`)
      .eq('store_id', auth.employee.store_id)
      .order('work_date')
      .order('start_time')

    if (status) query = query.eq('status', status)
    if (date) query = query.eq('work_date', date)

    const { data, error } = await query
    if (error) return serverError('GET /api/open-shifts', error)
    return NextResponse.json({ open_shifts: data ?? [] })
  } catch (err) {
    return serverError('GET /api/open-shifts', err)
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<Partial<CreateOpenShiftPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (!isValidDate(body.work_date)) return badRequest('Geçerli work_date zorunludur (YYYY-MM-DD).')
    if (body.work_date < turkeyToday()) return badRequest('Geçmiş tarih için açık vardiya oluşturulamaz.')
    if (!isValidTime(body.start_time) || !isValidTime(body.end_time)) {
      return badRequest('start_time ve end_time HH:MM formatında zorunludur.')
    }
    // Bitiş başlangıçtan önceyse gece yarısını geçen vardiyadır; eşitlik geçersiz
    if (body.start_time.slice(0, 5) === body.end_time.slice(0, 5)) {
      return badRequest('Başlangıç ve bitiş saati aynı olamaz.')
    }
    if (body.role_needed != null && (typeof body.role_needed !== 'string' || body.role_needed.length > 80)) {
      return badRequest('Pozisyon en fazla 80 karakter olabilir.')
    }
    if (body.description != null && (typeof body.description !== 'string' || body.description.length > 500)) {
      return badRequest('Açıklama en fazla 500 karakter olabilir.')
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('open_shifts')
      .insert({
        store_id: auth.employee.store_id,
        work_date: body.work_date,
        start_time: body.start_time.slice(0, 5),
        end_time: body.end_time.slice(0, 5),
        role_needed: body.role_needed?.trim() || null,
        description: body.description?.trim() || null,
        status: 'open',
      })
      .select()
      .single()
    if (error) return serverError('POST /api/open-shifts', error)

    // Vardiyayı üstlenebilecek çalışanlara tek toplu insert ile bildirim:
    // gerekli rol varsa o rol (yetki seviyesinden bağımsız), yoksa 'Çalışan' yetkisindekiler
    try {
      const shift = data
      const dateLabel = format(new Date(`${shift.work_date}T12:00:00`), 'd MMMM yyyy EEEE', { locale: tr })
      const timeLabel = `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}`
      const roleLabel = shift.role_needed ? ` (${shift.role_needed})` : ''

      const { data: employees } = await admin
        .from('employees')
        .select('id, roles(name, access_level)')
        .eq('store_id', auth.employee.store_id)
        .eq('active', true)

      const targets = (employees ?? []).filter((emp) => {
        const level = accessLevelOf(emp.roles)
        if (level === ACCESS.KIOSK) return false
        return shift.role_needed
          ? matchesRoleNeeded(shift.role_needed, roleNameOf(emp))
          : level === ACCESS.EMPLOYEE
      })
      await createNotifications(
        admin,
        targets.map((emp) => ({
          employee_id: emp.id as string,
          type: 'open_shift_available' as const,
          title: 'Yeni Açık Vardiya',
          message: `${dateLabel} tarihinde ${timeLabel}${roleLabel} için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.`,
          related_id: shift.id,
        }))
      )
    } catch (notifErr) {
      console.error('[POST /api/open-shifts] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ open_shift: data }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/open-shifts', err)
  }
}

// ─── PATCH ───────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<{ id?: string; status?: string; role_needed?: string | null; description?: string | null }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (!isUuid(body.id)) return badRequest('id zorunludur.')
    if (body.status !== undefined && body.status !== 'open' && body.status !== 'cancelled') {
      return badRequest("status yalnızca 'open' veya 'cancelled' olabilir.")
    }

    const admin = createAdminClient()
    const { data: current, error: curErr } = await admin
      .from('open_shifts')
      .select('id, status')
      .eq('id', body.id)
      .eq('store_id', auth.employee.store_id)
      .maybeSingle()
    if (curErr) return serverError('PATCH /api/open-shifts', curErr)
    if (!current) return notFound('Açık vardiya bulunamadı.')
    if (current.status === 'filled') return conflict('Doldurulmuş bir vardiya değiştirilemez.')

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status) patch.status = body.status
    if (body.role_needed !== undefined) patch.role_needed = body.role_needed?.toString().trim().slice(0, 80) || null
    if (body.description !== undefined) patch.description = body.description?.toString().trim().slice(0, 500) || null

    // Durum hâlâ okunduğu gibiyse uygula (eşzamanlı claim ile yarış önlemi)
    const { data, error } = await admin
      .from('open_shifts')
      .update(patch)
      .eq('id', body.id)
      .eq('store_id', auth.employee.store_id)
      .eq('status', current.status)
      .select()
      .maybeSingle()
    if (error) return serverError('PATCH /api/open-shifts', error)
    if (!data) return conflict('Vardiya bu sırada güncellendi; sayfayı yenileyin.')
    return NextResponse.json({ open_shift: data })
  } catch (err) {
    return serverError('PATCH /api/open-shifts', err)
  }
}
