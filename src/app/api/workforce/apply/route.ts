/**
 * POST /api/workforce/apply
 *
 * Onaylanmış taslak planı Weekly Schedule'a (shift_assignments) yazar.
 * Haftanın mevcut planı YENİ PLANLA DEĞİŞTİRİLİR (üst üste yazılmaz):
 *   - Giriş/çıkış kaydı (attendance_records) olan vardiyalar korunur — silinirse
 *     ON DELETE CASCADE ile mesai kayıtları da silinirdi. Taslaktaki aynı
 *     çalışan+gün ataması atlanır.
 *   - İzinli işaretli (is_on_leave) vardiyalar korunur.
 *   - Diğer tüm vardiyalar silinir.
 * Önce yeni atamalar tek seferde eklenir, sonra eskiler silinir; silme başarısız
 * olursa yeni eklenenler geri alınır. Böylece hafta yarım planla kalmaz.
 * Yalnızca MANAGER_ROLES erişebilir.
 *
 * Body: { assignments: DraftAssignment[], weekStart?: string, weekEnd?: string, hasHardViolation?: boolean }
 * Planda vardiyası olmayan (ve izni olmayan) çalışan günleri haftalık tatil (weekly_rest) olarak işaretlenir.
 *
 * Response: { created: number, replaced: number, skipped: number, restDays: number, errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'
import type { DraftAssignment } from '@/lib/workforcePlanner'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as {
      assignments?: DraftAssignment[]
      weekStart?: string
      weekEnd?: string
      hasHardViolation?: boolean
    }
    const assignments = body.assignments
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ error: 'assignments dizisi gerekli.' }, { status: 400 })
    }

    // Hard constraint ihlali varsa sunucu tarafında da engelle
    if (body.hasHardViolation === true) {
      return NextResponse.json(
        { error: 'Plan, kritik kural ihlalleri içerdiği için onaylanamaz. Lütfen planı yeniden oluşturun.' },
        { status: 422 }
      )
    }

    // Hafta aralığı: istemciden gelmezse atamaların tarihinden Pzt–Paz türetilir
    const firstDate = assignments.map((a) => a.work_date).reduce((a, b) => (a < b ? a : b))
    const weekStart = body.weekStart && DATE_RE.test(body.weekStart)
      ? body.weekStart
      : format(startOfWeek(new Date(firstDate), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = body.weekEnd && DATE_RE.test(body.weekEnd)
      ? body.weekEnd
      : format(endOfWeek(new Date(firstDate), { weekStartsOn: 1 }), 'yyyy-MM-dd')

    if (assignments.some((a) => a.work_date < weekStart || a.work_date > weekEnd)) {
      return NextResponse.json({ error: 'Atamalar seçili haftanın dışında.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Haftanın mevcut vardiyaları + giriş/çıkış kaydı var mı
    const { data: existing, error: exErr } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date, is_on_leave, attendance_records ( id )')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

    const keepKeys = new Set<string>()
    const deleteIds: string[] = []
    for (const r of existing ?? []) {
      const hasAttendance = Array.isArray(r.attendance_records) && r.attendance_records.length > 0
      if (r.is_on_leave || hasAttendance) keepKeys.add(`${r.employee_id}::${r.work_date}`)
      else deleteIds.push(r.id as string)
    }

    // Korunan çalışan+gün atlanır; taslak içi tekrarlar da elenir
    const seen = new Set(keepKeys)
    const rows = []
    let skipped = 0
    for (const a of assignments) {
      const key = `${a.employee_id}::${a.work_date}`
      if (seen.has(key)) { skipped++; continue }
      seen.add(key)
      rows.push({
        employee_id:       a.employee_id,
        shift_template_id: a.shift_template_id,
        work_date:         a.work_date,
        start_time:        a.start_time,
        end_time:          a.end_time,
        is_on_leave:       false,
      })
    }

    // 1) Yeni plan tek istekte (tek ifade → ya hepsi ya hiçbiri)
    const { data: inserted, error: insErr } = rows.length > 0
      ? await admin.from('shift_assignments').insert(rows).select('id')
      : { data: [], error: null }
    if (insErr) {
      return NextResponse.json({ error: `Plan aktarılamadı, mevcut plan değiştirilmedi: ${insErr.message}` }, { status: 500 })
    }

    // 2) Eski plan silinir; başarısızsa yeni eklenenler geri alınır
    if (deleteIds.length > 0) {
      const { error: delErr } = await admin.from('shift_assignments').delete().in('id', deleteIds)
      if (delErr) {
        const newIds = (inserted ?? []).map((r) => r.id as string)
        if (newIds.length > 0) await admin.from('shift_assignments').delete().in('id', newIds)
        return NextResponse.json({ error: `Eski plan silinemedi, değişiklik geri alındı: ${delErr.message}` }, { status: 500 })
      }
    }

    // 3) Vardiyası olmayan günler haftalık tatil olarak işaretlenir.
    //    Onaylı/bekleyen izni olan günler atlanır (mevcut haftalık tatiller dahil).
    const errors: string[] = []
    let restDays = 0
    const [{ data: emps, error: empErr }, { data: leaves, error: leaveErr }] = await Promise.all([
      admin.from('employees').select('id').eq('active', true),
      admin
        .from('leave_requests')
        .select('employee_id, start_date, end_date')
        .in('status', ['pending', 'approved'])
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart),
    ])
    if (empErr || leaveErr) {
      errors.push(`Haftalık tatiller atanamadı: ${(empErr ?? leaveErr)!.message}`)
    } else {
      const weekDays = Array.from({ length: 7 }, (_, i) =>
        format(addDays(new Date(weekStart), i), 'yyyy-MM-dd')
      )
      const reviewedAt = new Date().toISOString()
      const restRows = []
      for (const e of emps ?? []) {
        const empId = e.id as string
        const empLeaves = (leaves ?? []).filter((l) => l.employee_id === empId)
        for (const day of weekDays) {
          if (seen.has(`${empId}::${day}`)) continue
          if (empLeaves.some((l) => (l.start_date as string) <= day && (l.end_date as string) >= day)) continue
          restRows.push({
            employee_id: empId,
            leave_type:  'weekly_rest',
            start_date:  day,
            end_date:    day,
            reason:      'Haftalık tatil',
            status:      'approved',
            reviewed_at: reviewedAt,
          })
        }
      }
      if (restRows.length > 0) {
        const { error: restErr } = await admin.from('leave_requests').insert(restRows)
        if (restErr) errors.push(`Haftalık tatiller atanamadı: ${restErr.message}`)
        else restDays = restRows.length
      }
    }

    return NextResponse.json({
      created:  inserted?.length ?? 0,
      replaced: deleteIds.length,
      skipped,
      restDays,
      errors,
    })
  } catch (err) {
    console.error('[POST /api/workforce/apply]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
