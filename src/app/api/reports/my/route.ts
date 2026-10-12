/**
 * GET /api/reports/my?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *
 * Authenticated çalışanın kendi vardiya + devam verilerini döner.
 * employee_id her zaman session'dan alınır.
 *
 * Çalışma özeti hesabı:
 *   - shift_assignments JOIN attendance_records (normal vardiyalar)
 *   - manual_time_correction_requests (approved / direct) — attendance kaydı
 *     yoksa bu talebin saat aralığından worked_minutes hesaplanır.
 *   Aynı günün iki kez sayılmaması için date dedup uygulanır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { totalBreakMinutes, workedMinutes } from '@/lib/attendanceDurations'

/** HH:MM → dakika */
function timeMins(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('date_from')
  const dateTo   = searchParams.get('date_to')

  if (!dateFrom || !dateTo)
    return NextResponse.json({ error: 'date_from ve date_to zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })

  const fromMs = new Date(dateFrom).getTime()
  const toMs   = new Date(dateTo).getTime()
  if (isNaN(fromMs) || isNaN(toMs) || toMs < fromMs)
    return NextResponse.json({ error: 'Geçersiz tarih aralığı.', code: 'VALIDATION_ERROR' }, { status: 400 })
  if ((toMs - fromMs) / (1000 * 60 * 60 * 24) > 366)
    return NextResponse.json({ error: 'Tarih aralığı en fazla 366 gün olabilir.', code: 'VALIDATION_ERROR' }, { status: 400 })

  try {
    const admin = createAdminClient()

    // Shift_assignments + attendance_records
    const { data: shiftData, error: shiftErr } = await admin
      .from('shift_assignments')
      .select(`
        id, work_date, start_time, end_time, is_on_leave,
        shift_templates ( name ),
        attendance_records (
          status, clock_in_at, break_start_at, break_end_at, clock_out_at, completed_break_minutes
        )
      `)
      .eq('employee_id', employee.id)
      .gte('work_date', dateFrom)
      .lte('work_date', dateTo)
      .order('work_date', { ascending: true })
      .order('start_time', { ascending: true })

    if (shiftErr) return NextResponse.json({ error: shiftErr.message, code: 'DB_ERROR' }, { status: 500 })

    // Manuel düzeltmeler (approved + direct) — çalışma özetine eklenir
    const { data: corrData } = await admin
      .from('manual_time_correction_requests')
      .select('id, date, requested_start_time, requested_end_time, status, reason')
      .eq('employee_id', employee.id)
      .in('status', ['approved', 'direct'])
      .gte('date', dateFrom)
      .lte('date', dateTo)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (shiftData ?? []).map((row: any) => {
      const rec = Array.isArray(row.attendance_records)
        ? (row.attendance_records[0] ?? null)
        : (row.attendance_records ?? null)

      const times = {
        clock_in_at:    rec?.clock_in_at    ?? null,
        break_start_at: rec?.break_start_at ?? null,
        break_end_at:   rec?.break_end_at   ?? null,
        clock_out_at:   rec?.clock_out_at   ?? null,
        completed_break_minutes: rec?.completed_break_minutes ?? 0,
      }
      const workedMins = workedMinutes(times)
      const breakMins = times.break_start_at || times.completed_break_minutes > 0
        ? totalBreakMinutes(times)
        : null

      return {
        work_date:      row.work_date as string,
        start_time:     row.start_time as string,
        end_time:       row.end_time as string,
        is_on_leave:    (row.is_on_leave ?? false) as boolean,
        shift_name:     (row.shift_templates?.name ?? null) as string | null,
        status:         (rec?.status ?? 'shift_waiting') as string,
        clock_in_at:    (rec?.clock_in_at    ?? null) as string | null,
        clock_out_at:   (rec?.clock_out_at   ?? null) as string | null,
        break_start_at: (rec?.break_start_at ?? null) as string | null,
        break_end_at:   (rec?.break_end_at   ?? null) as string | null,
        worked_minutes: workedMins,
        break_minutes:  breakMins,
        is_manual_correction: false,
      }
    })

    // Attendance kaydı olmayan düzeltmeler — shift_assignment yoksa ya da
    // attendance worked_minutes hâlâ null ise düzeltme saatinden hesapla.
    const rowDateSet = new Set(rows.map((r) => r.work_date))

    for (const corr of corrData ?? []) {
      const corrDate  = corr.date as string
      const startTime = (corr.requested_start_time as string).slice(0, 5)
      const endTime   = (corr.requested_end_time as string).slice(0, 5)
      const corrMins  = Math.max(0, timeMins(endTime) - timeMins(startTime))

      if (rowDateSet.has(corrDate)) {
        // Shift var → worked_minutes attendance'tan geliyor.
        // Ama attendance_record yoksa (shift_waiting) düzeltme saatini kullan.
        const idx = rows.findIndex((r) => r.work_date === corrDate)
        if (idx !== -1 && rows[idx].worked_minutes === null && !rows[idx].is_on_leave) {
          rows[idx] = {
            ...rows[idx],
            status:         'clocked_out',
            worked_minutes: corrMins,
            break_minutes:  0,
            is_manual_correction: true,
          }
        }
      } else {
        // Shift yok → tamamen manuel satır
        rows.push({
          work_date:      corrDate,
          start_time:     startTime,
          end_time:       endTime,
          is_on_leave:    false,
          shift_name:     null,
          status:         'clocked_out',
          clock_in_at:    null,
          clock_out_at:   null,
          break_start_at: null,
          break_end_at:   null,
          worked_minutes: corrMins,
          break_minutes:  0,
          is_manual_correction: true,
        })
        rowDateSet.add(corrDate)
      }
    }

    // Tarihe göre sırala
    rows.sort((a, b) => a.work_date.localeCompare(b.work_date))

    return NextResponse.json({ rows })
  } catch (err) {
    console.error('[GET /api/reports/my]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
