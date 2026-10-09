/**
 * timeCorrectionService — Manuel mesai düzeltme uygulama mantığı
 *
 * Hem çalışan talebi onayında (review/route.ts) hem yönetici doğrudan
 * girişinde (time-correction/route.ts POST direct) kullanılır.
 *
 * Davranış:
 *   1. shift_assignments: varsa güncelle, yoksa oluştur.
 *   2. attendance_records: varsa clock_in_at / clock_out_at'ı koru, yoksa
 *      manual correction saatlerinden ISO timestamp üret ve kayıt oluştur.
 *      Bu sayede /api/reports/my'daki worked_minutes doğru hesaplanır.
 *   3. Working-time validation: uyarı loglanır, işlemi engellemez.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

interface ApplyParams {
  admin: SupabaseClient
  employeeId: string
  date: string         // 'YYYY-MM-DD'
  startTime: string    // 'HH:MM'
  endTime: string      // 'HH:MM'
}

interface ApplyResult {
  warnings: string[]
}

/**
 * HH:MM + YYYY-MM-DD (Europe/Istanbul duvar saati) → ISO timestamp.
 * Türkiye 2016'dan beri sabit UTC+3; QR kayıtlarıyla tutarlı olması için offset açıkça eklenir.
 */
function toISO(date: string, time: string): string {
  return `${date}T${time}:00.000+03:00`
}

export async function applyTimeCorrection(params: ApplyParams): Promise<ApplyResult> {
  const { admin, employeeId, date, startTime, endTime } = params
  const warnings: string[] = []

  // ── 1. shift_assignments güncelle / oluştur ─────────────────
  try {
    const { data: existing } = await admin
      .from('shift_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('work_date', date)
      .limit(1)

    if (existing && existing.length > 0) {
      const { error: upErr } = await admin
        .from('shift_assignments')
        .update({
          start_time: startTime,
          end_time: endTime,
          shift_template_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id)

      if (upErr) warnings.push(`shift_assignment güncellenemedi: ${upErr.message}`)
    } else {
      const { error: insErr } = await admin
        .from('shift_assignments')
        .insert({
          employee_id:       employeeId,
          shift_template_id: null,
          work_date:         date,
          start_time:        startTime,
          end_time:          endTime,
          is_on_leave:       false,
        })

      if (insErr) warnings.push(`shift_assignment oluşturulamadı: ${insErr.message}`)
    }
  } catch (e) {
    warnings.push(`shift_assignment işlemi başarısız: ${String(e)}`)
  }

  // ── 2. attendance_records güncelle / oluştur ─────────────────
  // Çalışma özeti worked_minutes'i buradan hesaplıyor.
  try {
    // Bugünkü assignment'ı bul (az önce güncelledik/oluşturduk)
    const { data: asgn } = await admin
      .from('shift_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('work_date', date)
      .limit(1)

    if (asgn && asgn.length > 0) {
      const assignmentId = asgn[0].id
      const clockInISO  = toISO(date, startTime)
      const clockOutISO = toISO(date, endTime)

      const { data: recExisting } = await admin
        .from('attendance_records')
        .select('id, clock_in_at, clock_out_at')
        .eq('shift_assignment_id', assignmentId)
        .maybeSingle()

      if (recExisting) {
        // Mevcut kayıt var — sadece clock zamanlarını güncelle
        const { error: recUpErr } = await admin
          .from('attendance_records')
          .update({
            clock_in_at:        clockInISO,
            clock_out_at:       clockOutISO,
            status:             'clocked_out',
            verification_method:'manual_correction',
            updated_at:          new Date().toISOString(),
          })
          .eq('id', recExisting.id)

        if (recUpErr) warnings.push(`attendance_record güncellenemedi: ${recUpErr.message}`)
      } else {
        // Kayıt yok — oluştur
        const { error: recInsErr } = await admin
          .from('attendance_records')
          .insert({
            employee_id:        employeeId,
            shift_assignment_id: assignmentId,
            status:             'clocked_out',
            clock_in_at:        clockInISO,
            clock_out_at:       clockOutISO,
            verification_method:'manual_correction',
          })

        if (recInsErr) warnings.push(`attendance_record oluşturulamadı: ${recInsErr.message}`)
      }
    }
  } catch (e) {
    warnings.push(`attendance_record işlemi başarısız: ${String(e)}`)
  }

  // ── 3. Working-time uyarıları (non-blocking) ─────────────────
  try {
    const { getWorkingTimeConfig } = await import('@/lib/workingTimeConfig')
    const { validateShiftAssignment } = await import('@/lib/workingTimeService')
    const { startOfWeek, endOfWeek, format } = await import('date-fns')
    const config = getWorkingTimeConfig()

    const dateObj  = new Date(date)
    const wkStart  = format(startOfWeek(dateObj, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const wkEnd    = format(endOfWeek(dateObj,   { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const { data: weekShifts } = await admin
      .from('shift_assignments')
      .select('id, work_date, start_time, end_time')
      .eq('employee_id', employeeId)
      .gte('work_date', wkStart)
      .lte('work_date', wkEnd)

    const { data: empRaw } = await admin
      .from('employees')
      .select('employment_type')
      .eq('id', employeeId)
      .maybeSingle()

    const result = validateShiftAssignment({
      newDate: date,
      newStart: startTime,
      newEnd: endTime,
      existingShifts: (weekShifts ?? [])
        .filter((s: { work_date: string }) => s.work_date !== date)   // kendisini hariç tut
        .map((s: { id: string; work_date: string; start_time: string; end_time: string }) => ({
          id: s.id, work_date: s.work_date, start_time: s.start_time, end_time: s.end_time,
        })),
      weekStart: wkStart,
      weekEnd: wkEnd,
      config,
      employment_type: ((empRaw?.employment_type ?? 'full_time') as import('@/types/employee').EmploymentType),
    })

    const allMessages = [...result.errors, ...result.warnings].map((v) => v.message)
    allMessages.forEach((m) => {
      warnings.push(m)
      console.warn('[timeCorrectionService] working-time warning (non-blocking):', m)
    })
  } catch (wtErr) {
    console.warn('[timeCorrectionService] working-time check skipped:', wtErr)
  }

  return { warnings }
}
