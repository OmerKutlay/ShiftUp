/**
 * POST /api/workforce/apply
 *
 * Onaylanmış taslak planı Weekly Schedule'a (shift_assignments) yazar.
 * Zaten var olan aynı employee+date kaydını atlar (duplicate guard).
 * Yalnızca MANAGER_ROLES erişebilir.
 *
 * Body: { assignments: DraftAssignment[] }
 * Response: { created: number, skipped: number, errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import type { DraftAssignment, PlannerResult } from '@/lib/workforcePlanner'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as { assignments?: DraftAssignment[]; hasHardViolation?: boolean }
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

    const admin = createAdminClient()

    // Mevcut bu haftaki atamaları çek (duplicate guard)
    const dates = [...new Set(assignments.map((a) => a.work_date))]
    const weekStart = dates.reduce((a, b) => (a < b ? a : b))
    const weekEnd   = dates.reduce((a, b) => (a > b ? a : b))

    const { data: existing } = await admin
      .from('shift_assignments')
      .select('employee_id, work_date')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)

    // employee_id+work_date → var mı? set
    const existingKeys = new Set(
      (existing ?? []).map((r) => `${r.employee_id}::${r.work_date}`)
    )

    let created = 0
    let skipped = 0
    const errors: string[] = []

    // Batch insert — her atamayı sırayla işle
    for (const a of assignments) {
      const key = `${a.employee_id}::${a.work_date}`
      if (existingKeys.has(key)) {
        skipped++
        continue
      }

      const { error } = await admin
        .from('shift_assignments')
        .insert({
          employee_id:        a.employee_id,
          shift_template_id:  a.shift_template_id,
          work_date:          a.work_date,
          start_time:         a.start_time,
          end_time:           a.end_time,
          is_on_leave:        false,
        })

      if (error) {
        errors.push(`${a.employee_name} / ${a.work_date}: ${error.message}`)
      } else {
        created++
        existingKeys.add(key) // sonraki döngüde tekrar insert'i önle
      }
    }

    return NextResponse.json({ created, skipped, errors })
  } catch (err) {
    console.error('[POST /api/workforce/apply]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
